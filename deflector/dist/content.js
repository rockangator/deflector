(() => {
  // src/pageClassifier.js
  var COMMERCE_HOSTS = [
    "amazon.com",
    "amazon.co.uk",
    "amazon.de",
    "amazon.fr",
    "amazon.ca",
    "ebay.com",
    "walmart.com",
    "target.com",
    "bestbuy.com",
    "etsy.com",
    "booking.com",
    "expedia.com",
    "hotels.com",
    "airbnb.com",
    "kayak.com",
    "shopify.com",
    "aliexpress.com",
    "wish.com",
    "wayfair.com",
    "overstock.com",
    "nike.com",
    "adidas.com",
    "zara.com",
    "asos.com",
    "shein.com",
    "ticketmaster.com",
    "stubhub.com",
    "vrbo.com",
    "priceline.com"
  ];
  var DISABLED_HOSTS = [
    "wikipedia.org",
    "github.com",
    "stackoverflow.com",
    "google.com",
    "docs.google.com",
    "mail.google.com",
    "outlook.com",
    "notion.so"
  ];
  var CHECKOUT_PATHS = [
    "/checkout",
    "/cart",
    "/basket",
    "/bag",
    "/payment",
    "/pay",
    "/order/review",
    "/purchase",
    "/billing"
  ];
  var PRODUCT_PATHS = [
    "/product",
    "/products/",
    "/p/",
    "/dp/",
    "/item/",
    "/listing/",
    "/shop/",
    "/buy/",
    "/pd/",
    "/sku/"
  ];
  var BOOKING_PATHS = [
    "/hotel",
    "/hotels/",
    "/flights/",
    "/flight/",
    "/rooms/",
    "/book/",
    "/reservation",
    "/stay/"
  ];
  function normalizeHost(hostname) {
    return hostname.replace(/^www\./, "").toLowerCase();
  }
  function hostMatchesList(host, list) {
    const h = normalizeHost(host);
    return list.some((entry) => h === entry || h.endsWith("." + entry));
  }
  function scoreUrlPath(url) {
    const path = url.pathname.toLowerCase();
    let score = 0;
    if (CHECKOUT_PATHS.some((p) => path.includes(p))) score += 40;
    if (PRODUCT_PATHS.some((p) => path.includes(p))) score += 30;
    if (BOOKING_PATHS.some((p) => path.includes(p))) score += 35;
    if (/\b(cart|checkout|basket|payment)\b/.test(path)) score += 25;
    return score;
  }
  function scoreSchemaOrg(doc) {
    let score = 0;
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || "");
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const type = item["@type"];
          const types = Array.isArray(type) ? type : [type];
          if (types.some((t) => /Product|Offer|AggregateOffer|Hotel|Flight/i.test(String(t)))) {
            score += 20;
          }
        }
      } catch {
      }
    }
    return Math.min(score, 30);
  }
  function scoreCommerceDom(doc) {
    let score = 0;
    const addToCart = [...doc.querySelectorAll("button, a, input[type=submit]")].some(
      (el) => /\b(add to (cart|bag|basket)|buy now|purchase)\b/i.test(el.textContent || el.value || "")
    );
    if (addToCart) score += 25;
    const paymentFields = doc.querySelector(
      'input[autocomplete*="cc"], input[name*="card"], input[id*="card"], iframe[src*="stripe"], iframe[src*="paypal"]'
    );
    if (paymentFields) score += 35;
    const priceEls = doc.querySelectorAll(
      '[itemprop=price], [data-testid*="price"], .price, [class*="Price"], [class*="price"]'
    );
    if (priceEls.length > 0) score += 15;
    const variantSelectors = doc.querySelectorAll(
      'select[name*="size"], select[name*="color"], [data-testid*="variant"], [class*="size-selector"]'
    );
    if (variantSelectors.length > 0) score += 10;
    const orderSummary = doc.querySelector(
      '[class*="order-summary"], [class*="OrderSummary"], [data-testid*="order-summary"], #order-summary'
    );
    if (orderSummary) score += 20;
    if (doc.querySelector("#buybox, #addToCart, #add-to-cart-button, #availability, [data-asin], #corePrice_feature_div")) {
      score += 20;
    }
    return Math.min(score, 50);
  }
  function computeRiskScore(location2, doc) {
    const host = normalizeHost(location2.hostname);
    let score = 0;
    if (hostMatchesList(host, DISABLED_HOSTS)) return 0;
    if (hostMatchesList(host, COMMERCE_HOSTS)) score += 35;
    score += scoreUrlPath(new URL(location2.href));
    score += scoreSchemaOrg(doc);
    score += scoreCommerceDom(doc);
    return Math.min(score, 100);
  }
  function isPriorityCommercePage(location2) {
    const host = normalizeHost(location2.hostname);
    if (!hostMatchesList(host, COMMERCE_HOSTS)) return false;
    const path = location2.pathname.toLowerCase();
    return PRODUCT_PATHS.some((p) => path.includes(p)) || CHECKOUT_PATHS.some((p) => path.includes(p)) || BOOKING_PATHS.some((p) => path.includes(p)) || /\/gp\/aw\//.test(path);
  }
  function defaultScanTrigger(riskScore, location2 = null) {
    if (riskScore >= 65) return "auto";
    if (location2 && isPriorityCommercePage(location2) && riskScore >= 30) return "auto";
    if (riskScore >= 30) return "manual";
    return "idle";
  }
  function shouldScan(siteMode2, riskScore, requestedTrigger = "auto", location2 = null) {
    if (siteMode2 === "off") return requestedTrigger === "manual" || requestedTrigger === "deep";
    if (requestedTrigger === "manual" || requestedTrigger === "deep") return true;
    if (siteMode2 === "always") return true;
    if (siteMode2 === "manual") return false;
    return defaultScanTrigger(riskScore, location2) === "auto";
  }
  function classifyPage(location2, doc, siteMode2 = "auto") {
    const riskScore = computeRiskScore(location2, doc);
    const trigger = defaultScanTrigger(riskScore, location2);
    const host = normalizeHost(location2.hostname);
    const disabled = hostMatchesList(host, DISABLED_HOSTS);
    return {
      host,
      riskScore,
      trigger,
      disabled,
      siteMode: siteMode2,
      pageType: inferPageType(location2, doc, riskScore)
    };
  }
  function inferPageType(location2, doc, riskScore) {
    const path = location2.pathname.toLowerCase();
    if (CHECKOUT_PATHS.some((p) => path.includes(p)) || doc.querySelector('input[autocomplete*="cc"]')) {
      return "checkout";
    }
    if (BOOKING_PATHS.some((p) => path.includes(p)) || /booking\.com|expedia|hotels\.com|airbnb/.test(location2.hostname)) {
      return "booking";
    }
    if (PRODUCT_PATHS.some((p) => path.includes(p)) || doc.querySelector("[itemprop=price]")) {
      return "product";
    }
    if (riskScore >= 50) return "commerce";
    return "general";
  }

  // src/ui/dom.js
  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function truncate2(s, n) {
    const text = String(s ?? "");
    return text.length > n ? `${text.slice(0, n)}\u2026` : text;
  }
  function findByDataId(container, id) {
    if (!container || id == null || id === "") return null;
    const target = String(id);
    for (const el of container.querySelectorAll("[data-id]")) {
      if (el.dataset.id === target) return el;
    }
    return null;
  }

  // src/ui/textQuality.js
  var SKIP_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME", "TEMPLATE"]);
  var CODE_LIKE = /^\s*[.#][\w-]+\s*\{|[\w-]+\s*:\s*[^;{]+;\s*[\w-]+\s*:/;
  function getElementText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node2) {
        let parent = node2.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        while (parent) {
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent instanceof HTMLElement) {
            const style = getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden") {
              return NodeFilter.FILTER_REJECT;
            }
          }
          parent = parent.parentElement;
        }
        const text = node2.textContent?.trim();
        if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const parts = [];
    let node;
    while (node = walker.nextNode()) {
      parts.push(node.textContent.trim());
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function isHumanReadableText(text) {
    const sample = String(text ?? "").trim();
    if (sample.length < 3) return false;
    if (CODE_LIKE.test(sample)) return false;
    if (/\{[^}]*:[^}]*;/.test(sample) && (sample.match(/;/g)?.length ?? 0) >= 2) return false;
    const letters = (sample.match(/[a-zA-Z]/g) || []).length;
    const spaces = (sample.match(/\s/g) || []).length;
    if (letters / sample.length < 0.3 && sample.length > 16) return false;
    if (spaces === 0 && sample.length > 24 && letters / sample.length < 0.5) return false;
    return true;
  }
  function pickReadableSnippet(text, maxLen = 120) {
    const sample = String(text ?? "").trim();
    if (!sample) return "";
    if (isHumanReadableText(sample)) return truncate2(sample, maxLen);
    const sentences = sample.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      if (isHumanReadableText(sentence)) return truncate2(sentence, maxLen);
    }
    const chunks = sample.split(/\s+/).filter(Boolean);
    const readable = [];
    for (const chunk of chunks) {
      if (!isHumanReadableText(chunk)) continue;
      readable.push(chunk);
      const joined = readable.join(" ");
      if (joined.length >= 24) return truncate2(joined, maxLen);
    }
    return readable.length ? truncate2(readable.join(" "), maxLen) : "";
  }
  function formatFindingQuote(finding, maxLen = 100) {
    const matched = pickReadableSnippet(finding.matchedText, maxLen);
    if (matched) return matched;
    if (finding.element instanceof Element) {
      const visible = pickReadableSnippet(getElementText(finding.element), maxLen);
      if (visible) return visible;
    }
    const fallback = pickReadableSnippet(finding.explanation, maxLen);
    return fallback || "Pressure tactic on this page";
  }
  function isContentElement(el) {
    if (!(el instanceof Element)) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    let node = el;
    while (node) {
      if (SKIP_TAGS.has(node.tagName)) return false;
      node = node.parentElement;
    }
    return true;
  }

  // src/candidateExtractor.js
  var GENERIC_REGIONS = [
    "[role=dialog]",
    "[role=alertdialog]",
    "[aria-modal=true]",
    ".modal",
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
    "form",
    "aside",
    "header",
    '[class*="price"]',
    '[class*="checkout"]',
    '[class*="cart"]',
    "[itemprop=price]",
    '[data-testid*="price"]',
    '[class*="buybox"]',
    '[class*="product"]'
  ];
  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function extractCtaPairs(container) {
    const buttons = [...container.querySelectorAll("button, a, [role=button], input[type=submit]")].filter(isVisible);
    if (buttons.length < 2) return [];
    const group = buttons.map((el) => ({ element: el, text: (el.textContent || el.value || "").trim() })).filter((b) => b.text.length >= 4);
    if (group.length < 2) return [];
    return group.map((b) => ({
      element: b.element,
      text: b.text,
      source: "cta_pair"
    }));
  }
  function getRegionSelectors(host, siteAdapter) {
    const selectors = [...GENERIC_REGIONS];
    if (siteAdapter?.candidateSelectors) {
      selectors.unshift(...siteAdapter.candidateSelectors);
    }
    return [...new Set(selectors)];
  }
  function extractCandidates(doc, host, siteAdapter = null, selectionText = "") {
    const seen = /* @__PURE__ */ new Map();
    if (selectionText?.trim()) {
      const text = selectionText.trim();
      const sel = doc.getSelection?.();
      const anchor = sel?.anchorNode?.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel?.anchorNode instanceof Element ? sel.anchorNode : doc.body;
      if (anchor) {
        seen.set(anchor, { element: anchor, text, source: "selection" });
      }
      return [...seen.values()];
    }
    const selectors = getRegionSelectors(host, siteAdapter);
    for (const selector of selectors) {
      try {
        for (const region of doc.querySelectorAll(selector)) {
          if (!isVisible(region)) continue;
          const text = getElementText(region);
          if (text.length >= 8 && text.length <= 2e3 && isHumanReadableText(text)) {
            if (!seen.has(region) || seen.get(region).text.length < text.length) {
              seen.set(region, { element: region, text, source: "region" });
            }
          }
          for (const cta of extractCtaPairs(region)) {
            if (!seen.has(cta.element)) seen.set(cta.element, cta);
          }
        }
      } catch {
      }
    }
    if (seen.size < 3) {
      const fallback = doc.querySelectorAll("main, [role=main], #main, #content, .content, body");
      const root = fallback[0] || doc.body;
      const blocks = root.querySelectorAll("p, span, li, label, button, a, h1, h2, h3, h4, div");
      let count = 0;
      for (const el of blocks) {
        if (count >= 40) break;
        if (!isVisible(el) || seen.has(el)) continue;
        const text = getElementText(el);
        if (text.length >= 12 && text.length <= 400 && isHumanReadableText(text)) {
          seen.set(el, { element: el, text, source: "fallback" });
          count++;
        }
      }
    }
    return [...seen.values()];
  }
  async function loadSiteAdapter(host) {
    const normalized = normalizeHost(host);
    const adapters = ["amazon", "booking"];
    for (const name of adapters) {
      try {
        const url = chrome.runtime.getURL(`filters/sites/${name}.json`);
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const hosts = [data.host, ...data.hostAliases || []].map(normalizeHost);
        if (hosts.some((h) => normalized === h || normalized.endsWith("." + h))) {
          return data;
        }
      } catch {
      }
    }
    return null;
  }

  // src/ruleEngine.js
  var compiledFilters = null;
  var priceSnapshot = null;
  var CATEGORY_LABELS = {
    urgency: "Urgency",
    scarcity: "Scarcity",
    social_proof: "Social proof",
    misdirection: "Misdirection",
    trick_question: "Trick question",
    hidden_cost: "Hidden cost",
    disguised_ad: "Disguised ad"
  };
  function compileTextRules(filters) {
    return (filters.textRules || []).map((rule) => ({
      ...rule,
      regex: new RegExp(rule.pattern, "i")
    }));
  }
  async function loadFilters() {
    if (compiledFilters) return compiledFilters;
    const url = chrome.runtime.getURL("filters/generic.json");
    const res = await fetch(url);
    const data = await res.json();
    compiledFilters = {
      ...data,
      compiledTextRules: compileTextRules(data)
    };
    return compiledFilters;
  }
  function isHostDisabled(host, filters) {
    const h = normalizeHost(host);
    for (const ex of filters.exceptions || []) {
      if (ex.action === "disable" && ex.host) {
        const target = normalizeHost(ex.host);
        if (h === target || h.endsWith("." + target)) return true;
      }
    }
    return false;
  }
  function isTextExcepted(text, host, filters) {
    const h = normalizeHost(host);
    for (const ex of filters.exceptions || []) {
      if (ex.action !== "ignore" || !ex.pattern) continue;
      if (ex.host) {
        const target = normalizeHost(ex.host);
        if (h !== target && !h.endsWith("." + target)) continue;
      }
      if (new RegExp(ex.pattern, "i").test(text)) return true;
    }
    return false;
  }
  function hasNumericCountdown(el) {
    const text = el.textContent || "";
    if (/\d{1,2}:\d{2}(:\d{2})?/.test(text)) return true;
    if (/\d+\s*(hours?|minutes?|seconds?|mins?|secs?)\s*(left|remaining)/i.test(text)) return true;
    if (/\d+/.test(text) && /countdown|timer|expires|left/i.test(text)) return true;
    return false;
  }
  function nearMarketingCopy(el) {
    const container = el.closest('form, label, [class*="consent"], [class*="newsletter"], [class*="subscribe"], [class*="marketing"], [class*="signup"]') || el.parentElement?.closest("label") || el.parentElement;
    if (!container) return false;
    const text = container.textContent || "";
    return /\b(email|newsletter|subscribe|promotion|offer|marketing|updates|sms|text message)\b/i.test(text);
  }
  function hiddenOrTinyLabel(el) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const fontSize = parseFloat(style.fontSize) || 16;
    const offScreen = rect.width < 2 || rect.height < 2;
    const tiny = fontSize <= 8;
    const lowOpacity = parseFloat(style.opacity) < 0.3;
    const text = (el.textContent || "").trim();
    const sponsored = /\b(sponsored|advertisement|ad|promoted)\b/i.test(text);
    return sponsored && (offScreen || tiny || lowOpacity);
  }
  function lowContrastSecondaryCta(el) {
    const text = (el.textContent || "").trim();
    if (!/\b(no|skip|decline|cancel|maybe later|not now|close|dismiss)\b/i.test(text)) return false;
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 16;
    const isLink = el.tagName === "A";
    const grayish = /128,\s*128,\s*128|999|aaa|888|777|666/i.test(style.color);
    return fontSize <= 13 || isLink || grayish;
  }
  function activityToastPattern(el) {
    const text = (el.textContent || "").trim();
    return /\b(bought|purchased|ordered|booked|viewing|looking)\b/i.test(text) && text.length < 200;
  }
  var STRUCTURAL_CHECKS = {
    hasNumericCountdown,
    nearMarketingCopy,
    hiddenOrTinyLabel,
    lowContrastSecondaryCta,
    activityToastPattern
  };
  function snapshotCheckoutPrice(doc) {
    const priceEl = doc.querySelector('[itemprop=price], [data-testid*="total"], [class*="order-total"], [class*="grand-total"]');
    if (!priceEl) return null;
    const text = priceEl.textContent?.replace(/[^\d.,]/g, "") || "";
    const value = parseFloat(text.replace(",", ""));
    return Number.isFinite(value) ? value : null;
  }
  function detectHiddenCostIncrease(doc) {
    const current = snapshotCheckoutPrice(doc);
    if (current == null || priceSnapshot == null) return null;
    if (current > priceSnapshot * 1.01) {
      return {
        id: "hidden-cost-step",
        category: "hidden_cost",
        confidence: 0.85,
        explanation: "Total price appears higher than a previously observed amount on this tab.",
        rewrite: "Review added fees or charges"
      };
    }
    return null;
  }
  function runRuleEngine(candidates, filters, host, siteAdapter, doc, options = {}) {
    if (isHostDisabled(host, filters)) return [];
    const minConfidence = options.verbose ? 0.6 : 0.8;
    const findings = [];
    const dedupe = /* @__PURE__ */ new Set();
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
          rewrite: rule.rewrite || "Review this claim independently",
          element,
          source,
          tier: "rule"
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
            source: "structural",
            tier: "structural"
          });
        }
      } catch {
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
                source: "site",
                tier: "site"
              });
            }
          } catch {
          }
        }
      }
    }
    const hiddenCost = detectHiddenCostIncrease(doc);
    if (hiddenCost && hiddenCost.confidence >= minConfidence) {
      findings.push({
        id: `hidden-cost-${findings.length}`,
        category: hiddenCost.category,
        matchedText: "Price increase detected",
        confidence: hiddenCost.confidence,
        ruleId: hiddenCost.id,
        explanation: hiddenCost.explanation,
        rewrite: hiddenCost.rewrite,
        source: "structural",
        tier: "structural"
      });
    }
    return findings.sort((a, b) => b.confidence - a.confidence);
  }
  function rememberPriceBaseline(doc) {
    const price = snapshotCheckoutPrice(doc);
    if (price != null) priceSnapshot = price;
  }
  function getCategoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
  }

  // src/ui/copy.js
  var SCAN_MODE_OPTIONS = `
  <option value="auto">Auto on shopping sites</option>
  <option value="manual">Only when I tap Rescan</option>
  <option value="always">Every time I open a page</option>
  <option value="off">Don't scan this site</option>
`;
  var COPY = {
    verboseLabel: "Show less certain matches (about 60\u201379% sure)",
    deepScanLabel: "Deep scan with AI (optional \u2014 set API key in popup)",
    deepScanLabelPopup: "Deep scan with AI (optional \u2014 needs API key below)",
    apiKeyLabel: "Anthropic API key (stored in this browser only)",
    apiKeyPlaceholder: "sk-ant-\u2026",
    rescanBtn: "Rescan page",
    openPanelBtn: "Open panel on page",
    watchingSubtitle: "Watching this page",
    tacticsFound: (n) => `${n} pressure tactic${n === 1 ? "" : "s"} found`,
    fabTitleIdle: "Deflector \u2014 watching this page",
    fabTitleFindings: (n) => `${n} pressure tactic${n === 1 ? "" : "s"} \u2014 open panel`,
    fabTitleScanning: "Deflector \u2014 scanning this page\u2026",
    fabLiveFindings: (n) => `${n} pressure tactic${n === 1 ? "" : "s"} found`,
    fabLiveScanning: "Scanning this page\u2026",
    scanMessages: [
      "Reading the fine print\u2026",
      "Checking for pressure language\u2026",
      "Marking up the page\u2026"
    ],
    fabHint: "Pressure tactics show up here and on the page.",
    fabHintDismiss: "Got it",
    matchStrength: (pct) => `${pct}% match strength`,
    plainAlternative: "Plain-language alternative:",
    scanError: "Scan failed \u2014 tap Rescan to try again.",
    scanErrorDetail: (msg) => `Scan failed \u2014 ${msg}`
  };

  // src/ui/logo.js
  var LOGO_ASSET = "src/ui/assets/logo-mark.png";
  var LOGO_SIZE_CHROME = 28;
  var LOGO_SIZE_FAB = 42;
  var FAB_TOP = "20vh";
  var FAB_RIGHT = "0";
  var FAB_SIZE = 56;
  var FAB_Z_INDEX = "2147483647";
  function getLogoUrl() {
    return chrome.runtime.getURL(LOGO_ASSET);
  }
  function pinLogoMark(el, variant = "default") {
    if (!el) return;
    const size = variant === "fab" ? LOGO_SIZE_FAB : LOGO_SIZE_CHROME;
    const url = getLogoUrl();
    el.style.setProperty("width", `${size}px`, "important");
    el.style.setProperty("height", `${size}px`, "important");
    el.style.setProperty("max-width", `${size}px`, "important");
    el.style.setProperty("max-height", `${size}px`, "important");
    el.style.setProperty("min-width", "0", "important");
    el.style.setProperty("min-height", "0", "important");
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("flex-shrink", "0", "important");
    el.style.setProperty("overflow", "hidden", "important");
    el.style.setProperty("background-image", `url("${url}")`, "important");
    el.style.setProperty("background-size", "contain", "important");
    el.style.setProperty("background-repeat", "no-repeat", "important");
    el.style.setProperty("background-position", "center", "important");
    el.style.setProperty("background-color", "transparent", "important");
    el.style.setProperty("border", "none", "important");
    el.style.setProperty("padding", "0", "important");
    el.style.setProperty("margin", "0", "important");
  }
  function pinFabPosition(el) {
    if (!el) return;
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("top", FAB_TOP, "important");
    el.style.setProperty("right", FAB_RIGHT, "important");
    el.style.setProperty("left", "auto", "important");
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("z-index", FAB_Z_INDEX, "important");
    el.style.setProperty("width", `${FAB_SIZE}px`, "important");
    el.style.setProperty("height", `${FAB_SIZE}px`, "important");
    el.style.setProperty("display", "flex", "important");
    el.style.setProperty("visibility", "visible", "important");
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("pointer-events", "auto", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("float", "none", "important");
    el.style.setProperty("transform", "none", "important");
  }
  function pinFabHintPosition(el) {
    if (!el) return;
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("top", `calc(${FAB_TOP} + ${FAB_SIZE}px + 12px)`, "important");
    el.style.setProperty("right", FAB_RIGHT, "important");
    el.style.setProperty("left", "auto", "important");
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("z-index", FAB_Z_INDEX, "important");
  }
  function getLogoMarkHtml({ variant = "default" } = {}) {
    const isFab = variant === "fab";
    const cls = isFab ? "deflector-logo-mark deflector-logo-mark--fab" : "deflector-logo-mark";
    return `<span class="${cls}" role="img" aria-hidden="true"></span>`;
  }

  // src/highlightOverlay.js
  var CATEGORY_TINTS = {
    urgency: "var(--deflector-cat-urgency)",
    scarcity: "var(--deflector-cat-scarcity)",
    social_proof: "var(--deflector-cat-social_proof)",
    misdirection: "var(--deflector-cat-misdirection)",
    trick_question: "var(--deflector-cat-trick_question)",
    hidden_cost: "var(--deflector-cat-hidden_cost)",
    disguised_ad: "var(--deflector-cat-disguised_ad)"
  };
  var CATEGORY_HIGHLIGHT = {
    urgency: { color: "rgba(196, 10, 0, 0.55)", accent: "rgba(245, 13, 0, 0.5)" },
    scarcity: { color: "rgba(168, 72, 72, 0.5)", accent: "rgba(212, 100, 100, 0.48)" },
    social_proof: { color: "rgba(61, 109, 138, 0.5)", accent: "rgba(90, 148, 184, 0.5)" },
    misdirection: { color: "rgba(107, 77, 138, 0.5)", accent: "rgba(138, 106, 173, 0.48)" },
    trick_question: { color: "rgba(168, 72, 72, 0.5)", accent: "rgba(212, 100, 100, 0.48)" },
    hidden_cost: { color: "rgba(154, 112, 48, 0.55)", accent: "rgba(196, 146, 64, 0.5)" },
    disguised_ad: { color: "rgba(74, 122, 66, 0.5)", accent: "rgba(107, 159, 98, 0.48)" }
  };
  var overlayRoot = null;
  var overlayEntries = /* @__PURE__ */ new Map();
  var repositionScheduled = false;
  var scrollListenerBound = false;
  function ensureOverlayRoot() {
    if (overlayRoot && document.contains(overlayRoot)) return overlayRoot;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "deflector-overlay-root";
    document.documentElement.appendChild(overlayRoot);
    bindRepositionListeners();
    return overlayRoot;
  }
  function bindRepositionListeners() {
    if (scrollListenerBound) return;
    scrollListenerBound = true;
    window.addEventListener("scroll", scheduleReposition, { capture: true, passive: true });
    window.addEventListener("resize", scheduleReposition, { passive: true });
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
      const washes = nodes.filter((n) => n.classList.contains("deflector-crayon-wash"));
      const pill = nodes.find((n) => n.classList.contains("deflector-annotation-pill"));
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
      pill.classList.add("deflector-pill-below");
    } else {
      pill.style.top = `${rect.top + window.scrollY - 30}px`;
      pill.classList.remove("deflector-pill-below");
    }
    pill.style.left = `${Math.min(Math.max(8, rect.left + window.scrollX), maxLeft)}px`;
  }
  function renderOverlayHighlight(finding, index = 0) {
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
      const wash = document.createElement("div");
      wash.className = `deflector-crayon-wash deflector-crayon-wash--${category}`;
      wash.dataset.deflectorId = finding.id;
      wash.setAttribute("aria-hidden", "true");
      wash.style.setProperty("--deflector-crayon-color", hl.color);
      const rot = (((finding.id.charCodeAt(finding.id.length - 1) || 0) + index * 3) % 16 - 8) / 10;
      wash.style.setProperty("--deflector-crayon-rotate", `${rot}deg`);
      wash.style.animationDelay = `${washDelay}ms`;
      applyRect(wash, rect);
      root.appendChild(wash);
      nodes.push(wash);
    }
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "deflector-annotation-pill";
    pill.dataset.deflectorId = finding.id;
    pill.dataset.category = category;
    pill.style.animationDelay = `${pillDelay}ms`;
    const numBadge = index > 0 ? `<span class="deflector-pill-num" aria-hidden="true">${index}</span>` : "";
    pill.innerHTML = numBadge;
    pill.setAttribute("aria-label", index > 0 ? `${index}. ${label}: ${finding.explanation}` : `${label}: ${finding.explanation}`);
    pill.setAttribute("aria-describedby", tipId);
    pill.style.setProperty("--deflector-pill-tint", hl.accent);
    applyPillRect(pill, rects[0]);
    root.appendChild(pill);
    nodes.push(pill);
    const tooltip = document.createElement("div");
    tooltip.className = "deflector-annotation-tooltip";
    tooltip.id = tipId;
    tooltip.setAttribute("role", "tooltip");
    tooltip.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <p>${escapeHtml(finding.explanation)}</p>
    <p class="deflector-tip-match">"${escapeHtml(formatFindingQuote(finding, 120))}"</p>
    <p class="deflector-tip-rewrite"><em>${COPY.plainAlternative}</em> ${escapeHtml(finding.rewrite)}</p>
    <p class="deflector-tip-meta">${COPY.matchStrength(Math.round(finding.confidence * 100))}</p>
  `;
    pill.appendChild(tooltip);
    pill.addEventListener("mouseenter", () => pill.classList.add("deflector-pill-active"));
    pill.addEventListener("mouseleave", () => pill.classList.remove("deflector-pill-active"));
    pill.addEventListener("focus", () => pill.classList.add("deflector-pill-active"));
    pill.addEventListener("blur", () => pill.classList.remove("deflector-pill-active"));
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("deflector:open-finding", { detail: { id: finding.id } }));
    });
    overlayEntries.set(finding.id, { nodes, finding });
  }
  function focusFindingOnPage(id) {
    const entry = overlayEntries.get(id);
    if (!entry) return;
    const { nodes, finding } = entry;
    finding.element?.scrollIntoView({ behavior: "smooth", block: "center" });
    for (const node of nodes) {
      if (!node.classList.contains("deflector-crayon-wash")) continue;
      node.classList.remove("deflector-wash-pulse");
      void node.offsetWidth;
      node.classList.add("deflector-wash-pulse");
    }
    const pill = nodes.find((n) => n.classList.contains("deflector-annotation-pill"));
    if (pill) {
      pill.classList.add("deflector-pill-active");
      setTimeout(() => pill.classList.remove("deflector-pill-active"), 2400);
    }
  }
  function clearOverlayHighlights() {
    for (const { nodes } of overlayEntries.values()) {
      for (const n of nodes) n.remove();
    }
    overlayEntries.clear();
    overlayRoot?.remove();
    overlayRoot = null;
  }
  function setOverlayVisible(visible) {
    if (!overlayRoot || !document.contains(overlayRoot)) return;
    overlayRoot.classList.toggle("deflector-overlay-visible", visible);
    if (visible) {
      overlayRoot.style.removeProperty("visibility");
    } else {
      overlayRoot.style.setProperty("visibility", "hidden", "important");
    }
    for (const { nodes } of overlayEntries.values()) {
      for (const n of nodes) {
        if (visible) {
          n.style.removeProperty("visibility");
          n.style.removeProperty("opacity");
          n.style.removeProperty("pointer-events");
        } else {
          n.style.setProperty("visibility", "hidden", "important");
          n.style.setProperty("opacity", "0", "important");
          n.style.setProperty("pointer-events", "none", "important");
        }
      }
    }
  }

  // src/ui/emptyState.js
  function getEmptyStateHtml() {
    return `
    <div class="deflector-empty-state">
      <h3 class="deflector-empty-title">Nothing flagged yet</h3>
      <p class="deflector-empty-lead">No pressure tactics on this scan.</p>
    </div>
  `;
  }

  // src/highlight.js
  var sidebarEl = null;
  var fabEl = null;
  var fabHintEl = null;
  var lastBadgeCount = -1;
  var scanMessageTimer = null;
  var scanMessageIndex = 0;
  var lastFindings = [];
  function renderFindings(findings, options = {}) {
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
  function getLastFindings() {
    return lastFindings;
  }
  function ensureSidebar() {
    if (sidebarEl) return sidebarEl;
    sidebarEl = document.createElement("aside");
    sidebarEl.id = "deflector-sidebar";
    sidebarEl.setAttribute("role", "complementary");
    sidebarEl.setAttribute("aria-label", "Deflector findings panel");
    sidebarEl.innerHTML = `
    <header class="deflector-sidebar-header">
      <div class="deflector-sidebar-brand">
        ${getLogoMarkHtml()}
        <div>
          <h2>Deflector</h2>
          <p class="deflector-sidebar-subtitle" id="deflector-sidebar-count"></p>
        </div>
      </div>
      <button type="button" id="deflector-sidebar-close" class="deflector-btn deflector-btn--secondary deflector-btn--icon" aria-label="Close findings panel">\xD7</button>
    </header>
    <div class="deflector-sidebar-body deflector-scrollbar-transparent"></div>
    <footer class="deflector-sidebar-settings">
      <button type="button" id="deflector-settings-toggle" class="deflector-settings-toggle" aria-expanded="false">
        Settings \u25BE
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
    pinLogoMark(sidebarEl.querySelector(".deflector-sidebar-brand .deflector-logo-mark"));
    sidebarEl.querySelector("#deflector-sidebar-close")?.addEventListener("click", closeSidebar);
    sidebarEl.querySelector("#deflector-settings-toggle")?.addEventListener("click", toggleSettingsPanel);
    sidebarEl.querySelector("#deflector-rescan-btn")?.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("deflector:rescan", { detail: { trigger: "manual" } }));
    });
    bindSettingsControls();
    bindSidebarKeyboard();
    return sidebarEl;
  }
  function bindSidebarKeyboard() {
    if (sidebarEl?.dataset.kbdBound) return;
    if (sidebarEl) sidebarEl.dataset.kbdBound = "1";
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !isSidebarOpen()) return;
      e.stopPropagation();
      closeSidebar();
      fabEl?.focus();
    });
  }
  function setRescanBusy(busy) {
    sidebarEl?.querySelector("#deflector-rescan-btn")?.toggleAttribute("disabled", busy);
    fabEl?.setAttribute("aria-busy", busy ? "true" : "false");
  }
  function announceFab(message, priority = "polite") {
    const live = fabEl?.querySelector("#deflector-fab-live");
    if (!live) return;
    live.setAttribute("aria-live", priority);
    live.textContent = message;
  }
  function toggleSettingsPanel() {
    const panel = sidebarEl?.querySelector("#deflector-settings-panel");
    const toggle = sidebarEl?.querySelector("#deflector-settings-toggle");
    if (!panel || !toggle) return;
    const open = !panel.classList.contains("deflector-settings-panel-open");
    panel.classList.toggle("deflector-settings-panel-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Settings \u25B4" : "Settings \u25BE";
  }
  function bindSettingsControls() {
    const modeEl = sidebarEl?.querySelector("#deflector-site-mode");
    const verboseEl = sidebarEl?.querySelector("#deflector-verbose");
    const deepEl = sidebarEl?.querySelector("#deflector-deep-scan");
    modeEl?.addEventListener("change", async () => {
      const host = normalizeHost(location.hostname);
      const stored = await chrome.storage.local.get(["siteModes"]);
      const siteModes = stored.siteModes || {};
      siteModes[host] = modeEl.value;
      await chrome.storage.local.set({ siteModes });
      document.dispatchEvent(new CustomEvent("deflector:settings-changed"));
    });
    verboseEl?.addEventListener("change", async () => {
      await chrome.storage.local.set({ verbose: verboseEl.checked });
      document.dispatchEvent(new CustomEvent("deflector:settings-changed"));
    });
    deepEl?.addEventListener("change", async () => {
      await chrome.storage.local.set({ deepScanEnabled: deepEl.checked });
      document.dispatchEvent(new CustomEvent("deflector:settings-changed"));
    });
  }
  function renderSidebar(findings) {
    ensureSidebar();
    const body = sidebarEl.querySelector(".deflector-sidebar-body");
    if (!body) return;
    sidebarEl.querySelector(".deflector-scan-error")?.remove();
    const countEl = sidebarEl.querySelector("#deflector-sidebar-count");
    if (countEl) {
      countEl.textContent = findings.length === 0 ? COPY.watchingSubtitle : COPY.tacticsFound(findings.length);
      countEl.classList.toggle("deflector-sidebar-subtitle--active", findings.length > 0);
      countEl.classList.toggle("deflector-sidebar-subtitle--clear", findings.length === 0);
    }
    sidebarEl?.classList.toggle("deflector-sidebar--has-findings", findings.length > 0);
    if (findings.length === 0) {
      body.innerHTML = getEmptyStateHtml();
    } else {
      const indexById = new Map(findings.map((f, i) => [f.id, i + 1]));
      body.innerHTML = `
      <ul class="deflector-findings-list">${findings.map((f) => {
        const num = indexById.get(f.id) || "";
        const quote = formatFindingQuote(f, 100);
        const pct = Math.round(f.confidence * 100);
        return `
        <li>
          <button type="button" class="deflector-finding" data-id="${escapeHtml(f.id)}" style="--deflector-finding-tint: ${CATEGORY_TINTS[f.category] || "var(--deflector-cat-urgency)"}; animation-delay: ${Math.min((num - 1) * 40, 200)}ms">
            <span class="deflector-finding-num" aria-hidden="true">${num}</span>
            <span class="deflector-finding-cat deflector-chip deflector-chip--${f.category}">${escapeHtml(getCategoryLabel(f.category))}</span>
            <p class="deflector-finding-text">"${escapeHtml(quote)}"</p>
            <p class="deflector-finding-explain">${escapeHtml(f.explanation)} <span class="deflector-finding-meta">${pct}% sure</span></p>
          </button>
        </li>`;
      }).join("")}</ul>`;
      bindFindingCardClicks(body);
    }
  }
  function bindFindingCardClicks(body) {
    body.querySelectorAll(".deflector-finding").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        if (!id) return;
        body.querySelectorAll(".deflector-finding--active").forEach((el) => {
          el.classList.remove("deflector-finding--active");
        });
        card.classList.add("deflector-finding--active");
        focusFindingOnPage(id);
      });
    });
  }
  document.addEventListener("deflector:open-finding", (e) => {
    openSidebar();
    const id = e.detail?.id;
    if (!id) return;
    requestAnimationFrame(() => {
      const card = sidebarEl ? findByDataId(sidebarEl, id) : null;
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      sidebarEl?.querySelectorAll(".deflector-finding--active").forEach((el) => {
        el.classList.remove("deflector-finding--active");
      });
      card?.classList.add("deflector-finding--active");
      focusFindingOnPage(id);
    });
  });
  async function syncSidebarSettings() {
    ensureSidebar();
    const host = normalizeHost(location.hostname);
    const stored = await chrome.storage.local.get(["siteModes", "verbose", "deepScanEnabled"]);
    const modeEl = sidebarEl?.querySelector("#deflector-site-mode");
    const verboseEl = sidebarEl?.querySelector("#deflector-verbose");
    const deepEl = sidebarEl?.querySelector("#deflector-deep-scan");
    if (modeEl) modeEl.value = stored.siteModes?.[host] || "auto";
    if (verboseEl) verboseEl.checked = !!stored.verbose;
    if (deepEl) deepEl.checked = !!stored.deepScanEnabled;
  }
  function clearHighlights() {
    clearOverlayHighlights();
  }
  function openSidebar() {
    ensureSidebar();
    syncSidebarSettings();
    sidebarEl?.classList.add("deflector-sidebar-open");
    setOverlayVisible(true);
  }
  function closeSidebar() {
    sidebarEl?.classList.remove("deflector-sidebar-open");
    setOverlayVisible(false);
  }
  function toggleSidebar(show) {
    ensureSidebar();
    const shouldShow = show ?? !sidebarEl?.classList.contains("deflector-sidebar-open");
    if (shouldShow) openSidebar();
    else closeSidebar();
  }
  function isSidebarOpen() {
    return sidebarEl?.classList.contains("deflector-sidebar-open") ?? false;
  }
  function initFab(visible, callbacks = {}) {
    if (!visible) {
      fabEl?.remove();
      fabEl = null;
      return;
    }
    if (!fabEl) {
      fabEl = document.createElement("button");
      fabEl.id = "deflector-fab";
      fabEl.type = "button";
      fabEl.title = COPY.fabTitleIdle;
      fabEl.setAttribute("aria-label", "Deflector \u2014 open findings panel");
      fabEl.innerHTML = `
      ${getLogoMarkHtml({ variant: "fab" })}
      <span class="deflector-fab-count" id="deflector-fab-count">0</span>
      <span class="deflector-sr-only" id="deflector-fab-live" aria-live="polite"></span>
    `;
      (document.body || document.documentElement).appendChild(fabEl);
      pinLogoMark(fabEl.querySelector(".deflector-logo-mark"), "fab");
      pinFabPosition(fabEl);
      fabEl.addEventListener("click", () => {
        dismissFabHint(true);
        if (callbacks.onToggle) callbacks.onToggle();
        else toggleSidebar();
      });
      maybeShowFabHint();
    }
    fabEl.style.display = "flex";
    pinFabPosition(fabEl);
  }
  var FAB_HINT_KEY = "fabHintSeen";
  async function maybeShowFabHint() {
    if (!fabEl || fabHintEl) return;
    try {
      const stored = await chrome.storage.local.get([FAB_HINT_KEY]);
      if (stored[FAB_HINT_KEY]) return;
    } catch {
      return;
    }
    fabHintEl = document.createElement("div");
    fabHintEl.id = "deflector-fab-hint";
    fabHintEl.className = "deflector-fab-hint deflector-panel deflector-panel--paper deflector-panel--pad-sm";
    fabHintEl.setAttribute("role", "status");
    fabHintEl.innerHTML = `
    <p class="deflector-fab-hint-text">${COPY.fabHint}</p>
    <button type="button" class="deflector-btn deflector-btn--primary deflector-btn--compact deflector-fab-hint-dismiss" aria-label="Dismiss tip">${COPY.fabHintDismiss}</button>
  `;
    document.documentElement.appendChild(fabHintEl);
    pinFabHintPosition(fabHintEl);
    fabHintEl.querySelector(".deflector-fab-hint-dismiss")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissFabHint(true);
    });
    requestAnimationFrame(() => {
      fabHintEl?.classList.add("deflector-fab-hint-visible");
    });
  }
  async function dismissFabHint(persist = false) {
    if (!fabHintEl) return;
    fabHintEl.classList.remove("deflector-fab-hint-visible");
    const el = fabHintEl;
    fabHintEl = null;
    setTimeout(() => el.remove(), 280);
    if (persist) {
      try {
        await chrome.storage.local.set({ [FAB_HINT_KEY]: true });
      } catch {
      }
    }
  }
  function hideFab() {
    if (fabEl) fabEl.style.display = "none";
  }
  function updateFabBadge(count) {
    if (!fabEl) return;
    const badge = fabEl.querySelector("#deflector-fab-count");
    if (!badge) return;
    if (count !== lastBadgeCount) {
      if (count > lastBadgeCount && lastBadgeCount >= 0) {
        badge.classList.remove("deflector-fab-count-pop");
        void badge.offsetWidth;
        badge.classList.add("deflector-fab-count-pop");
      }
      if (count > 0 && lastBadgeCount === 0) {
        fabEl.classList.remove("deflector-fab-first-find");
        void fabEl.offsetWidth;
        fabEl.classList.add("deflector-fab-first-find");
        setTimeout(() => fabEl?.classList.remove("deflector-fab-first-find"), 900);
      }
      lastBadgeCount = count;
    }
    badge.textContent = String(count);
    badge.classList.toggle("deflector-fab-count-zero", count === 0);
    fabEl.classList.toggle("deflector-fab-has-findings", count > 0);
    fabEl.title = count > 0 ? COPY.fabTitleFindings(count) : COPY.fabTitleIdle;
    const live = fabEl.querySelector("#deflector-fab-live");
    if (live && count > 0) live.textContent = COPY.fabLiveFindings(count);
  }
  function setFabScanning(scanning2) {
    if (!fabEl) return;
    setRescanBusy(scanning2);
    fabEl.classList.toggle("deflector-fab-scanning", scanning2);
    const live = fabEl.querySelector("#deflector-fab-live");
    if (scanning2) {
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
    fabEl.classList.remove("deflector-fab-settle");
    void fabEl.offsetWidth;
    fabEl.classList.add("deflector-fab-settle");
    setTimeout(() => fabEl?.classList.remove("deflector-fab-settle"), 600);
    if (live) live.textContent = "";
    fabEl.title = lastBadgeCount > 0 ? COPY.fabTitleFindings(lastBadgeCount) : COPY.fabTitleIdle;
  }
  function showScanError(detail) {
    const message = detail ? COPY.scanErrorDetail(truncate(String(detail), 120)) : COPY.scanError;
    announceFab(message, "assertive");
    if (!sidebarEl) return;
    let banner = sidebarEl.querySelector(".deflector-scan-error");
    if (!banner) {
      banner = document.createElement("p");
      banner.className = "deflector-scan-error deflector-meta deflector-meta--error";
      banner.setAttribute("role", "alert");
      sidebarEl.querySelector(".deflector-sidebar-body")?.prepend(banner);
    }
    banner.textContent = message;
  }

  // src/llmEscalation.js
  async function escalateWithLlm(ruleFindings, candidates, options = {}) {
    const lowConfidence = ruleFindings.filter((f) => f.confidence >= 0.5 && f.confidence < 0.8);
    const coveredTexts = new Set(ruleFindings.map((f) => f.matchedText.toLowerCase()));
    let snippets = [];
    if (options.deep) {
      snippets = candidates.map((c) => c.text).filter((t) => t.length >= 15 && t.length <= 300).slice(0, 10);
    } else {
      snippets = lowConfidence.map((f) => f.matchedText);
      const extra = candidates.map((c) => c.text).filter((t) => !coveredTexts.has(t.toLowerCase()) && t.length >= 20 && t.length <= 200).slice(0, Math.max(0, 10 - snippets.length));
      snippets = [...snippets, ...extra];
    }
    if (snippets.length === 0) return [];
    try {
      const response = await chrome.runtime.sendMessage({
        type: "LLM_ESCALATE",
        snippets,
        deep: !!options.deep
      });
      if (!response?.findings?.length) return [];
      return response.findings.map((f, i) => ({
        id: `llm-${i}-${Date.now()}`,
        category: f.category,
        matchedText: f.text,
        confidence: f.confidence ?? 0.75,
        ruleId: "llm-escalation",
        explanation: f.explanation || "Flagged by deep semantic scan.",
        rewrite: f.rewrite || "Review this content independently.",
        source: "llm",
        tier: "llm"
      }));
    } catch {
      return [];
    }
  }
  function mergeFindings(ruleFindings, llmFindings) {
    const seen = new Set(ruleFindings.map((f) => f.matchedText.toLowerCase()));
    const merged = [...ruleFindings];
    for (const f of llmFindings) {
      const key = f.matchedText.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(f);
    }
    return merged.sort((a, b) => b.confidence - a.confidence);
  }

  // src/content.js
  var DEBOUNCE_MS = 1200;
  var AUTO_RETRY_DELAYS = [0, 1500, 3500, 7e3, 12e3];
  var debounceTimer = null;
  var lastCandidateHash = "";
  var lastUrl = location.href;
  var scanning = false;
  var observerStarted = false;
  var fabVisible = false;
  var siteMode = "auto";
  var verbose = false;
  var deepScanEnabled = false;
  async function loadSettings() {
    const host = normalizeHost(location.hostname);
    const stored = await chrome.storage.local.get(["siteModes", "verbose", "deepScanEnabled"]);
    siteMode = stored.siteModes?.[host] || "auto";
    verbose = !!stored.verbose;
    deepScanEnabled = !!stored.deepScanEnabled;
  }
  function hashCandidates(candidates) {
    return candidates.map((c) => c.text.slice(0, 80)).join("|");
  }
  function shouldShowFab(pageInfo) {
    if (pageInfo.disabled) return false;
    if (siteMode === "off") return false;
    return isPriorityCommercePage(location) || pageInfo.riskScore >= 30 || siteMode === "always";
  }
  function updateFabVisibility(pageInfo) {
    const show = shouldShowFab(pageInfo);
    fabVisible = show;
    if (show) {
      initFab(true, {
        onToggle: () => {
          if (getLastFindings().length === 0 && !scanning) {
            runScan("manual", "", { openSidebar: true });
          } else {
            toggleSidebar();
          }
        }
      });
      updateFabBadge(getLastFindings().length);
    } else {
      hideFab();
    }
  }
  async function runScan(trigger = "auto", selectionText = "", options = {}) {
    if (scanning) return { findings: getLastFindings(), count: getLastFindings().length };
    scanning = true;
    setFabScanning(true);
    try {
      await loadSettings();
      const pageInfo = classifyPage(location, document, siteMode);
      updateFabVisibility(pageInfo);
      if (pageInfo.disabled && trigger === "auto") {
        await chrome.runtime.sendMessage({ type: "UPDATE_BADGE", count: 0 }).catch(() => {
        });
        return { findings: [], count: 0 };
      }
      if (!shouldScan(siteMode, pageInfo.riskScore, trigger, location)) {
        return { findings: getLastFindings(), count: getLastFindings().length };
      }
      rememberPriceBaseline(document);
      const [filters, siteAdapter] = await Promise.all([
        loadFilters(),
        loadSiteAdapter(location.hostname)
      ]);
      const candidates = extractCandidates(document, location.hostname, siteAdapter, selectionText);
      const candidateHash = hashCandidates(candidates);
      if (trigger === "auto" && candidateHash === lastCandidateHash) {
        return { findings: getLastFindings(), count: getLastFindings().length };
      }
      lastCandidateHash = candidateHash;
      const useDeep = trigger === "deep" || deepScanEnabled;
      let findings = runRuleEngine(candidates, filters, location.hostname, siteAdapter, document, {
        verbose,
        deep: useDeep
      });
      const hasLowConfidence = findings.some((f) => f.confidence >= 0.5 && f.confidence < 0.8);
      if (useDeep || hasLowConfidence) {
        const llmFindings = await escalateWithLlm(findings, candidates, { deep: useDeep });
        findings = mergeFindings(findings, llmFindings);
      }
      const openSidebar2 = options.openSidebar ?? (trigger === "manual" || trigger === "deep");
      renderFindings(findings, { openSidebar: openSidebar2 });
      await chrome.runtime.sendMessage({
        type: "SAVE_FINDINGS",
        findings: findings.map(stripElement),
        pageInfo,
        filterVersion: filters.version
      });
      return { findings, count: findings.length };
    } catch (err) {
      console.error("[Deflector] Scan failed:", err);
      showScanError(String(err));
      return { findings: [], count: 0, error: String(err) };
    } finally {
      scanning = false;
      setFabScanning(false);
    }
  }
  function stripElement(f) {
    const { element, ...rest } = f;
    return rest;
  }
  function scheduleScan(trigger = "auto") {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runScan(trigger), DEBOUNCE_MS);
  }
  function onPageActivity() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastCandidateHash = "";
      renderFindings([], { openSidebar: false });
      const pageInfo = classifyPage(location, document, siteMode);
      updateFabVisibility(pageInfo);
    }
    scheduleScan("auto");
  }
  function initMutationObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver(onPageActivity);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  function initSpaNavigationWatch() {
    const notify = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCandidateHash = "";
        renderFindings([], { openSidebar: false });
        scheduleScan("auto");
      }
    };
    window.addEventListener("popstate", notify);
    const wrapHistory = (method) => {
      const original = history[method];
      history[method] = function(...args) {
        const result = original.apply(this, args);
        notify();
        return result;
      };
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
    setInterval(notify, 2e3);
  }
  function scheduleAutoRetries() {
    for (const delay of AUTO_RETRY_DELAYS) {
      setTimeout(() => {
        lastCandidateHash = "";
        runScan("auto");
      }, delay);
    }
  }
  document.addEventListener("deflector:rescan", (e) => {
    lastCandidateHash = "";
    const trigger = e.detail?.trigger || "manual";
    runScan(trigger, "", { openSidebar: true });
  });
  document.addEventListener("deflector:settings-changed", async () => {
    lastCandidateHash = "";
    await loadSettings();
    await syncSidebarSettings();
    runScan("manual");
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SCAN_PAGE") {
      lastCandidateHash = "";
      const openSidebar2 = message.openSidebar !== false;
      runScan(message.trigger || "manual", "", { openSidebar: openSidebar2 }).then((result) => sendResponse({ ok: true, ...result })).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === "SCAN_SELECTION") {
      const text = document.getSelection()?.toString() || "";
      lastCandidateHash = "";
      runScan("manual", text, { openSidebar: true }).then((result) => sendResponse({ ok: true, hadSelection: !!text, ...result })).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === "TOGGLE_SIDEBAR") {
      toggleSidebar(message.show);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "CLEAR_HIGHLIGHTS") {
      clearHighlights();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "SETTINGS_CHANGED") {
      lastCandidateHash = "";
      loadSettings().then(() => syncSidebarSettings()).then(() => runScan("manual", "", { openSidebar: false })).then((result) => sendResponse({ ok: true, ...result })).catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === "PING") {
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
