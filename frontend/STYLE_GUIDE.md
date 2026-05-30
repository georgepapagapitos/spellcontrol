# Frontend style guide

A **living** reference for SpellControl's frontend design language — the visual
and CSS conventions that aren't enforced by tooling. This is for both humans and
agents: when you make a styling ruling that should hold across the app, write it
down here so the next person (or session) doesn't re-litigate it.

> Scope note: this is the **design language** (shape, color, spacing, responsive
> rules). Architecture, build, and test conventions live in the repo-root
> `CLAUDE.md`, not here.

CSS is **not** covered by typecheck/eslint/CI (only stylelint, narrowly), so most
of these rules are enforced by review and visual checks, not the gate. Treat them
as real constraints anyway.

---

## Shape language — corners

**Rectangles act, pills label.** Two tiers, no third:

| Use                         | Radius                             | For                                                                                                                                                  |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action buttons**          | `var(--radius)` (8px) rounded-rect | Anything you click to _do_ something: header actions, toolbar buttons, dialog/sheet buttons, Draw/Deal/Simulate, Add cards (desktop **and** mobile). |
| **Cards / panels / sheets** | `var(--radius-lg)` (12px)          | Container surfaces.                                                                                                                                  |
| **Pills**                   | `999px`                            | **Non-actionable** chips, badges, counts, tags, color swatches/dots — things that _label_ state.                                                     |

**The one pill-button exception:** a genuinely **circular icon-only** button
(equal width/height, no text) may use `999px` — e.g. the `⋮` overflow button, the
round `+` add button. A button with a text label is never a pill.

Anti-patterns this rule kills:

- The same action rendered as two shapes across breakpoints (e.g. a pill on
  mobile, a rect on desktop).
- A text action button styled as a pill so it reads like a tag.

## Tabs / view switchers

- Page-level "distinct views" switcher → the `underline` variant of
  `components/Tabs.tsx` (accent underline tracks the active tab). It reads
  unambiguously as tabs; the soft `hub` nav-pill look does **not** and is
  reserved for the site/section nav (e.g. the Collection header).
- All tabbed surfaces go through the shared `components/Tabs.tsx` primitive
  (roving tabindex, arrow-key nav, `role=tablist`/`tab`/`tabpanel`). Don't
  hand-roll a tab strip.

## Overlays

- On-demand panels that shouldn't live inline (Add cards, Test hand) use the
  shared **card-picker** pattern: `.card-picker-root` + `.card-picker-sheet` —
  a **bottom sheet on mobile, centered modal ≥1024px**. Dismiss via backdrop
  tap, a close button, and `Esc`.

## Z-index / layering

- **Always use the `--z-*` tokens** (in `global.css`), never raw integers:
  `--z-dropdown` (50) · `--z-popover` (60) · `--z-menu` (80) · `--z-panel` (100)
  · `--z-sheet-bg`/`--z-sheet-fg` (110/111) · `--z-suggest` (200) · `--z-modal`
  (1000) · `--z-overlay` (1100) · `--z-tooltip` (9999).
- **A transient menu/popover must outrank the sticky chrome it opens over.** A
  sticky section-nav strip is _content scaffolding_, so cap it at `--z-popover`
  (just above scrolling content) — not `--z-panel` — so a menu (`--z-menu`)
  opened from a header above it floats on top instead of dropping behind. (This
  is why the deck editor's `.deck-editor-view-tabs` is `--z-popover` and the ⋮
  `.deck-editor-overflow-panel` is `--z-menu`.)
- Sheets/modals (`--z-sheet-*`, `--z-modal`, `--z-overlay`) always sit above both.

## Color & spacing

- **Always theme variables**, never hard-coded colors: `--surface`, `--surface2`,
  `--text`, `--text2`, `--text3`, `--border`, `--border2`, `--accent`,
  `--accent-light`, `--on-accent`, etc. This is what makes light/dark themes work.
- **No raw `px`/`rem` font sizes** — use the `--text-*` scale (`--text-xs`,
  `--text-sm`, `--text-base`, …). stylelint enforces this on `src/**/*.css`.

## Responsive

- **Canonical breakpoints:** 480 / 600 / 700 / 1024 (major) / 1101 (deck editor).
  Reuse these; don't introduce new ones casually.
- **44px touch targets** on coarse pointers (`@media (pointer: coarse)`) for
  anything tappable.
- **No horizontal overflow at 320px.**

## CSS file layout

- **Deck components use co-located CSS:** a component in
  `src/components/deck/*` imports its own `./X.css` (e.g.
  `DeckColorPanel.css`), not the central `src/styles/deck-builder.css`. Shared
  layout/page styles live in `deck-builder.css`; per-component rules belong with
  the component. Because CSS isn't typecheck/lint-gated, a rule put in the wrong
  file renders silently unstyled while CI stays green — verify visually or grep
  the class name.

---

## Extending this guide

When you and a reviewer settle a recurring visual question ("should X be a pill?",
"which radius?", "where does this overlay live?"), add the ruling here in a
sentence or two. Keep entries short and prescriptive — a rule, the rationale if
it's non-obvious, and the anti-pattern it prevents. This doc is only useful if it
stays current, so prefer editing it over re-deciding.
