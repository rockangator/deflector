import { normalizeHost } from './pageClassifier.js';
import { getElementText, isContentElement, isHumanReadableText, pickReadableSnippet } from './ui/textQuality.js';

/** @typedef {{ id: string, category: string, matchedText: string, confidence: number, ruleId: string, explanation: string, rewrite: string, element?: Element, source: string, tier: 'rule' | 'structural' | 'site' | 'llm' }} Finding */

let compiledFilters = null;
let priceSnapshot = null;

const CATEGORY_LABELS = {
  urgency: 'Urgency',
  scarcity: 'Scarcity',
  social_proof: 'Social proof',
  misdirection: 'Misdirection',
  trick_question: 'Trick question',
  hidden_cost: 'Hidden cost',
  disguised_ad: 'Disguised ad',
};

/**
 * @param {object} filters
 */
function compileTextRules(filters) {
  return (filters.textRules || []).map((rule) => ({
    ...rule,
    regex: new RegExp(rule.pattern, 'i'),
  }));
}

/**
 * @returns {Promise<object>}
 */
export async function loadFilters() {
  if (compiledFilters) return compiledFilters;

  const url = chrome.runtime.getURL('filters/generic.json');
  const res = await fetch(url);
  const data = await res.json();
  compiledFilters = {
    ...data,
    compiledTextRules: compileTextRules(data),
  };
  return compiledFilters;
}

/**
 * @param {string} host
 * @param {object} filters
 */
function isHostDisabled(host, filters) {
  const h = normalizeHost(host);
  for (const ex of filters.exceptions || []) {
    if (ex.action === 'disable' && ex.host) {
      const target = normalizeHost(ex.host);
      if (h === target || h.endsWith('.' + target)) return true;
    }
  }
  return false;
}

/**
 * @param {string} text
 * @param {string} host
 * @param {object} filters
 */
function isTextExcepted(text, host, filters) {
  const h = normalizeHost(host);
  for (const ex of filters.exceptions || []) {
    if (ex.action !== 'ignore' || !ex.pattern) continue;
    if (ex.host) {
      const target = normalizeHost(ex.host);
      if (h !== target && !h.endsWith('.' + target)) continue;
    }
    if (new RegExp(ex.pattern, 'i').test(text)) return true;
  }
  return false;
}

/**
 * @param {Element} el
 */
function hasNumericCountdown(el) {
  const text = el.textContent || '';
  if (/\d{1,2}:\d{2}(:\d{2})?/.test(text)) return true;
  if (/\d+\s*(hours?|minutes?|seconds?|mins?|secs?)\s*(left|remaining)/i.test(text)) return true;
  if (/\d+/.test(text) && /countdown|timer|expires|left/i.test(text)) return true;
  return false;
}

/**
 * @param {Element} el
 */
function nearMarketingCopy(el) {
  const container = el.closest('form, label, [class*="consent"], [class*="newsletter"], [class*="subscribe"], [class*="marketing"], [class*="signup"]')
    || el.parentElement?.closest('label')
    || el.parentElement;
  if (!container) return false;
  const text = container.textContent || '';
  return /\b(email|newsletter|subscribe|promotion|offer|marketing|updates|sms|text message)\b/i.test(text);
}

/**
 * @param {Element} el
 */
function hiddenOrTinyLabel(el) {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const fontSize = parseFloat(style.fontSize) || 16;
  const offScreen = rect.width < 2 || rect.height < 2;
  const tiny = fontSize <= 8;
  const lowOpacity = parseFloat(style.opacity) < 0.3;
  const text = (el.textContent || '').trim();
  const sponsored = /\b(sponsored|advertisement|ad|promoted)\b/i.test(text);
  return sponsored && (offScreen || tiny || lowOpacity);
}

/**
 * @param {Element} el
 */
function lowContrastSecondaryCta(el) {
  const text = (el.textContent || '').trim();
  if (!/\b(no|skip|decline|cancel|maybe later|not now|close|dismiss)\b/i.test(text)) return false;

  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 16;
  const isLink = el.tagName === 'A';
  const grayish = /128,\s*128,\s*128|999|aaa|888|777|666/i.test(style.color);
  return fontSize <= 13 || isLink || grayish;
}

/**
 * @param {Element} el
 */
function activityToastPattern(el) {
  const text = (el.textContent || '').trim();
  return (
    /\b(bought|purchased|ordered|booked|viewing|looking)\b/i.test(text)
    && text.length < 200
  );
}

const STRUCTURAL_CHECKS = {
  hasNumericCountdown,
  nearMarketingCopy,
  hiddenOrTinyLabel,
  lowContrastSecondaryCta,
  activityToastPattern,
};

/**
 * @param {Document} doc
 */
export function snapshotCheckoutPrice(doc) {
  const priceEl = doc.querySelector('[itemprop=price], [data-testid*="total"], [class*="order-total"], [class*="grand-total"]');
  if (!priceEl) return null;
  const text = priceEl.textContent?.replace(/[^\d.,]/g, '') || '';
  const value = parseFloat(text.replace(',', ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {Document} doc
 */
function detectHiddenCostIncrease(doc) {
  const current = snapshotCheckoutPrice(doc);
  if (current == null || priceSnapshot == null) return null;
  if (current > priceSnapshot * 1.01) {
    return {
      id: 'hidden-cost-step',
      category: 'hidden_cost',
      confidence: 0.85,
      explanation: 'Total price appears higher than a previously observed amount on this tab.',
      rewrite: 'Review added fees or charges',
    };
  }
  return null;
}

/**
 * @param {typeof import('./candidateExtractor.js').extractCandidates extends Function ? ReturnType<typeof import('./candidateExtractor.js').extractCandidates> : never} candidates
 * @param {object} filters
 * @param {string} host
 * @param {object|null} siteAdapter
 * @param {Document} doc
 * @param {{ verbose?: boolean, deep?: boolean }} options
 * @returns {Finding[]}
 */
export function runRuleEngine(candidates, filters, host, siteAdapter, doc, options = {}) {
  if (isHostDisabled(host, filters)) return [];

  const minConfidence = options.verbose ? 0.6 : 0.8;
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Set<string>} */
  const dedupe = new Set();

  for (const candidate of candidates) {
    const { element, text, source } = candidate;
    if (!isContentElement(element) || !isHumanReadableText(text)) continue;
    if (isTextExcepted(text, host, filters)) continue;

    for (const rule of filters.compiledTextRules) {
      const match = text.match(rule.regex);
      if (!match) continue;
      if (rule.confidence < minConfidence && !options.deep) continue;

      const matchedText = pickReadableSnippet(match[0], 160);
      if (!matchedText) continue;

      const key = `${rule.id}:${matchedText.toLowerCase()}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      findings.push({
        id: `${rule.id}-${findings.length}`,
        category: rule.category,
        matchedText,
        confidence: rule.confidence,
        ruleId: rule.id,
        explanation: rule.explanation || `Matches ${CATEGORY_LABELS[rule.category] || rule.category} pattern.`,
        rewrite: rule.rewrite || 'Review this claim independently',
        element,
        source,
        tier: 'rule',
      });
    }
  }

  for (const rule of filters.structuralRules || []) {
    try {
      for (const el of doc.querySelectorAll(rule.selector)) {
        if (!isContentElement(el)) continue;
        const checkFn = STRUCTURAL_CHECKS[rule.check];
        if (checkFn && !checkFn(el)) continue;
        if (rule.confidence < minConfidence && !options.deep) continue;

        const text = pickReadableSnippet(getElementText(el), 120);
        if (!text) continue;
        const key = `struct:${rule.id}:${text.slice(0, 40)}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);

        findings.push({
          id: `${rule.id}-${findings.length}`,
          category: rule.category,
          matchedText: text,
          confidence: rule.confidence,
          ruleId: rule.id,
          explanation: rule.explanation,
          rewrite: rule.rewrite,
          element: el,
          source: 'structural',
          tier: 'structural',
        });
      }
    } catch {
      /* selector errors */
    }
  }

  if (siteAdapter?.siteRules) {
    for (const rule of siteAdapter.siteRules) {
      for (const selector of rule.selectors) {
        try {
          for (const el of doc.querySelectorAll(selector)) {
            if (!isContentElement(el)) continue;
            if (rule.confidence < minConfidence && !options.deep) continue;
            const text = pickReadableSnippet(getElementText(el), 160);
            if (!text) continue;
            const key = `site:${rule.id}:${text.slice(0, 40)}`;
            if (dedupe.has(key)) continue;
            dedupe.add(key);

            findings.push({
              id: `${rule.id}-${findings.length}`,
              category: rule.category,
              matchedText: text,
              confidence: rule.confidence,
              ruleId: rule.id,
              explanation: rule.explanation,
              rewrite: rule.rewrite,
              element: el,
              source: 'site',
              tier: 'site',
            });
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  const hiddenCost = detectHiddenCostIncrease(doc);
  if (hiddenCost && hiddenCost.confidence >= minConfidence) {
    findings.push({
      id: `hidden-cost-${findings.length}`,
      category: hiddenCost.category,
      matchedText: 'Price increase detected',
      confidence: hiddenCost.confidence,
      ruleId: hiddenCost.id,
      explanation: hiddenCost.explanation,
      rewrite: hiddenCost.rewrite,
      source: 'structural',
      tier: 'structural',
    });
  }

  return findings.sort((a, b) => b.confidence - a.confidence);
}

/**
 * @param {Document} doc
 */
export function rememberPriceBaseline(doc) {
  const price = snapshotCheckoutPrice(doc);
  if (price != null) priceSnapshot = price;
}

export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

export { CATEGORY_LABELS };
