import { normalizeHost } from './pageClassifier.js';
import { getElementText, isHumanReadableText } from './ui/textQuality.js';

const GENERIC_REGIONS = [
  '[role=dialog]',
  '[role=alertdialog]',
  '[aria-modal=true]',
  '.modal',
  '[class*="modal"]',
  '[class*="popup"]',
  '[class*="overlay"]',
  '[class*="banner"]',
  '[class*="toast"]',
  '[class*="notification"]',
  '[class*="sticky"]',
  '[class*="urgency"]',
  '[class*="countdown"]',
  '[class*="promo"]',
  '[class*="deal"]',
  '[class*="offer"]',
  '[class*="consent"]',
  '[class*="cookie"]',
  'form',
  'aside',
  'header',
  '[class*="price"]',
  '[class*="checkout"]',
  '[class*="cart"]',
  '[itemprop=price]',
  '[data-testid*="price"]',
  '[class*="buybox"]',
  '[class*="product"]',
];

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE']);

/**
 * @param {Element} el
 */
function isVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export { getElementText } from './ui/textQuality.js';

/**
 * @param {Element} container
 * @returns {{ element: Element, text: string, source: string }[]}
 */
function extractCtaPairs(container) {
  const buttons = [...container.querySelectorAll('button, a, [role=button], input[type=submit]')].filter(isVisible);
  if (buttons.length < 2) return [];

  const group = buttons
    .map((el) => ({ element: el, text: (el.textContent || el.value || '').trim() }))
    .filter((b) => b.text.length >= 4);

  if (group.length < 2) return [];

  return group.map((b) => ({
    element: b.element,
    text: b.text,
    source: 'cta_pair',
  }));
}

/**
 * @param {string} host
 * @param {object|null} siteAdapter
 */
function getRegionSelectors(host, siteAdapter) {
  const selectors = [...GENERIC_REGIONS];
  if (siteAdapter?.candidateSelectors) {
    selectors.unshift(...siteAdapter.candidateSelectors);
  }
  return [...new Set(selectors)];
}

/**
 * @param {Document} doc
 * @param {string} host
 * @param {object|null} siteAdapter
 * @param {string} [selectionText]
 */
export function extractCandidates(doc, host, siteAdapter = null, selectionText = '') {
  /** @type {Map<Element, { element: Element, text: string, source: string }>} */
  const seen = new Map();

  if (selectionText?.trim()) {
    const text = selectionText.trim();
    const sel = doc.getSelection?.();
    const anchor = sel?.anchorNode?.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement
      : sel?.anchorNode instanceof Element
        ? sel.anchorNode
        : doc.body;

    if (anchor) {
      seen.set(anchor, { element: anchor, text, source: 'selection' });
    }
    return [...seen.values()];
  }

  const selectors = getRegionSelectors(host, siteAdapter);

  for (const selector of selectors) {
    try {
      for (const region of doc.querySelectorAll(selector)) {
        if (!isVisible(region)) continue;

        const text = getElementText(region);
        if (text.length >= 8 && text.length <= 2000 && isHumanReadableText(text)) {
          if (!seen.has(region) || (seen.get(region).text.length < text.length)) {
            seen.set(region, { element: region, text, source: 'region' });
          }
        }

        for (const cta of extractCtaPairs(region)) {
          if (!seen.has(cta.element)) seen.set(cta.element, cta);
        }
      }
    } catch {
      /* invalid selector on some pages */
    }
  }

  // Fallback: bounded scan of visible leaf-ish elements if too few candidates on commerce pages
  if (seen.size < 3) {
    const fallback = doc.querySelectorAll('main, [role=main], #main, #content, .content, body');
    const root = fallback[0] || doc.body;
    const blocks = root.querySelectorAll('p, span, li, label, button, a, h1, h2, h3, h4, div');
    let count = 0;
    for (const el of blocks) {
      if (count >= 40) break;
      if (!isVisible(el) || seen.has(el)) continue;
      const text = getElementText(el);
      if (text.length >= 12 && text.length <= 400 && isHumanReadableText(text)) {
        seen.set(el, { element: el, text, source: 'fallback' });
        count++;
      }
    }
  }

  return [...seen.values()];
}

/**
 * @param {string} host
 */
export async function loadSiteAdapter(host) {
  const normalized = normalizeHost(host);
  const adapters = ['amazon', 'booking'];

  for (const name of adapters) {
    try {
      const url = chrome.runtime.getURL(`filters/sites/${name}.json`);
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const hosts = [data.host, ...(data.hostAliases || [])].map(normalizeHost);
      if (hosts.some((h) => normalized === h || normalized.endsWith('.' + h))) {
        return data;
      }
    } catch {
      /* skip */
    }
  }

  return null;
}
