/** @typedef {'off' | 'manual' | 'auto' | 'always'} SiteMode */

export const COMMERCE_HOSTS = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca',
  'ebay.com', 'walmart.com', 'target.com', 'bestbuy.com', 'etsy.com',
  'booking.com', 'expedia.com', 'hotels.com', 'airbnb.com', 'kayak.com',
  'shopify.com', 'aliexpress.com', 'wish.com', 'wayfair.com', 'overstock.com',
  'nike.com', 'adidas.com', 'zara.com', 'asos.com', 'shein.com',
  'ticketmaster.com', 'stubhub.com', 'vrbo.com', 'priceline.com',
];

export const DISABLED_HOSTS = [
  'wikipedia.org', 'github.com', 'stackoverflow.com', 'google.com',
  'docs.google.com', 'mail.google.com', 'outlook.com', 'notion.so',
];

const CHECKOUT_PATHS = [
  '/checkout', '/cart', '/basket', '/bag', '/payment', '/pay',
  '/order/review', '/purchase', '/billing',
];

const PRODUCT_PATHS = [
  '/product', '/products/', '/p/', '/dp/', '/item/', '/listing/',
  '/shop/', '/buy/', '/pd/', '/sku/',
];

const BOOKING_PATHS = [
  '/hotel', '/hotels/', '/flights/', '/flight/', '/rooms/', '/book/',
  '/reservation', '/stay/',
];

/**
 * @param {string} hostname
 */
export function normalizeHost(hostname) {
  return hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * @param {string} host
 */
export function hostMatchesList(host, list) {
  const h = normalizeHost(host);
  return list.some((entry) => h === entry || h.endsWith('.' + entry));
}

/**
 * @param {URL} url
 */
export function scoreUrlPath(url) {
  const path = url.pathname.toLowerCase();
  let score = 0;

  if (CHECKOUT_PATHS.some((p) => path.includes(p))) score += 40;
  if (PRODUCT_PATHS.some((p) => path.includes(p))) score += 30;
  if (BOOKING_PATHS.some((p) => path.includes(p))) score += 35;

  if (/\b(cart|checkout|basket|payment)\b/.test(path)) score += 25;

  return score;
}

/**
 * @param {Document} doc
 */
export function scoreSchemaOrg(doc) {
  let score = 0;
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || '');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const type = item['@type'];
        const types = Array.isArray(type) ? type : [type];
        if (types.some((t) => /Product|Offer|AggregateOffer|Hotel|Flight/i.test(String(t)))) {
          score += 20;
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  return Math.min(score, 30);
}

/**
 * @param {Document} doc
 */
export function scoreCommerceDom(doc) {
  let score = 0;

  const addToCart = [...doc.querySelectorAll('button, a, input[type=submit]')].some((el) =>
    /\b(add to (cart|bag|basket)|buy now|purchase)\b/i.test(el.textContent || el.value || ''),
  );
  if (addToCart) score += 25;

  const paymentFields = doc.querySelector(
    'input[autocomplete*="cc"], input[name*="card"], input[id*="card"], iframe[src*="stripe"], iframe[src*="paypal"]',
  );
  if (paymentFields) score += 35;

  const priceEls = doc.querySelectorAll(
    '[itemprop=price], [data-testid*="price"], .price, [class*="Price"], [class*="price"]',
  );
  if (priceEls.length > 0) score += 15;

  const variantSelectors = doc.querySelectorAll(
    'select[name*="size"], select[name*="color"], [data-testid*="variant"], [class*="size-selector"]',
  );
  if (variantSelectors.length > 0) score += 10;

  const orderSummary = doc.querySelector(
    '[class*="order-summary"], [class*="OrderSummary"], [data-testid*="order-summary"], #order-summary',
  );
  if (orderSummary) score += 20;

  // Amazon and similar commerce widgets
  if (doc.querySelector('#buybox, #addToCart, #add-to-cart-button, #availability, [data-asin], #corePrice_feature_div')) {
    score += 20;
  }

  return Math.min(score, 50);
}

/**
 * @param {Location} location
 * @param {Document} doc
 */
export function computeRiskScore(location, doc) {
  const host = normalizeHost(location.hostname);
  let score = 0;

  if (hostMatchesList(host, DISABLED_HOSTS)) return 0;

  if (hostMatchesList(host, COMMERCE_HOSTS)) score += 35;

  score += scoreUrlPath(new URL(location.href));
  score += scoreSchemaOrg(doc);
  score += scoreCommerceDom(doc);

  return Math.min(score, 100);
}

/**
 * @param {number} riskScore
 * @returns {'idle' | 'manual' | 'auto'}
 */
/**
 * Known commerce URL patterns that should auto-scan even before dynamic DOM loads.
 * @param {Location} location
 */
export function isPriorityCommercePage(location) {
  const host = normalizeHost(location.hostname);
  if (!hostMatchesList(host, COMMERCE_HOSTS)) return false;
  const path = location.pathname.toLowerCase();
  return (
    PRODUCT_PATHS.some((p) => path.includes(p))
    || CHECKOUT_PATHS.some((p) => path.includes(p))
    || BOOKING_PATHS.some((p) => path.includes(p))
    || /\/gp\/aw\//.test(path)
  );
}

export function defaultScanTrigger(riskScore, location = null) {
  if (riskScore >= 65) return 'auto';
  if (location && isPriorityCommercePage(location) && riskScore >= 30) return 'auto';
  if (riskScore >= 30) return 'manual';
  return 'idle';
}

/**
 * @param {SiteMode} siteMode
 * @param {number} riskScore
 * @param {'auto' | 'manual' | 'deep'} requestedTrigger
 */
/**
 * @param {SiteMode} siteMode
 * @param {number} riskScore
 * @param {'auto' | 'manual' | 'deep'} requestedTrigger
 * @param {Location} [location]
 */
export function shouldScan(siteMode, riskScore, requestedTrigger = 'auto', location = null) {
  if (siteMode === 'off') return requestedTrigger === 'manual' || requestedTrigger === 'deep';

  if (requestedTrigger === 'manual' || requestedTrigger === 'deep') return true;

  if (siteMode === 'always') return true;

  if (siteMode === 'manual') return false;

  // siteMode === 'auto'
  return defaultScanTrigger(riskScore, location) === 'auto';
}

/**
 * @param {Location} location
 * @param {Document} doc
 * @param {SiteMode} siteMode
 */
export function classifyPage(location, doc, siteMode = 'auto') {
  const riskScore = computeRiskScore(location, doc);
  const trigger = defaultScanTrigger(riskScore, location);
  const host = normalizeHost(location.hostname);
  const disabled = hostMatchesList(host, DISABLED_HOSTS);

  return {
    host,
    riskScore,
    trigger,
    disabled,
    siteMode,
    pageType: inferPageType(location, doc, riskScore),
  };
}

/**
 * @param {Location} location
 * @param {Document} doc
 * @param {number} riskScore
 */
function inferPageType(location, doc, riskScore) {
  const path = location.pathname.toLowerCase();
  if (CHECKOUT_PATHS.some((p) => path.includes(p)) || doc.querySelector('input[autocomplete*="cc"]')) {
    return 'checkout';
  }
  if (BOOKING_PATHS.some((p) => path.includes(p)) || /booking\.com|expedia|hotels\.com|airbnb/.test(location.hostname)) {
    return 'booking';
  }
  if (PRODUCT_PATHS.some((p) => path.includes(p)) || doc.querySelector('[itemprop=price]')) {
    return 'product';
  }
  if (riskScore >= 50) return 'commerce';
  return 'general';
}
