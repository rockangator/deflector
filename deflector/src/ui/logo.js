/** Trimmed square mark for in-UI chrome (FAB, sidebar, popup). */
export const LOGO_ASSET = 'src/ui/assets/logo-mark.png';

/** Keep in sync with logo rules in deflector.css / popup.css */
export const LOGO_SIZE_CHROME = 28;
export const LOGO_SIZE_FAB = 42;

/** FAB anchor — physical right edge, ~20% from top */
export const FAB_TOP = '20vh';
export const FAB_RIGHT = '0';
export const FAB_SIZE = 56;
export const FAB_Z_INDEX = '2147483647';

export function getLogoUrl() {
  return chrome.runtime.getURL(LOGO_ASSET);
}

/**
 * Force logo dimensions — host pages (Amazon, etc.) often set img { width: auto !important }
 * which beats inline width without !important. JS setProperty(..., 'important') wins.
 * @param {HTMLElement | null} el
 * @param {'default' | 'fab'} [variant]
 */
export function pinLogoMark(el, variant = 'default') {
  if (!el) return;
  const size = variant === 'fab' ? LOGO_SIZE_FAB : LOGO_SIZE_CHROME;
  const url = getLogoUrl();
  el.style.setProperty('width', `${size}px`, 'important');
  el.style.setProperty('height', `${size}px`, 'important');
  el.style.setProperty('max-width', `${size}px`, 'important');
  el.style.setProperty('max-height', `${size}px`, 'important');
  el.style.setProperty('min-width', '0', 'important');
  el.style.setProperty('min-height', '0', 'important');
  el.style.setProperty('display', 'block', 'important');
  el.style.setProperty('flex-shrink', '0', 'important');
  el.style.setProperty('overflow', 'hidden', 'important');
  el.style.setProperty('background-image', `url("${url}")`, 'important');
  el.style.setProperty('background-size', 'contain', 'important');
  el.style.setProperty('background-repeat', 'no-repeat', 'important');
  el.style.setProperty('background-position', 'center', 'important');
  el.style.setProperty('background-color', 'transparent', 'important');
  el.style.setProperty('border', 'none', 'important');
  el.style.setProperty('padding', '0', 'important');
  el.style.setProperty('margin', '0', 'important');
}

/** Host pages override fixed positioning on buttons — pin with !important via JS. */
export function pinFabPosition(el) {
  if (!el) return;
  el.style.setProperty('position', 'fixed', 'important');
  el.style.setProperty('top', FAB_TOP, 'important');
  el.style.setProperty('right', FAB_RIGHT, 'important');
  el.style.setProperty('left', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
  el.style.setProperty('z-index', FAB_Z_INDEX, 'important');
  el.style.setProperty('width', `${FAB_SIZE}px`, 'important');
  el.style.setProperty('height', `${FAB_SIZE}px`, 'important');
  el.style.setProperty('display', 'flex', 'important');
  el.style.setProperty('visibility', 'visible', 'important');
  el.style.setProperty('opacity', '1', 'important');
  el.style.setProperty('pointer-events', 'auto', 'important');
  el.style.setProperty('margin', '0', 'important');
  el.style.setProperty('float', 'none', 'important');
  el.style.setProperty('transform', 'none', 'important');
}

export function pinFabHintPosition(el) {
  if (!el) return;
  el.style.setProperty('position', 'fixed', 'important');
  el.style.setProperty('top', `calc(${FAB_TOP} + ${FAB_SIZE}px + 12px)`, 'important');
  el.style.setProperty('right', FAB_RIGHT, 'important');
  el.style.setProperty('left', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
  el.style.setProperty('z-index', FAB_Z_INDEX, 'important');
}

export function getLogoMarkHtml({ variant = 'default' } = {}) {
  const isFab = variant === 'fab';
  const cls = isFab ? 'deflector-logo-mark deflector-logo-mark--fab' : 'deflector-logo-mark';
  return `<span class="${cls}" role="img" aria-hidden="true"></span>`;
}
