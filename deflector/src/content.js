import { classifyPage, shouldScan, normalizeHost, isPriorityCommercePage } from './pageClassifier.js';
import { extractCandidates, loadSiteAdapter } from './candidateExtractor.js';
import { loadFilters, runRuleEngine, rememberPriceBaseline } from './ruleEngine.js';
import {
  renderFindings,
  clearHighlights,
  toggleSidebar,
  initFab,
  hideFab,
  showFab,
  setFabScanning,
  updateFabBadge,
  syncSidebarSettings,
  getLastFindings,
  showScanError,
} from './highlight.js';
import { escalateWithLlm, mergeFindings } from './llmEscalation.js';

/** @typedef {'off' | 'manual' | 'auto' | 'always'} SiteMode */

const DEBOUNCE_MS = 1200;
const AUTO_RETRY_DELAYS = [0, 1500, 3500, 7000, 12000];

let debounceTimer = null;
let lastCandidateHash = '';
let lastUrl = location.href;
let scanning = false;
let observerStarted = false;
let fabVisible = false;

/** @type {SiteMode} */
let siteMode = 'auto';
let verbose = false;
let deepScanEnabled = false;

async function loadSettings() {
  const host = normalizeHost(location.hostname);
  const stored = await chrome.storage.local.get(['siteModes', 'verbose', 'deepScanEnabled']);
  siteMode = stored.siteModes?.[host] || 'auto';
  verbose = !!stored.verbose;
  deepScanEnabled = !!stored.deepScanEnabled;
}

function hashCandidates(candidates) {
  return candidates.map((c) => c.text.slice(0, 80)).join('|');
}

function shouldShowFab(pageInfo) {
  if (pageInfo.disabled) return false;
  if (siteMode === 'off') return false;
  return (
    isPriorityCommercePage(location)
    || pageInfo.riskScore >= 30
    || siteMode === 'always'
  );
}

function updateFabVisibility(pageInfo) {
  const show = shouldShowFab(pageInfo);
  fabVisible = show;
  if (show) {
    initFab(true, {
      onToggle: () => {
        if (getLastFindings().length === 0 && !scanning) {
          runScan('manual', '', { openSidebar: true });
        } else {
          toggleSidebar();
        }
      },
    });
    updateFabBadge(getLastFindings().length);
  } else {
    hideFab();
  }
}

/**
 * @param {'auto' | 'manual' | 'deep'} trigger
 * @param {string} [selectionText]
 * @param {{ openSidebar?: boolean }} [options]
 */
async function runScan(trigger = 'auto', selectionText = '', options = {}) {
  if (scanning) return { findings: getLastFindings(), count: getLastFindings().length };
  scanning = true;
  setFabScanning(true);

  try {
    await loadSettings();
    const pageInfo = classifyPage(location, document, siteMode);
    updateFabVisibility(pageInfo);

    if (pageInfo.disabled && trigger === 'auto') {
      await chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: 0 }).catch(() => {});
      return { findings: [], count: 0 };
    }

    if (!shouldScan(siteMode, pageInfo.riskScore, trigger, location)) {
      return { findings: getLastFindings(), count: getLastFindings().length };
    }

    rememberPriceBaseline(document);

    const [filters, siteAdapter] = await Promise.all([
      loadFilters(),
      loadSiteAdapter(location.hostname),
    ]);

    const candidates = extractCandidates(document, location.hostname, siteAdapter, selectionText);
    const candidateHash = hashCandidates(candidates);

    if (trigger === 'auto' && candidateHash === lastCandidateHash) {
      return { findings: getLastFindings(), count: getLastFindings().length };
    }
    lastCandidateHash = candidateHash;

    const useDeep = trigger === 'deep' || deepScanEnabled;
    let findings = runRuleEngine(candidates, filters, location.hostname, siteAdapter, document, {
      verbose,
      deep: useDeep,
    });

    const hasLowConfidence = findings.some((f) => f.confidence >= 0.5 && f.confidence < 0.8);
    if (useDeep || hasLowConfidence) {
      const llmFindings = await escalateWithLlm(findings, candidates, { deep: useDeep });
      findings = mergeFindings(findings, llmFindings);
    }

    const openSidebar = options.openSidebar ?? (trigger === 'manual' || trigger === 'deep');
    renderFindings(findings, { openSidebar });

    await chrome.runtime.sendMessage({
      type: 'SAVE_FINDINGS',
      findings: findings.map(stripElement),
      pageInfo,
      filterVersion: filters.version,
    });

    return { findings, count: findings.length };
  } catch (err) {
    console.error('[Deflector] Scan failed:', err);
    showScanError(String(err));
    return { findings: [], count: 0, error: String(err) };
  } finally {
    scanning = false;
    setFabScanning(false);
  }
}

/**
 * @param {import('./ruleEngine.js').Finding} f
 */
function stripElement(f) {
  const { element, ...rest } = f;
  return rest;
}

function scheduleScan(trigger = 'auto') {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runScan(trigger), DEBOUNCE_MS);
}

function onPageActivity() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastCandidateHash = '';
    renderFindings([], { openSidebar: false });
    const pageInfo = classifyPage(location, document, siteMode);
    updateFabVisibility(pageInfo);
  }
  scheduleScan('auto');
}

function initMutationObserver() {
  if (observerStarted) return;
  observerStarted = true;

  const observer = new MutationObserver(onPageActivity);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function initSpaNavigationWatch() {
  const notify = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastCandidateHash = '';
      renderFindings([], { openSidebar: false });
      scheduleScan('auto');
    }
  };

  window.addEventListener('popstate', notify);

  const wrapHistory = (method) => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      notify();
      return result;
    };
  };

  wrapHistory('pushState');
  wrapHistory('replaceState');
  setInterval(notify, 2000);
}

function scheduleAutoRetries() {
  for (const delay of AUTO_RETRY_DELAYS) {
    setTimeout(() => {
      lastCandidateHash = '';
      runScan('auto');
    }, delay);
  }
}

document.addEventListener('deflector:rescan', (e) => {
  lastCandidateHash = '';
  const trigger = e.detail?.trigger || 'manual';
  runScan(trigger, '', { openSidebar: true });
});

document.addEventListener('deflector:settings-changed', async () => {
  lastCandidateHash = '';
  await loadSettings();
  await syncSidebarSettings();
  runScan('manual');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCAN_PAGE') {
    lastCandidateHash = '';
    const openSidebar = message.openSidebar !== false;
    runScan(message.trigger || 'manual', '', { openSidebar })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'SCAN_SELECTION') {
    const text = document.getSelection()?.toString() || '';
    lastCandidateHash = '';
    runScan('manual', text, { openSidebar: true })
      .then((result) => sendResponse({ ok: true, hadSelection: !!text, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'TOGGLE_SIDEBAR') {
    toggleSidebar(message.show);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'CLEAR_HIGHLIGHTS') {
    clearHighlights();
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'SETTINGS_CHANGED') {
    lastCandidateHash = '';
    loadSettings()
      .then(() => syncSidebarSettings())
      .then(() => runScan('manual', '', { openSidebar: false }))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message.type === 'PING') {
    sendResponse({ ok: true, ready: true, fabVisible, scanning });
    return false;
  }
  return false;
});

async function init() {
  await loadSettings();
  initSpaNavigationWatch();
  initMutationObserver();

  const pageInfo = classifyPage(location, document, siteMode);
  updateFabVisibility(pageInfo);

  scheduleAutoRetries();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
