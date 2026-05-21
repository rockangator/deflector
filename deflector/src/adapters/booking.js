/**
 * Booking.com site adapter — extends generic extraction with booking-specific regions.
 * Filter rules: filters/sites/booking.json
 */

import { normalizeHost } from '../pageClassifier.js';

export const id = 'booking';

const HOSTS = ['booking.com'];

export const candidateSelectors = [
  '[data-testid="property-card"]',
  '.bui-banner',
  '[data-testid="price-and-discounted-price"]',
  '.hprt-table',
  '[data-testid="limited-availability"]',
  '[class*="urgency"]',
  '[class*="scarcity"]',
];

/**
 * @param {string} hostname
 */
export function matchesHost(hostname) {
  const h = normalizeHost(hostname);
  return HOSTS.some((host) => h === host || h.endsWith('.' + host));
}
