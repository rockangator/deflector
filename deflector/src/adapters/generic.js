/**
 * Generic adapter — default candidate regions and no site-specific selectors.
 * Site-specific logic lives in filters/sites/*.json and is loaded by candidateExtractor.
 */

export const id = 'generic';

export const candidateSelectors = [];

export function matchesHost(_hostname) {
  return true;
}
