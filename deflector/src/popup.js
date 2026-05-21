/** @typedef {'off' | 'manual' | 'auto' | 'always'} SiteMode */

const findingCountEl = document.getElementById('finding-count');
const categoryChipsEl = document.getElementById('category-chips');
const statLabelEl = document.getElementById('stat-label');
const hostLabelEl = document.getElementById('host-label');
const pageInfoEl = document.getElementById('page-info');
const siteModeEl = document.getElementById('site-mode');
const verboseEl = document.getElementById('verbose');
const deepScanEl = document.getElementById('deep-scan');
const apiKeyEl = document.getElementById('api-key');
const filterVersionEl = document.getElementById('filter-version');
const scanBtn = document.getElementById('scan-btn');
const sidebarBtn = document.getElementById('sidebar-btn');
const statusEl = document.getElementById('status-msg');

const PAGE_TYPE_LABELS = {
  checkout: 'Checkout page',
  booking: 'Booking page',
  product: 'Product page',
  commerce: 'Shopping page',
  general: 'Web page',
};

function formatPageContext(pageInfo) {
  if (!pageInfo?.pageType) return '';
  const label = PAGE_TYPE_LABELS[pageInfo.pageType] || pageInfo.pageType;
  return `Scanned as a ${label.toLowerCase()}`;
}

function formatTacticCount(n) {
  const count = Number(n);
  if (Number.isNaN(count)) return '0 pressure tactics';
  return `${count} pressure tactic${count === 1 ? '' : 's'}`;
}

const CATEGORY_LABELS = {
  urgency: 'Urgency',
  scarcity: 'Scarcity',
  social_proof: 'Social proof',
  misdirection: 'Misdirection',
  trick_question: 'Trick question',
  hidden_cost: 'Hidden cost',
  disguised_ad: 'Disguised ad',
};

let currentTab = null;
let currentHost = '';

function setStatus(text, tone = 'muted') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('deflector-meta--error', 'deflector-meta--ok');
  if (tone === 'error') statusEl.classList.add('deflector-meta--error');
  else if (tone === 'ok') statusEl.classList.add('deflector-meta--ok');
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (tab?.url?.startsWith('chrome://') || tab?.url?.startsWith('chrome-extension://')) {
    setStatus('Deflector works on regular websites. Open a shopping or booking tab, then try again.', 'error');
    scanBtn.disabled = true;
    sidebarBtn.disabled = true;
    return;
  }

  if (tab?.url) {
    try {
      currentHost = new URL(tab.url).hostname.replace(/^www\./, '');
      hostLabelEl.textContent = currentHost;
    } catch {
      hostLabelEl.textContent = 'Current tab';
    }
  }

  const stored = await chrome.storage.local.get(['siteModes', 'verbose', 'deepScanEnabled', 'apiKey']);
  siteModeEl.value = stored.siteModes?.[currentHost] || 'auto';
  verboseEl.checked = !!stored.verbose;
  deepScanEl.checked = !!stored.deepScanEnabled;
  if (stored.apiKey) apiKeyEl.value = stored.apiKey;

  await refreshFindings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!currentTab?.id) return;
    if (area === 'session' && changes[`findings_${currentTab.id}`]) {
      refreshFindings();
    }
  });
}

async function refreshFindings() {
  if (!currentTab?.id) return;

  const response = await chrome.runtime.sendMessage({
    type: 'GET_FINDINGS',
    tabId: currentTab.id,
  });

  const data = response?.data;

  if (!data) {
    findingCountEl.textContent = '0';
    categoryChipsEl.innerHTML = '';
    document.getElementById('stat-block')?.classList.add('stat-all-clear');
    document.getElementById('stat-block')?.classList.remove('stat-has-findings');
    if (statLabelEl) statLabelEl.textContent = 'Nothing flagged on this scan';
    pageInfoEl.textContent = '';
    filterVersionEl.textContent = '';
    return;
  }

  const { findings = [], pageInfo, filterVersion } = data;
  const count = findings.length;
  findingCountEl.textContent = String(count);
  document.getElementById('stat-block')?.classList.toggle('stat-all-clear', count === 0);
  document.getElementById('stat-block')?.classList.toggle('stat-has-findings', count > 0);
  if (statLabelEl) {
    statLabelEl.textContent = count === 0
      ? 'Nothing flagged on this scan'
      : 'Pressure tactics on this page';
  }

  const byCategory = {};
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }

  categoryChipsEl.innerHTML = Object.entries(byCategory)
    .map(([cat, n]) => `<span class="deflector-chip deflector-chip--${cat}">${CATEGORY_LABELS[cat] || cat}: ${n}</span>`)
    .join('');

  if (pageInfo) {
    pageInfoEl.textContent = formatPageContext(pageInfo);
  } else {
    pageInfoEl.textContent = '';
  }

  filterVersionEl.textContent = filterVersion ? `Rule list version ${filterVersion}` : '';
}

async function saveSiteMode(mode) {
  const stored = await chrome.storage.local.get(['siteModes']);
  const siteModes = stored.siteModes || {};
  siteModes[currentHost] = mode;
  await chrome.storage.local.set({ siteModes });
  notifyContentScript();
}

async function saveGlobalSettings() {
  await chrome.storage.local.set({
    verbose: verboseEl.checked,
    deepScanEnabled: deepScanEl.checked,
    apiKey: apiKeyEl.value.trim(),
  });
  notifyContentScript();
}

function notifyContentScript() {
  if (!currentTab?.id) return;
  forwardToTab({ type: 'SETTINGS_CHANGED' }, { silent: true });
}

async function forwardToTab(payload, options = {}) {
  if (!currentTab?.id) return { ok: false };

  const busy = !options.silent;
  if (busy) {
    scanBtn.disabled = true;
    sidebarBtn.disabled = true;
    setStatus('Scanning this page…');
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FORWARD_TO_TAB',
      tabId: currentTab.id,
      payload,
    });

    if (!response?.ok) {
      setStatus(`Couldn't scan this page. Refresh the tab and try again.${response?.error ? ` (${response.error})` : ''}`, 'error');
      return response;
    }

    const count = response.result?.count;
    if (count != null) {
      findingCountEl.textContent = String(count);
    }

    await refreshFindings();

    if (busy) {
      setStatus(`Scan complete — ${formatTacticCount(findingCountEl.textContent)}. Open the panel on the page for details.`, 'ok');
    }

    return response;
  } finally {
    if (busy) {
      scanBtn.disabled = false;
      sidebarBtn.disabled = false;
    }
  }
}

siteModeEl.addEventListener('change', () => saveSiteMode(/** @type {SiteMode} */ (siteModeEl.value)));
verboseEl.addEventListener('change', saveGlobalSettings);
deepScanEl.addEventListener('change', saveGlobalSettings);
apiKeyEl.addEventListener('change', saveGlobalSettings);

scanBtn.addEventListener('click', () => {
  const trigger = deepScanEl.checked ? 'deep' : 'manual';
  forwardToTab({ type: 'SCAN_PAGE', trigger, openSidebar: false });
});

sidebarBtn.addEventListener('click', () => {
  forwardToTab({ type: 'TOGGLE_SIDEBAR', show: true });
});

init();
