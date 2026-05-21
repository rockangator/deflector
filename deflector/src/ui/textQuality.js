import { truncate } from './dom.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE']);
const CODE_LIKE = /^\s*[.#][\w-]+\s*\{|[\w-]+\s*:\s*[^;{]+;\s*[\w-]+\s*:/;

/**
 * Visible text only — skips script/style and hidden subtrees.
 * @param {Element} root
 * @returns {string}
 */
export function getElementText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      while (parent) {
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent instanceof HTMLElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
        }
        parent = parent.parentElement;
      }
      const text = node.textContent?.trim();
      if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts = [];
  let node;
  while ((node = walker.nextNode())) {
    parts.push(node.textContent.trim());
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * True when text looks like user-facing copy, not CSS/code/minified markup.
 * @param {string} text
 */
export function isHumanReadableText(text) {
  const sample = String(text ?? '').trim();
  if (sample.length < 3) return false;
  if (CODE_LIKE.test(sample)) return false;
  if (/\{[^}]*:[^}]*;/.test(sample) && (sample.match(/;/g)?.length ?? 0) >= 2) return false;

  const letters = (sample.match(/[a-zA-Z]/g) || []).length;
  const spaces = (sample.match(/\s/g) || []).length;
  if (letters / sample.length < 0.3 && sample.length > 16) return false;
  if (spaces === 0 && sample.length > 24 && letters / sample.length < 0.5) return false;

  return true;
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
export function pickReadableSnippet(text, maxLen = 120) {
  const sample = String(text ?? '').trim();
  if (!sample) return '';

  if (isHumanReadableText(sample)) return truncate(sample, maxLen);

  const sentences = sample.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (isHumanReadableText(sentence)) return truncate(sentence, maxLen);
  }

  const chunks = sample.split(/\s+/).filter(Boolean);
  const readable = [];
  for (const chunk of chunks) {
    if (!isHumanReadableText(chunk)) continue;
    readable.push(chunk);
    const joined = readable.join(' ');
    if (joined.length >= 24) return truncate(joined, maxLen);
  }

  return readable.length ? truncate(readable.join(' '), maxLen) : '';
}

/**
 * Quote text for sidebar/tooltip — never surface CSS or code blobs.
 * @param {{ matchedText?: string, element?: Element, explanation?: string }} finding
 * @param {number} [maxLen]
 */
export function formatFindingQuote(finding, maxLen = 100) {
  const matched = pickReadableSnippet(finding.matchedText, maxLen);
  if (matched) return matched;

  if (finding.element instanceof Element) {
    const visible = pickReadableSnippet(getElementText(finding.element), maxLen);
    if (visible) return visible;
  }

  const fallback = pickReadableSnippet(finding.explanation, maxLen);
  return fallback || 'Pressure tactic on this page';
}

/**
 * Skip candidates/findings anchored on non-content elements.
 * @param {Element | null | undefined} el
 */
export function isContentElement(el) {
  if (!(el instanceof Element)) return false;
  if (SKIP_TAGS.has(el.tagName)) return false;
  let node = el;
  while (node) {
    if (SKIP_TAGS.has(node.tagName)) return false;
    node = node.parentElement;
  }
  return true;
}
