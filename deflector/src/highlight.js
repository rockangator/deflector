import { getCategoryLabel } from './ruleEngine.js';
import { normalizeHost } from './pageClassifier.js';
import {
  renderOverlayHighlight,
  clearOverlayHighlights,
  focusFindingOnPage,
  setOverlayVisible,
  CATEGORY_TINTS,
} from './highlightOverlay.js';
import { getLogoMarkHtml, pinLogoMark, pinFabPosition, pinFabHintPosition } from './ui/logo.js';
import { getEmptyStateHtml } from './ui/emptyState.js';
import { COPY, SCAN_MODE_OPTIONS } from './ui/copy.js';
import { escapeHtml, findByDataId } from './ui/dom.js';
import { formatFindingQuote } from './ui/textQuality.js';

let sidebarEl = null;
let fabEl = null;
let fabHintEl = null;
let lastBadgeCount = -1;
let scanMessageTimer = null;
let scanMessageIndex = 0;
/** @type {import('./ruleEngine.js').Finding[]} */
let lastFindings = [];

/**
 * @param {import('./ruleEngine.js').Finding[]} findings
 * @param {{ openSidebar?: boolean }} [options]
 */
export function renderFindings(findings, options = {}) {
  lastFindings = findings;
  clearHighlights();

  findings.forEach((finding, i) => {
    if (finding.element && document.contains(finding.element)) {
      renderOverlayHighlight(finding, i + 1);
    }
  });

  renderSidebar(findings);
  updateFabBadge(findings.length);

  if (options.openSidebar) {
    openSidebar();
  } else {
    setOverlayVisible(isSidebarOpen());
  }
}

export function getLastFindings() {
  return lastFindings;
}

function ensureSidebar() {
  if (sidebarEl) return sidebarEl;

  sidebarEl = document.createElement('aside');
  sidebarEl.id = 'deflector-sidebar';
  sidebarEl.setAttribute('role', 'complementary');
  sidebarEl.setAttribute('aria-label', 'Deflector findings panel');
  sidebarEl.innerHTML = `
    <header class="deflector-sidebar-header">
      <div class="deflector-sidebar-brand">
        ${getLogoMarkHtml()}
        <div>
          <h2>Deflector</h2>
          <p class="deflector-sidebar-subtitle" id="deflector-sidebar-count"></p>
        </div>
      </div>
      <button type="button" id="deflector-sidebar-close" class="deflector-btn deflector-btn--secondary deflector-btn--icon" aria-label="Close findings panel">×</button>
    </header>
    <div class="deflector-sidebar-body deflector-scrollbar-transparent"></div>
    <footer class="deflector-sidebar-settings">
      <button type="button" id="deflector-settings-toggle" class="deflector-settings-toggle" aria-expanded="false">
        Settings ▾
      </button>
      <div id="deflector-settings-panel" class="deflector-settings-panel" aria-hidden="true">
        <label class="deflector-setting-row">
          <span>Scan mode</span>
          <select id="deflector-site-mode" class="deflector-field">
            ${SCAN_MODE_OPTIONS}
          </select>
        </label>
        <label class="deflector-setting-row deflector-setting-check">
          <input type="checkbox" id="deflector-verbose" />
          <span>${COPY.verboseLabel}</span>
        </label>
        <label class="deflector-setting-row deflector-setting-check">
          <input type="checkbox" id="deflector-deep-scan" />
          <span>${COPY.deepScanLabel}</span>
        </label>
        <button type="button" id="deflector-rescan-btn" class="deflector-btn deflector-btn--primary deflector-btn--block">${COPY.rescanBtn}</button>
      </div>
    </footer>
  `;
  document.documentElement.appendChild(sidebarEl);

  pinLogoMark(sidebarEl.querySelector('.deflector-sidebar-brand .deflector-logo-mark'));

  sidebarEl.querySelector('#deflector-sidebar-close')?.addEventListener('click', closeSidebar);
  sidebarEl.querySelector('#deflector-settings-toggle')?.addEventListener('click', toggleSettingsPanel);
  sidebarEl.querySelector('#deflector-rescan-btn')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('deflector:rescan', { detail: { trigger: 'manual' } }));
  });

  bindSettingsControls();
  bindSidebarKeyboard();
  return sidebarEl;
}

function bindSidebarKeyboard() {
  if (sidebarEl?.dataset.kbdBound) return;
  if (sidebarEl) sidebarEl.dataset.kbdBound = '1';
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isSidebarOpen()) return;
    e.stopPropagation();
    closeSidebar();
    fabEl?.focus();
  });
}

function setRescanBusy(busy) {
  sidebarEl?.querySelector('#deflector-rescan-btn')?.toggleAttribute('disabled', busy);
  fabEl?.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export function announceFab(message, priority = 'polite') {
  const live = fabEl?.querySelector('#deflector-fab-live');
  if (!live) return;
  live.setAttribute('aria-live', priority);
  live.textContent = message;
}

function toggleSettingsPanel() {
  const panel = sidebarEl?.querySelector('#deflector-settings-panel');
  const toggle = sidebarEl?.querySelector('#deflector-settings-toggle');
  if (!panel || !toggle) return;
  const open = !panel.classList.contains('deflector-settings-panel-open');
  panel.classList.toggle('deflector-settings-panel-open', open);
  panel.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Settings ▴' : 'Settings ▾';
}

function bindSettingsControls() {
  const modeEl = sidebarEl?.querySelector('#deflector-site-mode');
  const verboseEl = sidebarEl?.querySelector('#deflector-verbose');
  const deepEl = sidebarEl?.querySelector('#deflector-deep-scan');

  modeEl?.addEventListener('change', async () => {
    const host = normalizeHost(location.hostname);
    const stored = await chrome.storage.local.get(['siteModes']);
    const siteModes = stored.siteModes || {};
    siteModes[host] = modeEl.value;
    await chrome.storage.local.set({ siteModes });
    document.dispatchEvent(new CustomEvent('deflector:settings-changed'));
  });

  verboseEl?.addEventListener('change', async () => {
    await chrome.storage.local.set({ verbose: verboseEl.checked });
    document.dispatchEvent(new CustomEvent('deflector:settings-changed'));
  });

  deepEl?.addEventListener('change', async () => {
    await chrome.storage.local.set({ deepScanEnabled: deepEl.checked });
    document.dispatchEvent(new CustomEvent('deflector:settings-changed'));
  });
}

/**
 * @param {import('./ruleEngine.js').Finding[]} findings
 */
function renderSidebar(findings) {
  ensureSidebar();
  const body = sidebarEl.querySelector('.deflector-sidebar-body');
  if (!body) return;

  sidebarEl.querySelector('.deflector-scan-error')?.remove();

  const countEl = sidebarEl.querySelector('#deflector-sidebar-count');
  if (countEl) {
    countEl.textContent = findings.length === 0
      ? COPY.watchingSubtitle
      : COPY.tacticsFound(findings.length);
    countEl.classList.toggle('deflector-sidebar-subtitle--active', findings.length > 0);
    countEl.classList.toggle('deflector-sidebar-subtitle--clear', findings.length === 0);
  }

  sidebarEl?.classList.toggle('deflector-sidebar--has-findings', findings.length > 0);

  if (findings.length === 0) {
    body.innerHTML = getEmptyStateHtml();
  } else {
    const indexById = new Map(findings.map((f, i) => [f.id, i + 1]));
    body.innerHTML = `
      <ul class="deflector-findings-list">${findings.map((f) => {
        const num = indexById.get(f.id) || '';
        const quote = formatFindingQuote(f, 100);
        const pct = Math.round(f.confidence * 100);
        return `
        <li>
          <button type="button" class="deflector-finding" data-id="${escapeHtml(f.id)}" style="--deflector-finding-tint: ${CATEGORY_TINTS[f.category] || 'var(--deflector-cat-urgency)'}; animation-delay: ${Math.min((num - 1) * 40, 200)}ms">
            <span class="deflector-finding-num" aria-hidden="true">${num}</span>
            <span class="deflector-finding-cat deflector-chip deflector-chip--${f.category}">${escapeHtml(getCategoryLabel(f.category))}</span>
            <p class="deflector-finding-text">"${escapeHtml(quote)}"</p>
            <p class="deflector-finding-explain">${escapeHtml(f.explanation)} <span class="deflector-finding-meta">${pct}% sure</span></p>
          </button>
        </li>`;
      }).join('')}</ul>`;

    bindFindingCardClicks(body);
  }
}

function bindFindingCardClicks(body) {
  body.querySelectorAll('.deflector-finding').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      if (!id) return;
      body.querySelectorAll('.deflector-finding--active').forEach((el) => {
        el.classList.remove('deflector-finding--active');
      });
      card.classList.add('deflector-finding--active');
      focusFindingOnPage(id);
    });
  });
}

document.addEventListener('deflector:open-finding', (e) => {
  openSidebar();
  const id = e.detail?.id;
  if (!id) return;
  requestAnimationFrame(() => {
    const card = sidebarEl ? findByDataId(sidebarEl, id) : null;
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sidebarEl?.querySelectorAll('.deflector-finding--active').forEach((el) => {
      el.classList.remove('deflector-finding--active');
    });
    card?.classList.add('deflector-finding--active');
    focusFindingOnPage(id);
  });
});

export async function syncSidebarSettings() {
  ensureSidebar();
  const host = normalizeHost(location.hostname);
  const stored = await chrome.storage.local.get(['siteModes', 'verbose', 'deepScanEnabled']);
  const modeEl = sidebarEl?.querySelector('#deflector-site-mode');
  const verboseEl = sidebarEl?.querySelector('#deflector-verbose');
  const deepEl = sidebarEl?.querySelector('#deflector-deep-scan');
  if (modeEl) modeEl.value = stored.siteModes?.[host] || 'auto';
  if (verboseEl) verboseEl.checked = !!stored.verbose;
  if (deepEl) deepEl.checked = !!stored.deepScanEnabled;
}

export function clearHighlights() {
  clearOverlayHighlights();
}

export function openSidebar() {
  ensureSidebar();
  syncSidebarSettings();
  sidebarEl?.classList.add('deflector-sidebar-open');
  setOverlayVisible(true);
}

export function closeSidebar() {
  sidebarEl?.classList.remove('deflector-sidebar-open');
  setOverlayVisible(false);
}

export function toggleSidebar(show) {
  ensureSidebar();
  const shouldShow = show ?? !sidebarEl?.classList.contains('deflector-sidebar-open');
  if (shouldShow) openSidebar();
  else closeSidebar();
}

export function isSidebarOpen() {
  return sidebarEl?.classList.contains('deflector-sidebar-open') ?? false;
}

export function initFab(visible, callbacks = {}) {
  if (!visible) {
    fabEl?.remove();
    fabEl = null;
    return;
  }

  if (!fabEl) {
    fabEl = document.createElement('button');
    fabEl.id = 'deflector-fab';
    fabEl.type = 'button';
    fabEl.title = COPY.fabTitleIdle;
    fabEl.setAttribute('aria-label', 'Deflector — open findings panel');
    fabEl.innerHTML = `
      ${getLogoMarkHtml({ variant: 'fab' })}
      <span class="deflector-fab-count" id="deflector-fab-count">0</span>
      <span class="deflector-sr-only" id="deflector-fab-live" aria-live="polite"></span>
    `;
    (document.body || document.documentElement).appendChild(fabEl);

    pinLogoMark(fabEl.querySelector('.deflector-logo-mark'), 'fab');
    pinFabPosition(fabEl);

    fabEl.addEventListener('click', () => {
      dismissFabHint(true);
      if (callbacks.onToggle) callbacks.onToggle();
      else toggleSidebar();
    });

    maybeShowFabHint();
  }

  fabEl.style.display = 'flex';
  pinFabPosition(fabEl);
}

const FAB_HINT_KEY = 'fabHintSeen';

async function maybeShowFabHint() {
  if (!fabEl || fabHintEl) return;
  try {
    const stored = await chrome.storage.local.get([FAB_HINT_KEY]);
    if (stored[FAB_HINT_KEY]) return;
  } catch {
    return;
  }

  fabHintEl = document.createElement('div');
  fabHintEl.id = 'deflector-fab-hint';
  fabHintEl.className = 'deflector-fab-hint deflector-panel deflector-panel--paper deflector-panel--pad-sm';
  fabHintEl.setAttribute('role', 'status');
  fabHintEl.innerHTML = `
    <p class="deflector-fab-hint-text">${COPY.fabHint}</p>
    <button type="button" class="deflector-btn deflector-btn--primary deflector-btn--compact deflector-fab-hint-dismiss" aria-label="Dismiss tip">${COPY.fabHintDismiss}</button>
  `;
  document.documentElement.appendChild(fabHintEl);
  pinFabHintPosition(fabHintEl);

  fabHintEl.querySelector('.deflector-fab-hint-dismiss')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissFabHint(true);
  });

  requestAnimationFrame(() => {
    fabHintEl?.classList.add('deflector-fab-hint-visible');
  });
}

async function dismissFabHint(persist = false) {
  if (!fabHintEl) return;
  fabHintEl.classList.remove('deflector-fab-hint-visible');
  const el = fabHintEl;
  fabHintEl = null;
  setTimeout(() => el.remove(), 280);
  if (persist) {
    try {
      await chrome.storage.local.set({ [FAB_HINT_KEY]: true });
    } catch { /* ignore */ }
  }
}

export function hideFab() {
  if (fabEl) fabEl.style.display = 'none';
}

export function showFab() {
  if (fabEl) {
    fabEl.style.setProperty('display', 'flex', 'important');
    pinFabPosition(fabEl);
  }
}

export function updateFabBadge(count) {
  if (!fabEl) return;
  const badge = fabEl.querySelector('#deflector-fab-count');
  if (!badge) return;

  if (count !== lastBadgeCount) {
    if (count > lastBadgeCount && lastBadgeCount >= 0) {
      badge.classList.remove('deflector-fab-count-pop');
      void badge.offsetWidth;
      badge.classList.add('deflector-fab-count-pop');
    }
    if (count > 0 && lastBadgeCount === 0) {
      fabEl.classList.remove('deflector-fab-first-find');
      void fabEl.offsetWidth;
      fabEl.classList.add('deflector-fab-first-find');
      setTimeout(() => fabEl?.classList.remove('deflector-fab-first-find'), 900);
    }
    lastBadgeCount = count;
  }

  badge.textContent = String(count);
  badge.classList.toggle('deflector-fab-count-zero', count === 0);
  fabEl.classList.toggle('deflector-fab-has-findings', count > 0);
  fabEl.title = count > 0
    ? COPY.fabTitleFindings(count)
    : COPY.fabTitleIdle;
  const live = fabEl.querySelector('#deflector-fab-live');
  if (live && count > 0) live.textContent = COPY.fabLiveFindings(count);
}

export function setFabScanning(scanning) {
  if (!fabEl) return;
  setRescanBusy(scanning);
  fabEl.classList.toggle('deflector-fab-scanning', scanning);
  const live = fabEl.querySelector('#deflector-fab-live');

  if (scanning) {
    scanMessageIndex = 0;
    const showScanMessage = () => {
      if (!live) return;
      live.textContent = COPY.scanMessages[scanMessageIndex % COPY.scanMessages.length];
      scanMessageIndex += 1;
    };
    showScanMessage();
    if (scanMessageTimer) clearInterval(scanMessageTimer);
    scanMessageTimer = setInterval(showScanMessage, 2200);
    fabEl.title = COPY.fabTitleScanning;
    return;
  }

  if (scanMessageTimer) {
    clearInterval(scanMessageTimer);
    scanMessageTimer = null;
  }
  fabEl.classList.remove('deflector-fab-settle');
  void fabEl.offsetWidth;
  fabEl.classList.add('deflector-fab-settle');
  setTimeout(() => fabEl?.classList.remove('deflector-fab-settle'), 600);
  if (live) live.textContent = '';
  fabEl.title = lastBadgeCount > 0 ? COPY.fabTitleFindings(lastBadgeCount) : COPY.fabTitleIdle;
}

export function showScanError(detail) {
  const message = detail ? COPY.scanErrorDetail(truncate(String(detail), 120)) : COPY.scanError;
  announceFab(message, 'assertive');
  if (!sidebarEl) return;
  let banner = sidebarEl.querySelector('.deflector-scan-error');
  if (!banner) {
    banner = document.createElement('p');
    banner.className = 'deflector-scan-error deflector-meta deflector-meta--error';
    banner.setAttribute('role', 'alert');
    sidebarEl.querySelector('.deflector-sidebar-body')?.prepend(banner);
  }
  banner.textContent = message;
}
