/** DOM helpers — escaping and safe lookups (no selector injection). */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(s, n) {
  const text = String(s ?? '');
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** Find element by data-id without interpolating into querySelector. */
export function findByDataId(container, id) {
  if (!container || id == null || id === '') return null;
  const target = String(id);
  for (const el of container.querySelectorAll('[data-id]')) {
    if (el.dataset.id === target) return el;
  }
  return null;
}
