import { getCategoryLabel } from './ruleEngine.js';
import { COPY } from './ui/copy.js';
import { escapeHtml, truncate } from './ui/dom.js';
import { formatFindingQuote } from './ui/textQuality.js';

export const CATEGORY_TINTS = {
  urgency: 'var(--deflector-cat-urgency)',
  scarcity: 'var(--deflector-cat-scarcity)',
  social_proof: 'var(--deflector-cat-social_proof)',
  misdirection: 'var(--deflector-cat-misdirection)',
  trick_question: 'var(--deflector-cat-trick_question)',
  hidden_cost: 'var(--deflector-cat-hidden_cost)',
  disguised_ad: 'var(--deflector-cat-disguised_ad)',
};

/** Boundary ring colors — outline only, no fill */
export const CATEGORY_HIGHLIGHT = {
  urgency: { color: 'rgba(196, 10, 0, 0.55)', accent: 'rgba(245, 13, 0, 0.5)' },
  scarcity: { color: 'rgba(168, 72, 72, 0.5)', accent: 'rgba(212, 100, 100, 0.48)' },
  social_proof: { color: 'rgba(61, 109, 138, 0.5)', accent: 'rgba(90, 148, 184, 0.5)' },
  misdirection: { color: 'rgba(107, 77, 138, 0.5)', accent: 'rgba(138, 106, 173, 0.48)' },
  trick_question: { color: 'rgba(168, 72, 72, 0.5)', accent: 'rgba(212, 100, 100, 0.48)' },
  hidden_cost: { color: 'rgba(154, 112, 48, 0.55)', accent: 'rgba(196, 146, 64, 0.5)' },
  disguised_ad: { color: 'rgba(74, 122, 66, 0.5)', accent: 'rgba(107, 159, 98, 0.48)' },
};

/** @type {HTMLElement | null} */
let overlayRoot = null;
/** @type {Map<string, { nodes: HTMLElement[], finding: object }>} */
const overlayEntries = new Map();
let repositionScheduled = false;
let scrollListenerBound = false;

function ensureOverlayRoot() {
  if (overlayRoot && document.contains(overlayRoot)) return overlayRoot;
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'deflector-overlay-root';
  document.documentElement.appendChild(overlayRoot);
  bindRepositionListeners();
  return overlayRoot;
}

function bindRepositionListeners() {
  if (scrollListenerBound) return;
  scrollListenerBound = true;
  window.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });
}

function scheduleReposition() {
  if (repositionScheduled) return;
  repositionScheduled = true;
  requestAnimationFrame(() => {
    repositionScheduled = false;
    repositionAll();
  });
}

function repositionAll() {
  for (const { nodes, finding } of overlayEntries.values()) {
    if (!finding.element || !document.contains(finding.element)) continue;
    const rects = getHighlightRects(finding.element, finding.matchedText);
    const washes = nodes.filter((n) => n.classList.contains('deflector-crayon-wash'));
    const pill = nodes.find((n) => n.classList.contains('deflector-annotation-pill'));
    washes.forEach((wash, i) => {
      if (rects[i]) applyRect(wash, rects[i]);
    });
    if (pill && rects[0]) applyPillRect(pill, rects[0]);
  }
}

function getHighlightRects(el, matchedText) {
  const rects = [];

  if (matchedText && el.textContent) {
    const text = el.textContent;
    const idx = text.toLowerCase().indexOf(matchedText.toLowerCase());
    if (idx >= 0 && el.firstChild) {
      try {
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let charCount = 0;
        let startNode = null;
        let startOffset = 0;
        let endNode = null;
        let endOffset = 0;
        const endIdx = idx + matchedText.length;

        while (walker.nextNode()) {
          const node = walker.currentNode;
          const len = node.textContent?.length || 0;
          if (!startNode && charCount + len > idx) {
            startNode = node;
            startOffset = idx - charCount;
          }
          if (!endNode && charCount + len >= endIdx) {
            endNode = node;
            endOffset = endIdx - charCount;
            break;
          }
          charCount += len;
        }

        if (startNode && endNode) {
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);
          for (const r of range.getClientRects()) {
            if (r.width > 2 && r.height > 2) rects.push(r);
          }
        }
      } catch {
        /* fall through */
      }
    }
  }

  if (rects.length === 0) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push(r);
  }

  return rects;
}

function applyRect(node, rect) {
  node.style.top = `${rect.top + window.scrollY - 4}px`;
  node.style.left = `${rect.left + window.scrollX - 5}px`;
  node.style.width = `${rect.width + 10}px`;
  node.style.height = `${rect.height + 8}px`;
}

function applyPillRect(pill, rect) {
  const flipBelow = rect.top < 40;
  const maxLeft = Math.max(8, window.innerWidth - 36);
  if (flipBelow) {
    pill.style.top = `${rect.bottom + window.scrollY + 6}px`;
    pill.classList.add('deflector-pill-below');
  } else {
    pill.style.top = `${rect.top + window.scrollY - 30}px`;
    pill.classList.remove('deflector-pill-below');
  }
  pill.style.left = `${Math.min(Math.max(8, rect.left + window.scrollX), maxLeft)}px`;
}

/**
 * @param {object} finding
 * @param {number} [index] 1-based display number for pill badge
 */
export function renderOverlayHighlight(finding, index = 0) {
  if (!finding.element || !document.contains(finding.element)) return;
  if (overlayEntries.has(finding.id)) return;

  const root = ensureOverlayRoot();
  const category = finding.category;
  const hl = CATEGORY_HIGHLIGHT[category] || CATEGORY_HIGHLIGHT.urgency;
  const label = getCategoryLabel(category);
  const tipId = `deflector-tip-${finding.id}`;

  const rects = getHighlightRects(finding.element, finding.matchedText);
  if (rects.length === 0) return;

  const nodes = [];
  const washDelay = index > 0 ? Math.min((index - 1) * 60, 360) : 0;
  const pillDelay = washDelay + 70;

  for (const rect of rects) {
    const wash = document.createElement('div');
    wash.className = `deflector-crayon-wash deflector-crayon-wash--${category}`;
    wash.dataset.deflectorId = finding.id;
    wash.setAttribute('aria-hidden', 'true');
    wash.style.setProperty('--deflector-crayon-color', hl.color);
    const rot = (((finding.id.charCodeAt(finding.id.length - 1) || 0) + index * 3) % 16 - 8) / 10;
    wash.style.setProperty('--deflector-crayon-rotate', `${rot}deg`);
    wash.style.animationDelay = `${washDelay}ms`;
    applyRect(wash, rect);
    root.appendChild(wash);
    nodes.push(wash);
  }

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'deflector-annotation-pill';
  pill.dataset.deflectorId = finding.id;
  pill.dataset.category = category;
  pill.style.animationDelay = `${pillDelay}ms`;
  const numBadge = index > 0
    ? `<span class="deflector-pill-num" aria-hidden="true">${index}</span>`
    : '';
  pill.innerHTML = numBadge;
  pill.setAttribute('aria-label', index > 0 ? `${index}. ${label}: ${finding.explanation}` : `${label}: ${finding.explanation}`);
  pill.setAttribute('aria-describedby', tipId);
  pill.style.setProperty('--deflector-pill-tint', hl.accent);
  applyPillRect(pill, rects[0]);
  root.appendChild(pill);
  nodes.push(pill);

  const tooltip = document.createElement('div');
  tooltip.className = 'deflector-annotation-tooltip';
  tooltip.id = tipId;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <p>${escapeHtml(finding.explanation)}</p>
    <p class="deflector-tip-match">"${escapeHtml(formatFindingQuote(finding, 120))}"</p>
    <p class="deflector-tip-rewrite"><em>${COPY.plainAlternative}</em> ${escapeHtml(finding.rewrite)}</p>
    <p class="deflector-tip-meta">${COPY.matchStrength(Math.round(finding.confidence * 100))}</p>
  `;
  pill.appendChild(tooltip);

  pill.addEventListener('mouseenter', () => pill.classList.add('deflector-pill-active'));
  pill.addEventListener('mouseleave', () => pill.classList.remove('deflector-pill-active'));
  pill.addEventListener('focus', () => pill.classList.add('deflector-pill-active'));
  pill.addEventListener('blur', () => pill.classList.remove('deflector-pill-active'));
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('deflector:open-finding', { detail: { id: finding.id } }));
  });

  overlayEntries.set(finding.id, { nodes, finding });
}

/** Scroll to a finding on the page and pulse its highlight wash. */
export function focusFindingOnPage(id) {
  const entry = overlayEntries.get(id);
  if (!entry) return;

  const { nodes, finding } = entry;
  finding.element?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  for (const node of nodes) {
    if (!node.classList.contains('deflector-crayon-wash')) continue;
    node.classList.remove('deflector-wash-pulse');
    void node.offsetWidth;
    node.classList.add('deflector-wash-pulse');
  }

  const pill = nodes.find((n) => n.classList.contains('deflector-annotation-pill'));
  if (pill) {
    pill.classList.add('deflector-pill-active');
    setTimeout(() => pill.classList.remove('deflector-pill-active'), 2400);
  }
}

export function clearOverlayHighlights() {
  for (const { nodes } of overlayEntries.values()) {
    for (const n of nodes) n.remove();
  }
  overlayEntries.clear();
  overlayRoot?.remove();
  overlayRoot = null;
}

/** Show or hide page washes/pills — visible only while the sidebar is open. */
export function setOverlayVisible(visible) {
  if (!overlayRoot || !document.contains(overlayRoot)) return;
  overlayRoot.classList.toggle('deflector-overlay-visible', visible);
  if (visible) {
    overlayRoot.style.removeProperty('visibility');
  } else {
    overlayRoot.style.setProperty('visibility', 'hidden', 'important');
  }
  for (const { nodes } of overlayEntries.values()) {
    for (const n of nodes) {
      if (visible) {
        n.style.removeProperty('visibility');
        n.style.removeProperty('opacity');
        n.style.removeProperty('pointer-events');
      } else {
        n.style.setProperty('visibility', 'hidden', 'important');
        n.style.setProperty('opacity', '0', 'important');
        n.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }
}

export { getLogoMarkHtml } from './ui/logo.js';
