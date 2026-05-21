/** Minimal empty state for sidebar when no findings. */
export function getEmptyStateHtml() {
  return `
    <div class="deflector-empty-state">
      <h3 class="deflector-empty-title">Nothing flagged yet</h3>
      <p class="deflector-empty-lead">No pressure tactics on this scan.</p>
    </div>
  `;
}
