/**
 * Amazon site adapter — extends generic extraction with Amazon-specific regions.
 * Filter rules: filters/sites/amazon.json
 */

import { normalizeHost } from '../pageClassifier.js';

export const id = 'amazon';

const HOSTS = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr',
  'amazon.ca', 'amazon.in', 'amazon.es', 'amazon.it',
];

export const candidateSelectors = [
  '#corePrice_feature_div',
  '#buybox',
  '#availability',
  '#social-proofing-faceout',
  '#acBadge_feature_div',
  '#dealBadge_feature_div',
];

/**
 * @param {string} hostname
 */
export function matchesHost(hostname) {
  const h = normalizeHost(hostname);
  return HOSTS.some((host) => h === host || h.endsWith('.' + host));
}
