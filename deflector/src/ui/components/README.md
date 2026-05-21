# Deflector UI — Extracted Primitives

> Output of `/impeccable extract`. CSS-class components (vanilla JS extension, no React).

## Token layers

| File | Contents |
|---|---|
| `tokens.css` | Color, elevation, z-index, motion, **layout primitives** |
| `type.css` | Imbue type scale + semantic aliases |
| `fonts.css` | @font-face |
| `components.css` | Reusable UI classes |
| `motion.css` | Shared keyframes + reduced-motion |

### New layout tokens (extract)

| Token | Value | Use |
|---|---|---|
| `--deflector-border-width` | 2px | Panels, buttons, fields |
| `--deflector-shadow-chip` | 2px 2px 0 ink | Fields, chips |
| `--deflector-btn-padding` | 12px 14px | Primary/secondary buttons |
| `--deflector-btn-padding-compact` | 8px 14px | FAB hint dismiss |
| `--deflector-panel-padding` | 16px 18px | Stat block, large panels |
| `--deflector-panel-padding-sm` | 12px 14px | Hint box, advanced |
| `--deflector-field-padding` | 10px 12px | Inputs, selects |
| `--deflector-space-gap` | 16px | Stack spacing |
| `--deflector-space-gap-sm` | 8px | Actions, tight stacks |
| `--deflector-space-gap-xs` | 6px | Chip rows |

---

## Components (3+ usages each)

### Button — `.deflector-btn`

| Modifier | Intent | Call sites |
|---|---|---|
| `--primary` | Main action (Imbue red) | Rescan (sidebar, popup), FAB hint dismiss |
| `--secondary` | Paper fill | Empty-state rescan, “Open panel” |
| `--block` | Full width | All sidebar/popup actions |
| `--compact` | Smaller padding | FAB hint “Got it” |

**Do not** style buttons with one-off border/shadow blocks — compose modifiers.

### Panel — `.deflector-panel`

| Modifier | Intent | Call sites |
|---|---|---|
| `--inset` | Gold `#f5d6a0` background | Stat, finding cards, hint, advanced |
| `--paper` | Cream `#fcefd4` | FAB hint |
| `--pad` | Standard padding | Popup stat |
| `--pad-sm` | Compact padding | Hint, advanced |

### Field — `.deflector-field`

Inputs and selects. Used: popup site mode, API key, sidebar scan mode.

### Field label — `.deflector-field-label`

Replaces ad-hoc `.field-label`. Popup + settings.

### Chip — `.deflector-chip`

Category count badges in popup (was `.chip`).

### Check row — `.deflector-check-row`

Checkbox + label row. Popup verbose/deep-scan, sidebar settings.

### Meta — `.deflector-meta`

Caption-sized secondary text. Popup filter version, status, page info.

---

## Domain components (feature-specific)

| Component | Classes | File |
|---|---|---|
| Crayon wash | `.deflector-crayon-wash` | `deflector.css` + `highlightOverlay.js` |
| Annotation pill | `.deflector-annotation-pill` | `deflector.css` + `highlightOverlay.js` |
| FAB | `#deflector-fab` | `deflector.css` + `highlight.js` |
| FAB hint | `#deflector-fab-hint` + panel primitives | `highlight.js` |
| Sidebar | `#deflector-sidebar` | `deflector.css` + `highlight.js` |
| Finding card | `.deflector-finding` + panel | `highlight.js` |
| Empty state | `.deflector-empty-state` | `ui/emptyState.js` |
| Logo mark | `.deflector-logo-mark` | `highlightOverlay.js` |

---

## Migration checklist

When adding UI:

1. Use `.deflector-btn` + modifiers for actions  
2. Use `.deflector-panel` + modifiers for bordered surfaces  
3. Use `.deflector-field` for form controls  
4. Add tokens to `tokens.css` only when **3+ identical literals** appear  
5. Import order: `fonts` → `tokens` → `components` → `motion` (content script only)
