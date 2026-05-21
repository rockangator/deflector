/** Shared user-facing copy — keep popup.html / popup.js strings aligned manually. */

export const SCAN_MODE_OPTIONS = `
  <option value="auto">Auto on shopping sites</option>
  <option value="manual">Only when I tap Rescan</option>
  <option value="always">Every time I open a page</option>
  <option value="off">Don't scan this site</option>
`;

export const COPY = {
  verboseLabel: 'Show less certain matches (about 60–79% sure)',
  deepScanLabel: 'Deep scan with AI (optional — set API key in popup)',
  deepScanLabelPopup: 'Deep scan with AI (optional — needs API key below)',
  apiKeyLabel: 'Anthropic API key (stored in this browser only)',
  apiKeyPlaceholder: 'sk-ant-…',
  rescanBtn: 'Rescan page',
  openPanelBtn: 'Open panel on page',
  watchingSubtitle: 'Watching this page',
  tacticsFound: (n) => `${n} pressure tactic${n === 1 ? '' : 's'} found`,
  fabTitleIdle: 'Deflector — watching this page',
  fabTitleFindings: (n) => `${n} pressure tactic${n === 1 ? '' : 's'} — open panel`,
  fabTitleScanning: 'Deflector — scanning this page…',
  fabLiveFindings: (n) => `${n} pressure tactic${n === 1 ? '' : 's'} found`,
  fabLiveScanning: 'Scanning this page…',
  scanMessages: [
    'Reading the fine print…',
    'Checking for pressure language…',
    'Marking up the page…',
  ],
  fabHint: 'Pressure tactics show up here and on the page.',
  fabHintDismiss: 'Got it',
  matchStrength: (pct) => `${pct}% match strength`,
  plainAlternative: 'Plain-language alternative:',
  scanError: 'Scan failed — tap Rescan to try again.',
  scanErrorDetail: (msg) => `Scan failed — ${msg}`,
};

export const PAGE_TYPE_LABELS = {
  checkout: 'Checkout page',
  booking: 'Booking page',
  product: 'Product page',
  commerce: 'Shopping page',
  general: 'Web page',
};

export function formatPageContext(pageInfo) {
  if (!pageInfo?.pageType) return '';
  const label = PAGE_TYPE_LABELS[pageInfo.pageType] || pageInfo.pageType;
  return `Scanned as a ${label.toLowerCase()}`;
}
