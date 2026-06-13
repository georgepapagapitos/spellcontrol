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

**Page-hero CTAs are pills; below the hero, rectangles act and pills label.**

| Use                         | Radius                             | For                                                                                                                   |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Page-hero CTAs**          | `999px` pill (`.pill-btn`)         | Actions in a page hero (the `.binder-hero` row): Add cards, New deck, Share, Import deck… The deliberate hero signature. |
| **Action buttons**          | `var(--radius)` (8px) rounded-rect | Any other do-something button: toolbar, dialog/sheet, panel actions, Draw/Deal/Simulate.                              |
| **Cards / panels / sheets** | `var(--radius-lg)` (12px)          | Container surfaces.                                                                                                   |
| **Pills (labels)**          | `999px`                            | **Non-actionable** chips, badges, counts, tags, color swatches/dots — things that _label_ state.                      |

**Hero CTAs are the one labelled-pill tier.** Outside a page hero, the only
pill-shaped button is a genuinely **circular icon-only** one (equal
width/height, no text) — e.g. the `⋮` overflow button, the round `+` add
button. Any other labelled button below the hero is a rect, never a pill.

Anti-patterns this rule kills:

- The same action rendered as two shapes across breakpoints (e.g. a pill on
  mobile, a rect on desktop).
- A non-hero text button styled as a pill — it reads as a tag.

**The one labelled-pill exception below the hero: toolbar controls.** Compact
toolbar _pickers and disclosures_ — Sort / Group / Show / the view-mode toggle /
the symbol **Key** — use the shared `.toolbar-pill` (`999px`, `--surface` bg,
`0.5px --border-strong` border), not a rect. They're neither do-something
_actions_ (those are rects) nor static _labels_ (those are non-actionable chips)
but a third thing — _controls_ — and the pill is their established family
(`SelectMenu`, the `ToolbarPopover` trigger, `Legend variant="pill"`). This and
the circular icon-only button are the **only** labelled pills allowed below the
hero; a one-off labelled pill that _isn't_ part of this toolbar-control family
still reads as a tag — don't.

**Action-button anatomy (deck-analysis lanes & beyond).** A labelled action
button is an \*\*accent-fill rect with a leading lucide icon at `width/height={14}`

- a text label** (`var(--accent)` bg, `var(--on-accent)` text, `var(--radius)`,
  `:hover` → `var(--accent-hover)`). Two intents share the look, differing only by
  glyph: per-card **add** uses `Plus`; bulk **apply / commit a plan** uses `Check`.
  The baseline is `DeckCardRow`'s `.deck-card-row-act`; `.sub-add`,
  `.deck-analysis-suggest-add`, `.engine-suggestion-add`, `.optimize-apply`,
  `.cost-apply` all match it. Don't ship a hover-only-accent or icon-less variant —
  on touch there's no hover, so a muted base reads as a different (secondary)
  control. A genuine **secondary\*\* action (e.g. Cost's "Auto-select to target")
  may stay outline (`var(--surface-raised)` bg + border), but that's the only tier-2.

**Collapsible/section titles use `var(--font-serif)`, uppercase,
`letter-spacing`** — the `.deck-combos-title` family. Any new lane/group heading
(`.synergy-picks-title`, `.engine-suggestion-group-label`, …) joins it; a plain
sans-bold heading reads as off-family.

## Tabs / view switchers

- Page-level "distinct views" switcher → the `underline` variant of
  `components/Tabs.tsx` (accent underline tracks the active tab). It reads
  unambiguously as tabs; the soft `hub` nav-pill look does **not** and is
  reserved for the site/section nav (e.g. the Collection header).
- All tabbed surfaces go through the shared `components/Tabs.tsx` primitive
  (roving tabindex, arrow-key nav, `role=tablist`/`tab`/`tabpanel`). Don't
  hand-roll a tab strip.

## Toolbars & action rows (responsive)

Horizontal strips of buttons/controls in a header are the app's most repeated
overflow bug: each time a new control is added, the row outgrows a phone and the
last item clips. There are **two kinds of strip**, each with one rule — and one
hard constraint they share.

**Hard constraint (both kinds):** a strip that can ever exceed the viewport must
**never** be `flex-shrink: 0` + no-wrap. That combination is exactly what clips
at 320px. If it can't shrink, it must wrap or collapse.

1. **Action rows** — a primary call-to-action plus secondary actions (the page
   heroes: Decks / Collection / Binders).
   - Keep the **primary CTA labelled and always visible.**
   - Collapse the **secondary actions into a `⋮` overflow at `≤600px`** using the
     shared `components/OverflowMenu.tsx` (kebab + popover, outside-click/Esc
     close; opens from its own wrapper — for **virtualized rows** use
     `CardRowMenu` instead, which portals out of the clipping row). The Decks
     hero is the reference: New deck stays a labelled pill, Import deck + Add
     precon move into the kebab on phones.
   - Don't "solve" crowding by going **icon-only on ambiguous glyphs** — a box
     for "Add precon" isn't legible without its label. Icon-only is only for
     universal glyphs (search, close, settings).

2. **Control rows** — pickers with no single primary action (Sort / Group /
   Filter / view-mode toggles; e.g. `.card-list-summary-actions`, the binder
   sort bar).
   - These **wrap** (`flex-wrap: wrap`) and may shrink — overflowing controls
     flow to a second line, never clip. Adding one more picker (this rule was
     written after "Group by" overflowed the collection toolbar) must stay safe
     by construction.
   - Keep each control compact: a `SelectMenu` shows its **current value** (icon
     + value), not a redundant static label.

Verify both at the **320px floor** in the Responsive section — that's where the
clip shows up first.

## Symbol key / Legend

The card-symbol key is **one shared component** (`components/Legend.tsx`), driven
by a `context` prop (`collection` | `binder` | `deck`) — never hand-roll a
per-view key. Context decides only the _content_ (binder adds slot-border
colors; deck adds role badges + markers; collection shows the deck/binder
badges); the trigger, popover, and behavior are identical everywhere.

**Placement is fixed across views.** The Key is the **trailing reference control
at the right end of the toolbar — grouped with the view-mode toggle where one
exists** (collection, binder) — rendered `variant="pill"` with `align="right"`.
This is the _same-relative-order_ rule of [WCAG 2.2 SC 3.2.3 Consistent
Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html):
a low-frequency reference affordance needs a predictable home, and the standard
asks for consistent _relative_ position (rightmost, by the view toggle), **not**
pixel-identical toolbars. Don't render it leading-left, and don't fall back to
the underlined-text `variant="link"` (that was the binder's old outlier). To
right-anchor it, make it the **last** flex child after the view-mode toggle so
it rides the existing trailing auto-margins — don't add a competing
`margin-left: auto` (multiple autos split the free space and break the grouping).

## Overlays

- On-demand panels that shouldn't live inline (Add cards, Test hand) use the
  shared **card-picker** pattern: `.card-picker-root` + `.card-picker-sheet` —
  a **bottom sheet on mobile, centered modal ≥1024px**. Dismiss via backdrop
  tap, a close button, and `Esc`.

## Public shared views (/s/:token)

Public shared views wrap their content in `components/shared/SharedShell.tsx` — **not** the app
`<Header>`/`<Footer>`, which couple to the auth/collection/play stores a logged-out visitor
doesn't have. `SharedShell` is the SINGLE scroll root for any `/s/:token` page: when wrapping
a full-height scroller in new chrome, the wrapper owns the scroll and the inner element's
`height`/`overflow` must be neutralized — never stack two `100dvh` scroll roots.

The conversion CTA on a shared **deck** is "Copy this deck" into the guest local store (works
logged-out; sign-in promotes it). Shared binders/collections get the brand bar and footer CTA
but no deck-copy action. Keep conversion deck-only for now.

## Info tooltips

When a label needs a plain-language explainer for a concept not everyone knows
(jargon, a scoring formula), use the shared **`components/InfoTip.tsx`** — a
small `ⓘ` icon button beside the label with a portal tooltip. Don't hand-roll a
tooltip; reuse this so they behave identically everywhere.

- **Portal, always.** The bubble renders through `createPortal` into `<body>`
  and is positioned `fixed` from the trigger's rect, clamped to the viewport
  (flips above when there's no room below). This is non-negotiable: an in-flow
  `position: absolute`/`fixed` tooltip gets **clipped by `overflow: hidden`**
  ancestors (tables) and **trapped by `container-type`** containing blocks (the
  deck bento), so it must escape to `<body>`. Use `--z-tooltip`.
- **Reveal model** (mirrors the hover-peek capability story): mouse **hover**
  opens / mouse-leave closes (a click never _pins_ it open); keyboard **focus**
  opens / blur closes; on touch a **tap** focuses the trigger → opens, tapping
  away closes. Also closes on `Esc` and any scroll/resize so it never floats
  stale. No extra capability media-queries needed — the event set covers all.
- **Don't over-pepper.** One `ⓘ` per _concept_, not per data point. If several
  related rows each want a gloss (e.g. the four soft-score signals), prefer **one
  consolidated `wide` tooltip** on the section heading (intro + a bulleted list
  via `.info-tip-lead` / `.info-tip-list`) over N icons — many icons read as
  clutter. (Settled while building the Bracket panel's Hard-floor / Soft-score
  explainers.)
- The trigger sits inline in a flex label; `.info-tip-btn` zeroes its line-height
  so the glyph centers against the text. Pass rich `text` (a node) for
  multi-point bodies.

## Z-index / layering

- **Always use the `--z-*` tokens** (in `global.css`), never raw integers:
  `--z-dropdown` (50) · `--z-popover` (60) · `--z-menu` (80) · `--z-panel` (100)
  · `--z-sheet-bg`/`--z-sheet-fg` (110/111) · `--z-suggest` (200) · `--z-modal`
  (1000) · `--z-overlay` (1100) · `--z-tooltip` (9999).
- **Never guess a z-index. Pick the token by _role_, using this layering
  contract (low → high):**
  1. `--z-dropdown` (50) — menus/popovers anchored to **scrolling content**
     (virtualized card rows, in-list ⋮ menus). They ride under sticky chrome by
     design.
  2. `--z-popover` (60) — **sticky page chrome**: search rows, section-nav
     strips, sort bars. Content scaffolding that pins above scrolling content.
     **Cap sticky chrome here — never `--z-panel`.**
  3. `--z-menu` (80) — menus/popovers opened from a **header/hero that sits
     above sticky chrome** (e.g. a ⋮ overflow in the page hero). One tier above
     the sticky row so it floats over it instead of dropping behind.
  4. `--z-panel` (100) and up — fixed app frame (tab bar), sheets (`--z-sheet-*`),
     modals/overlays (`--z-modal`/`--z-overlay`), tooltips (`--z-tooltip`). These
     always sit above all of the above.
- **The recurring bug:** a sticky search/nav row at `--z-panel` swallows any menu
  opened from the hero above it. Two fixes are wrong (`calc(--z-panel + 1)` on the
  menu) and one is right (drop the sticky row to `--z-popover`, put the menu at
  `--z-menu`). Precedents that get it right: the deck editor's
  `.deck-editor-view-tabs` (`--z-popover`) + `.deck-editor-overflow-panel`
  (`--z-menu`); the decks/binders `…-index-search-row` (`--z-popover`) +
  `.overflow-menu-popover` (`--z-menu`).
- **Rule of thumb:** if A must paint over B, A's token must be strictly greater
  than B's — and B is whatever A physically overlaps, _not_ what's near it in the
  DOM. A sticky element creates its own stacking context, so its token wins
  against later siblings regardless of source order.

## Motion

Transform/opacity only — never animate layout properties. Motion expresses
causality (where did it come from / where did it go), not decoration.

**Rule: every entry animation has a symmetric exit — no teleport-vanish.**
A surface that animates in (rise/slide/pop/fade) must play the mirrored exit
on EVERY dismiss path (backdrop, ✕, Escape, swipe, action-complete
auto-close) before unmounting — wire it through `useSheetExit`
(`src/lib/use-sheet-exit.ts`; pass the surface's exit keyframe name). A
surface with no entry animation closes instantly — that IS its symmetric
exit (e.g. the desktop dropdown/centered-panel presentations of the mobile
sheets skip the hook).

### Tokens (global.css)

| Token             | Value                             | Use                                  |
| ----------------- | --------------------------------- | ------------------------------------ |
| `--motion-fast`   | 120ms                             | hovers, presses, popover enter       |
| `--motion-base`   | 200ms                             | fades, drawer exits, toast leave     |
| `--motion-gentle` | 320ms                             | sheet exits, emphasis one-shots      |
| `--motion-drawer` | 500ms                             | full-screen sheet rise (entry only)  |
| `--ease-out-soft` | cubic-bezier(0.2, 0.9, 0.3, 1)    | default for every entrance/move      |
| `--ease-drawer`   | cubic-bezier(0.32, 0.72, 0, 1)    | full-distance sheet travel           |
| `--ease-pop`      | cubic-bezier(0.2, 0.9, 0.25, 1.4) | overshoot: counters, celebration only|
| `linear`          |                                   | spinners, progress, confetti         |

Don't invent a new bezier — if none of these reads right, that's a
STYLE_GUIDE discussion, not an inline constant.

### Canonical patterns

1. **Bottom sheet / preview drawer** — rise `--motion-drawer` `--ease-drawer`,
   fall ~340ms; ALL dismiss paths route through `useSheetExit`; swipe handoff
   continues from the release offset. Backdrop fades, never slides.
2. **Side drawer** (stats) — slide 220ms `--ease-out-soft` in, 180ms out.
3. **Modal / dialog** — backdrop fade 160ms; panel scale 0.96→1 + fade 180ms;
   exit 120ms. Use the shared `Modal`; never a bespoke entrance.
4. **Popover / menu / tooltip** — enter `--motion-fast` fade + scale(0.98) +
   2px rise, transform-origin at the trigger; exit may be instant.
5. **Toast** — enter slide-in 160ms; leave fade+drop `--motion-base`;
   survivors glide to their new slot (transform transition, never a reflow snap).
6. **Feedback micro** — press = scale(0.97) `--motion-fast`; value change =
   `--ease-pop` one-shot ≤320ms; skeleton shimmer 1.4s; spinner 0.8s linear
   (use the shared `spin` / `skeleton-shimmer` keyframes — don't redeclare).

### Live values

**Live values animate on computation, not on mount.** A count-up or cascade
plays when the underlying analysis (re)computes or the value genuinely changes —
never again on tab switches or remounts of unchanged data. The `revealKey`
registry in `lib/use-animated-number.ts` is the mechanism: a key is consumed
globally once, so remounts of the same component don't replay the tween.

**Motion budget:**
- Reveal: 600ms easeOutCubic (0 → final value on first computation)
- Re-target: 200ms (small delta, ≤5 — the normal live-update path)
- Pop one-shot: ≤320ms (`--ease-pop`) on value change

Number and gauge share **one tween** — the `useAnimatedNumber` display value
drives both the rendered digit and `--hero-score-pct` inline, so the sweep and
the count-up land on the same frame (two decorations moving together → one fact
arriving).

**Words and bands never count up.** Only integer scores tween; verdict labels,
band words, bracket text, and percentage labels are set synchronously.

**Reduced motion:** `matchMedia('prefers-reduced-motion: reduce')` → set final
value immediately, still bump `popKey` so the pop CSS gate fires (the CSS pop
animation is itself reduced-motion gated, so this is safe).

### Device tilt

Gyro tilt is a foil-and-preview-only interaction — foil/etched cards only, in
the card-preview surface only. The listener attaches on preview open and detaches
on dismiss (zero idle battery cost).

**Mandatory gates (all must hold for the listener to attach):**

1. The card is foil or etched (`card.foil` truthy — `classifyFoil` returns a
   style other than `'none'`).
2. Touch device — NOT `(hover: none)`: Samsung WebViews report `hover: hover`
   on touch (the documented Galaxy trap), so the robust check is the inverse
   of the full desktop gate: `!matchMedia('(hover: hover) and (pointer: fine)')`.
3. `prefers-reduced-motion: reduce` is NOT set. Vestibular motion triggered by
   hand movement is exactly what that media feature is for — hard-disabled, not
   just reduced.
4. Swipe suppression: during a parent-owned swipe gesture, `shouldSuppressTilt`
   returns true and the tilt eases to neutral (same handshake as the cursor path).

**Baseline-delta mapping** — the first orientation sample captured at preview
open becomes the neutral reference. All subsequent samples map only the *delta*
from that baseline, so nobody needs to hold the phone flat for the effect to
work. The pure mapping math lives in `lib/tilt-mapping.ts` (unit-tested).

**No new settings UI.** The gyro interaction is gated by foil + preview-open
interaction context and disabled under OS reduced-motion — no additional toggle
needed.

### Reduced motion

Every keyframe gets a `prefers-reduced-motion: reduce` gate (the global
0.001ms kill is a backstop, not the mechanism — infinite loops must set
`animation: none` explicitly). Any JS that waits on `animationend` must
check `matchMedia` and complete immediately under reduce (see
`use-sheet-exit.ts` for the reference implementation).

## Color & spacing

- **Always theme variables**, never hard-coded colors: `--surface`, `--surface-raised`,
  `--text-primary`, `--text-secondary`, `--text-muted`, `--border`, `--border-strong`, `--accent`,
  `--accent-light`, `--on-accent`, etc. This is what makes light/dark themes work.
- **No raw `px`/`rem` font sizes** — use the `--text-*` scale (`--text-xs`,
  `--text-sm`, `--text-base`, …). stylelint enforces this on `src/**/*.css`.
- **Spacing scale:** a 4px-base `--space-*` scale (`--space-1` = 0.25rem …
  `--space-8` = 4rem) lives in the `:root` token block of `global.css`. New code
  uses these tokens for `margin`/`padding`/`gap` instead of freehand rems. Legacy
  off-scale values (0.35rem, 0.6rem, 0.85rem, …) are left alone and get snapped
  to the scale opportunistically — only when the surface is already being touched
  and visually verified, never as a blind find-and-replace. Never hardcode a new
  spacing rem that matches a scale step; write `var(--space-N)`.

## Responsive

### Device tiers (what to build + test against)

There are only **two viewport media-query boundaries** in the codebase — **600px**
and **1024px** (each used ~30× across many files). Everything else is refinement
_within_ a tier, not a tier wall. "XL desktop" is **not** a breakpoint: it's where
content hits its `max-width` cap and centers with side gutters (`--analysis-max:
1320px` for deck-analysis boards, `--page-max: 1400px` for page containers).

| Tier           | Viewport range | Test at (px)                    | What defines it                                                                                                                                                              |
| -------------- | -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mobile**     | `≤ 600`        | **320** · 375 · 414 · 480 · 600 | base styles; phone layouts, bottom sheets. **320 = hard no-overflow floor.** 480 = cramped-phone refinement.                                                                 |
| **Tablet**     | `601 – 1023`   | 640 · 768 · 820 · 1023          | the gap between the two poles. 640 = deck-bento 2-col **container**-query trigger (not viewport).                                                                            |
| **Desktop**    | `1024 – 1399`  | **1024** · 1101 · 1280          | sticky panels, multi-column, hover-peek (`≥1024`). 1101 = deck-editor layout shift.                                                                                          |
| **XL desktop** | `≥ 1400`       | 1440 · 1920                     | content **stops growing** and centers: deck-analysis caps at `--analysis-max` (1320), pages at `--page-max` (1400). Test for balanced gutters / no dead space, not a reflow. |

- **The two real breakpoints:** `max-width: 600px` (mobile) and `min-width: 1024px`
  (desktop). Use **600**, not 599 — the codebase tolerates the 1px overlap with
  `min-width: 600px` rules. Tablet is the implied `601–1023` gap.
- **Secondary refinement widths** (reuse before inventing new): **480** (tight
  phone), **640** (bento container query + early tablet), **700** (Cost/Optimize/
  Substitution panels), **1101** (deck editor). Don't add bespoke widths casually —
  if you need one, prefer snapping to this set.
- **Container queries ≠ viewport.** The deck bento (`.deck-bento`,
  `container-type: inline-size`) reflows on its **own** width at `640` / `1040`
  container px — independent of viewport tier. This is why a half-width panel on a
  wide tablet can look cramped even though the _viewport_ is "desktop": tune the
  **container** threshold, not a viewport media query.
- **Width caps:** `--page-max: 1400px` (page containers), `--analysis-max: 1320px`
  (deck-analysis boards) — both `margin-inline: auto`. These define the XL tier.

### Other responsive rules

- **44px touch targets** on coarse pointers (`@media (pointer: coarse)`) for
  anything tappable.
- **No horizontal overflow at 320px** (the hard floor).
- **Both themes on every tier** — light and dark are independent surfaces.

## CSS file layout

- **Deck components use co-located CSS:** a component in
  `src/components/deck/*` imports its own `./X.css` (e.g.
  `DeckColorPanel.css`), not the central `src/styles/deck-builder.css`. Shared
  layout/page styles live in `deck-builder.css`; per-component rules belong with
  the component. Because CSS isn't typecheck/lint-gated, a rule put in the wrong
  file renders silently unstyled while CI stays green — verify visually or grep
  the class name.

## Verdict badges

The Tune-board panels each recommend a card action ("add this", "cut that",
"swap for the owned one"). They speak **one vocabulary** via the shared
`components/deck/VerdictBadge.tsx` chip — a `999px` pill (per the Pills rule)
plus an optional plain-English reason. Don't hand-roll a panel-specific decision
chip; reuse this so the boards read as one system, not five badge styles.

The vocabulary is a fixed **verdict → word → tone** map (tones are the status
tokens from `global.css` — reuse them, never new hues):

| Verdict      | Word       | Tone    | Token         | Means                           |
| ------------ | ---------- | ------- | ------------- | ------------------------------- |
| `add`        | Add        | green   | `--success`   | safe gain (Engine/Optimize/gap) |
| `cut`        | Cut        | red     | `--err-text`  | remove it (Optimize removals)   |
| `substitute` | Substitute | blue    | `--info`      | lateral owned swap              |
| `budget`     | Budget     | gold    | `--warn-text` | a real tradeoff / power loss    |
| `owned`      | Owned      | accent  | `--accent`    | already in your collection      |
| `hold`       | Hold       | neutral | `--text-muted`     | flagged but intentionally kept  |

The **tone semantics** are the load-bearing part: green = safe/gain · blue =
lateral · gold = tradeoff/caution · red = remove · accent = ownership · neutral =
no-op. A panel with a finer scale maps onto these tones rather than inventing
colors — e.g. the Cost panel's drop-in/sidegrade/budget confidence passes
`tone` + `label` directly (`success`/`info`/`warn`, keeping its own word). When a
row carries a left accent bar, color it to match the row's verdict tone (Cost and
Substitution both do this) so the bar and chip agree.

The badge is **presentational only** — it holds no decision logic; callers map
their own semantics onto the vocabulary. Adopted in the Substitution and Cost
panels, and in the shared `DeckCardRow` (the Engine/Optimize/Gap card row),
whose title-row tags are `tone` + `label` chips: Game Changer = `warn`, role
label = `neutral`, Synergy = `accent` (theme fit), In other deck = `neutral`.
A chip may carry a `title` tooltip, but per the touch rule it's
enhancement-only — never the sole path to the information.

**Inclusion-% tint: red < 10% only.** The inclusion percentage on suggestion
rows (`inclusionColor` in `DeckCardRow.tsx`) is hue-tinted, but **red is
reserved for genuine fringe picks (<10% inclusion)** so it can never collide
with red = remove (the Cut tone). 10–50% reads amber→yellow
(neutral/caution); ≥50% ramps yellow→green. Don't smear red across the low-mid
range — a 35%-inclusion card is a normal, healthy inclusion, not an alarm.

## Bars & meters

Every horizontal proportional bar goes through the shared
`components/shared/MeterBar.tsx` primitives — **never hand-roll a bar track**
(a `style={{ width: '…%' }}` fill div; a source-scan test,
`lib/no-handrolled-bar-tracks.test.ts`, enforces this):

- **`MeterBar`** — single fill: `value`/`max`, optional `color`,
  `size` (`sm` 6px meter / `md` 12px progress), `minPct` visual floor,
  `indeterminate` sweep.
- **`StackedBar`** — multi-segment: `segments` (`key`/`value`/`color`/`title`),
  optional `max` for partial-width stacks (the stack spans `sum/max` of the
  track). Segments carry an inset hairline divider as a non-color boundary cue.

The primitive owns **geometry, track, and animation**: one track
(`var(--border)`, `999px` radius), one mount animation (fill grows from the
left edge, `--motion-gentle` `--ease-out-soft`, reduced-motion gated), one
width-glide for live value changes. The **palette stays with the caller** via
`color` / per-segment colors. A `className` on the primitive may add layout
(margin/flex) only — never re-style the track.

A bar's length must be **honest** — proportional to its value on a scale shared
with its siblings (the EnginePanel once painted every axis full-width; that's
the failure mode this rule exists for). Accessibility: bars default to
`aria-hidden` with the numbers as adjacent visible text; live operations opt
into `role="progressbar"` (see `ProgressBar`). Vertical charts (curve hero,
test-hand histogram) are charts, not meters, and stay bespoke. Radar/polar
charts also stay bespoke — see **"Radar / polar charts"** below.

## Radar / polar charts

A radar chart is permitted only when displaying **≥3 labeled dimensions of one
normalized measure** — where shape = balance, not absolute magnitude.

Rules (all mandatory):

- **Normalization must be stated in an adjacent caption.** Never imply an
  absolute scale. The caption reads "Engine balance, not power" with an
  InfoTip explaining that vertices are normalized to the busiest axis.
- **Every vertex carries its word + value** — label + count, no unlabeled
  vertices, ever. (The "charts say what they mean" obligation extends to polar
  geometry.)
- **Vertices that drill down are real `<button>`s** with ≥44px coarse-pointer
  hit areas (padding/`min-height: 44px`). Each carries a full `aria-label`
  ("Axis — N cards: M producers, K payoffs. Show cards.").
- **One-shot entrance only** — `scale(0.92→1) + fade`, `--motion-gentle`
  `--ease-out-soft`, explicit `@media (prefers-reduced-motion: reduce) {
  animation: none }` gate. No continuous or looping animation.
- **<3 active axes:** do not render the polygon. Show labeled count chips
  (999px pill) with an explanatory fallback message instead.
- **SVG accessibility:** `role="img"` + `aria-label` sentence naming every
  axis and count. Vertex buttons are the accessible interactive layer.
- **Color:** the value polygon uses `var(--accent)` fill (low opacity) +
  accent stroke — it's about axes, not card colors. WUBRG pips are not used.
- **Bespoke, never MeterBar.** Radar geometry belongs in
  `lib/playstyle-radar.ts` + the co-located component; `radarLayout` is the
  single geometry source.

## Card row information hierarchy

Collection/binder rows represent a **specific printing**, not just a card name —
the density tiers decide which fields drop, but never the printing identity.

**Printing-identity floor.** Any row that represents a specific printing carries
the **rarity-tinted set symbol** (`components/shared/SetSymbol`, keyrune glyph
tinted via the `--rarity-*` tokens — collector-app standard: common = muted
text, uncommon = silver, rare = gold, mythic = orange-red) at **every viewport
width**. This is the floor that keeps two printings of the same card name from
rendering pixel-identical (the pre-T36 compact-row bug: SET/#CN/foil all hidden
<768px). Text tokens may drop with density; the glyph never does.

**Per-density field budgets.** Each density has a fixed budget — add a field by
trading one out, not by squeezing:

| Density            | Fields                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **List** (66px)    | thumb · name · foil · deck/binder badges · type glyph · set glyph + set code + CN · mana · qty · value                                  |
| **Compact** (32px) | name · type glyph · set glyph · mana · qty · value — set code + CN return ≥768px; foil/deck/binder badges return ≥1024px                |
| **Grid** (tile)    | art + qty badge + corner deck/binder badges; a **set-code chip** (bottom-left, next to qty) appears **only when the same card name has >1 printing** in the current rows — art is the identity until it's ambiguous |

**Touch rule.** Hover-revealed information (titles/tooltips on glyphs, hover
peeks) is **enhancement-only** — on coarse pointers it doesn't exist, so nothing
may be *only* reachable via hover. Every hover affordance needs a tap path;
**tap-opens-the-card-preview is the canonical fallback** (the preview carousel
shows the full printing detail), which is why the row glyphs can stay compact
and `aria-hidden`/title-labelled.

**Glyph literacy.** A glyph may carry meaning **alone** only if at least one of:

- **(a)** it's the game's physical-card convention — mana symbols, the set
  symbol, its rarity tint — implicit knowledge any player picked up from the
  cards themselves;
- **(b)** it's paired with its word at a roomier density of the **same
  surface** (e.g. the foil pip is icon-only in compact rows because the list
  row spells "Etched" next to it);
- **(c)** it's covered by the **symbol Key** on that surface
  (`components/Legend`, the context-aware "Key" popover mounted on the
  collection toolbar, binder summaries, and the deck toolbar).

App-invented glyphs — type icons, the 2-letter role badges, the synergy `✦` —
are conventions of this app/fan tooling that a casual player has never seen, so
they **require (b) or (c)**. `title` tooltips are a desktop-only enhancement —
never the sole explanation (see the Touch rule). The Key renders its samples
with the **real components** (`TypeIcon`, `SetSymbol`, `FoilBadge`, badge
markup) so it can't drift from the rows it explains. **Shipping a new glyph ⇒
adding its Key entry in the same PR.**

---

## Deck analysis tabs — first-impression states

**Skeleton while analysis is pending (UX-310).** The Tune and Power tabs render
a skeleton placeholder while the async commander-deck analysis (`useCommanderBracketAnalysis`)
hasn't yet produced its first result. The skeleton uses the shared
`skeleton-shimmer` keyframe from `global.css` — do NOT redeclare it (the
`motion-tokens.test.ts` guard enforces a single declaration). The CSS class
family is `deck-analysis-skeleton` / `deck-analysis-skeleton-bar` / etc., in
`styles/deck-builder.css`. The skeleton disappears as soon as any lane content
slot (`improveSlot`, `powerHeroSlot`, etc.) arrives, or once
`analysisState === 'ready'`. The pending signal is `!deck.gradeBracketSignature`
(set only after the first successful analysis run).

**StatsHero shortfall deep-links (UX-311).** Soft-target shortfall checks in the
StatsHero (ramp, removal, cardDraw, boardwipe, curve) render as tappable buttons
when `onNavigate` is provided, deep-linking to the `fill-gaps` lane in the Tune
tab. Hard-rule failures (size, identity, singleton) stay as plain text — they
require card edits in the Deck view, not suggestions. Touch targets ≥44px on
coarse pointers (`.stats-hero-shortfall-btn` + `@media (pointer: coarse)`). The
button is a rect below the hero (STYLE_GUIDE shape-language rule: rectangles act
below hero), with `--border-strong` border + chevron arrow.

## One scoring vocabulary (UX-315)

The app's analysis surfaces speak **one vocabulary** so users learn it once:

**Rule: band words are the public language; raw numbers are panel-internal.**

| Tier       | Where it lives                                          | Examples                                                                |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Band words** | Cross-panel: heroes, lane headers, stat-strip, NBM  | "Dialed in", "Needs work", "Optimized", "Exhibition"                    |
| **Numbers**    | Inside their own panel only                         | `78/100` in BracketBreakdown's Power signal table; sub-score bars       |
| **Bracket**    | A number but also a named tier — use "Bracket N"    | "Bracket 3 · Upgraded" in the hero; never just "3"                     |

**One grading system.** A letter grade (`A`, `B+`) is a third dialect — it has been removed from the stat-strip. Don't re-introduce letter grades in cross-panel summaries. The `deckGrade` prop exists for backwards compatibility but is not rendered.

**Renamed terms (settled UX-315):**

| Old label     | New label        | Surface                              | Rationale                                                       |
| ------------- | ---------------- | ------------------------------------ | --------------------------------------------------------------- |
| Soft score    | Power signal     | BracketBreakdown panel heading + aria | "Soft score" collided with Build health vocabulary; "Power signal" is self-explaining |

**Anti-patterns this rule kills:**
- Showing a raw 0–100 number in the stat-strip or a lane header (panel-internal; use the band label)
- A third grading scale (letter grades) appearing next to band words and bracket numbers
- "Soft score" being confused with Build health's subscore bands

## First-run welcome screen (UX-331)

The first-run gate now routes to `/welcome` instead of `/auth`. Design rulings
settled here:

- **Three doors, two primary.** The welcome presents exactly three CTAs: "Import
  my collection", "Try sample cards", and "Sign in". Doors 1–2 are the primary
  pair (pill-btn-primary, accent fill) because collection activation (getting
  cards in) is the event that makes the app useful. "Sign in" is secondary
  (default pill-btn surface) — it's present but not dominant.
- **Hero-class surface.** The welcome card is hero-class: full-viewport centered,
  `max-width: 400px`, serif brand name (`--font-serif`), pill CTAs. All three
  doors are pill-shaped because they live in the page hero.
- **Brand name + one line only.** The welcome copy is the app name ("SpellControl")
  and a single tagline. No feature list, no tour. Any extra copy increases the time
  before the user can do something real.
- **No exit animation.** The welcome is a one-shot surface that replaces itself
  immediately when any door is chosen. Instant replacement via React state is the
  symmetric exit — it reads as deliberate action, not a vanish.
- **Entrance animation.** `welcome-rise`: opacity 0→1 + translateY 12px→0 over
  `--motion-gentle` (320ms) `--ease-out-soft`. No exit needed (see above). The
  `prefers-reduced-motion: reduce` block sets `animation: none` — not a 0.001ms
  backstop (infinite loops don't apply here, but the reduced-motion gate still must
  be explicit per the Motion § Reduced-motion rule).
- **Dismissal on doors 1 & 2 only; door 3 defers to AuthPage.** "Import" and
  "Try samples" call `markEverVisited()` immediately (the user has made their
  activation choice). "Sign in" navigates to `/auth` without marking — the auth
  store calls `markEverVisited()` on any auth completion, so if the user abandons
  /auth the welcome reappears on next boot.
- **Sample load reuses the existing path.** Door 2 calls `importText` →
  `loadSampleBinders` exactly as BindersIndexPage does (same CSV, same store
  action). No fork of sample data; the import appears as the normal deletable
  "Sample: starter pack" entry in import history.

## Keyboard shortcuts — discoverability pattern (UX-334)

**One global overlay, one registry.** The `?` key opens a single
`KeyboardShortcutsOverlay` (a shared `Modal`) from anywhere outside a text
input. Pages/components contribute their section via
`useRegisterShortcuts(sectionTitle, shortcuts)` from `lib/shortcut-registry`.
The overlay renders all mounted sections in registration order ("Global" always
first, since Layout mounts it first). Do NOT wire a local `?` listener in a
page — the global listener in Layout handles it.

**`shortcuts` must be stable.** Pass a module-level constant or `useMemo` array
— never an inline array literal. An inline literal creates a new reference on
every render, causing `useRegisterShortcuts`'s effect to re-register
repeatedly (an infinite render loop).

**Input guard.** The `?` key is suppressed when focus is inside any
`<input>`, `<textarea>`, `<select>`, or `contentEditable`. The guard is
`isTypingTarget` from `lib/shortcut-registry`.

**Footer chip.** A `<button className="footer-shortcuts-chip">` in `Footer.tsx`
calls `show()` from `useShortcutRegistry`. It is `display:none` by default and
revealed only at `≥1024px` + `(hover:hover) and (pointer:fine)` — i.e. desktop
fine-pointer only. Do NOT add similar chips to page headers/toolbars.

**`kbd` styling.** The overlay uses `.shortcuts-overlay-kbd` (from `global.css`).
The footer chip uses `.footer-shortcuts-kbd`. Both have the same visual treatment
(mono, small-caps-border box) — don't hand-roll a third variant.

---

## Extending this guide

When you and a reviewer settle a recurring visual question ("should X be a pill?",
"which radius?", "where does this overlay live?"), add the ruling here in a
sentence or two. Keep entries short and prescriptive — a rule, the rationale if
it's non-obvious, and the anti-pattern it prevents. This doc is only useful if it
stays current, so prefer editing it over re-deciding.

---

## Deck-analysis band words

### Avg mana value (curve)

Three words map a deck's avg-CMC pacing, rendered beside the number in `DeckCurvePhases`:

| Band word      | Typical avg CMC | Pacing keys                           |
| -------------- | --------------- | ------------------------------------- |
| `lean`         | < 2.8           | `aggressive-early`, `fast-tempo`      |
| `balanced`     | 2.8 – 3.5       | `midrange`, `balanced`                |
| `top-heavy`    | > 3.5           | `late-game`                           |

The mapping is a pure exported function `avgCmcBandWord(pacing)` in `DeckCurvePhases.tsx`. Do not duplicate the logic elsewhere.

### Salt score (EDHREC)

Four words map a card's EDHREC salt score (0–4 scale), rendered in `SaltiestPanel` beside each raw score:

| Band word        | Score range  |
| ---------------- | ------------ |
| `table-friendly` | < 0.5        |
| `mild`           | 0.5 – 1.4   |
| `spicy`          | 1.5 – 2.4   |
| `polarizing`     | ≥ 2.5        |

The mapping is a pure exported function `saltBandWord(salt)` in `SaltiestPanel.tsx`. The avg-salt footer also shows the band word for the deck-level average.

---

## Suggestion feeds (Coach tab — UX-401)

The Coach tab (`?view=tune`) is the one prescriptive surface: a ranked,
filterable list of moves the user can apply to improve their deck. The
design rulings below are binding for any future work on the feed.

### Row anatomy

Every suggestion row is a `DeckCardRow` instance and contains, from left to
right:

1. **Thumbnail** — card art (CDN, cached via `useCardThumb`). Tap opens the
   card carousel (the complement view). On a swap row, the outgoing card art
   sits left of an arrow, dimmed.
2. **Body** — card name (bold, `--text-sm`) + verdict chip(s) (shared
   `VerdictBadge`) + plain-English reason (`--text-xs`, `--text-secondary`,
   3-line clamp). Inclusion % is hue-tinted per the verdict badge's
   red-<10%-only rule. The body is **non-interactive** — only the thumbnail
   and action buttons are tap targets.
3. **Secondary action (Fit?)** — an outline rect button (secondary-action
   style: `--surface` bg, `--border` border, `--radius`) rendered just before
   the primary action on every **add** and **swap** row. Absent on cut rows.
   Aria-label: "Will {name} fit this deck?". Minimum 36px touch target on
   coarse pointers. Tapping opens the `CardFitPanel` audition for the incoming
   card; on swap rows the outgoing card is pre-seeded as the first cut
   suggestion (`pinnedCutName` prop).
4. **Primary action** — accent-fill rect (`deck-card-row-act`). Verb = "Add",
   "Swap", or "Cut" per the `change.type`. On apply-success the row exits with
   the **row-leave animation** (see Motion below).

Never hand-roll a suggestion row outside `DeckCardRow` — the primitive owns
the thumb, badges, reason, and action layout.

### Tiered ordering

The ranker (`lib/coach-rank.ts`) orders moves in three tiers, then by
`deltaScore` / `inclusion`, owned-first within each tier:

| Tier | Trigger | Examples |
| --- | --- | --- |
| **Tier 1 — severe deficit** | a gap/upgrade move whose target sub-score is < 60 | fill-gap adds when `roles` scores 45 |
| **Tier 2 — quality** | move targets the weakest `PlanScore` sub-score and it's < 75 | ramp gap when `roles` is the weakest signal |
| **Tier 3 — polish** | everything else | combo completions, budget swaps, bracket nudges |

(Deck-size and missing-win-condition *structural* alerts have no concrete card
move, so they live in the NextBestMove headline above the feed, not as ranked
rows.)

Owned cards surface before unowned within each tier (the standing
`sortOwnedFirst` rule). **No raw score numbers in the UI** — the ordering is
felt, not displayed, to avoid implying false precision.

### Filter-chip row

A row of 999px-radius toggle chips (aria-pressed) sits above the feed. Rules:

- Chips wrap (`flex-wrap: wrap`), never clip — a narrow phone adds a second
  line, not horizontal overflow (control-row rule from the Toolbars section).
- A chip is hidden when its count is zero (except "All").
- Count badges inside chips are `--text-muted` when inactive, `--accent` when
  the chip is pressed.
- The `f` key cycles chips in order (All → first non-zero chip → … → wrap),
  guarded by `isTypingTarget`. Register it under the "Coach" section of the
  `?` overlay via `useRegisterShortcuts`.

### Cuts are separated

Cut suggestions **never interleave** with add/swap rows. They live in a
collapsed `<details>` disclosure at the feed's end ("Cuts (N)"), closed by
default. Opening it does not expand the feed inline — it appends beneath the
last add/swap row. Mixing cuts into an adds feed reads as noise and makes it
unclear whether a row is an opportunity or a warning.

### Apply feedback

When the user clicks Apply on a row, the order is **animate, then apply** —
the persisted analyses don't recompute synchronously and a cut mutates the
store synchronously, so apply-first either snaps the row back or skips the
animation entirely:

1. The row plays the **row-leave animation** (`coach-feed-row-leaving` class +
   `@keyframes coach-row-leave`): `translateX(0) → translateX(-1.5rem)` with
   `opacity 1 → 0`, duration `var(--motion-base)`, easing
   `var(--ease-out-soft)`; `pointer-events: none` while leaving. The Change is
   parked until `animationend`. Reduced motion: the apply fires immediately and
   no animation plays. A mid-animation unmount flushes the parked apply — the
   click is never lost.
2. On `animationend` the apply dispatches (existing engine handlers, no new
   mutation paths) and the id moves to a "departed" set that hides the row
   while the deck update propagates.
3. The feed filters every row against the **live deck list** (`deckNames`),
   so the applied row drops out for real — and an Undo (which restores the
   deck) brings the suggestion back automatically.
4. A toast with Undo appears (the existing `recordEdit` / toast-with-Undo
   contract).
5. Survivor rows may reflow. A FLIP list animation is explicitly out of scope
   (tracked as UX-409).

### Empty states

| Situation | Copy |
| --- | --- |
| No suggestions at all (deck is tuned) | "Nothing to coach — this deck looks tuned." + hint: "Your deck is well-covered. Try adjusting your bracket target or browsing themes below." |
| A filter chip returns zero rows but other rows exist | "No {filter} suggestions right now." (inline, no doors) |
| Analysis still pending and no changes yet | Skeleton (`deck-analysis-skeleton` pattern — see Deck-analysis tabs section) |

## Binder spread (≥1024px)

### When spreads render

The flipbook (`BinderPagePreview`) activates spread mode exclusively via a JS
`matchMedia('(min-width: 1024px)')` listener. The class `is-spread` is added to
`.binder-pages-backdrop` from JS — there is **no CSS `@media` duplicate**. This
is intentional: DOM and CSS must never disagree about which layout is active.
Spread mode only appears inside the flipbook overlay; the binder grid view is
single-column at all widths.

### Pairing convention

`buildSpreads(pageCount, doubleSided)` in `lib/binder-spreads.ts` owns the
pairing logic:

- **doubleSided (book/verso-recto):** The first spread always has a blank left
  side with page 0 on the right — matches physical book convention. Subsequent
  spreads pair pages as verso/recto pairs. A trailing odd page lands on the
  left of a final spread with a blank right.
- **Single-sided (simple pairs):** Pages pair sequentially: [0|1], [2|3], etc.
  A trailing odd page becomes the left of a final spread with a blank right.

### Spine

The `.binder-spread-spine` element is `aria-hidden` and purely decorative. Its
width is an exact fraction of `--slide-size` (set via `--spread-spine-frac` from
JS) so that pages + spine sum identically to `--slide-size` at every viewport —
no height overflow.

### Tab-divider rules

Physical index-tab dividers appear in the left/right gutters outside the spread
slide when the binder has more than 1 section. They are rendered only in spread
mode; nothing renders below 1024px.

**Side split:** a section's tab goes on the **left** when its first page's
spread index is ≤ the current spread index (passed / current sections). It goes
on the **right** when its first page is on a later spread (upcoming sections).

**Current section:** the last left-side tab in section order — the section whose
pages this spread is showing. It carries the `is-current` class and gets an
accent-tinted background and border.

**Compression ladder (per side, decided independently):**

1. If all tabs fit at the full-tab height (default 56px + 6px gap) →
   `variant: 'full'` for all tabs on that side: truncated label text in
   `writing-mode: vertical-rl` + a `ColorPip` when the section has one.
2. If all tabs fit at the mini height (default 30px + 6px gap) → all tabs go
   `variant: 'mini'`: pip if available, else the first character of the label.
3. Otherwise, **sample**: always keep the first tab, last tab, and (left side
   only) the current tab. Fill the remaining capacity with evenly-spaced picks
   from the middle range. Everything in the sampled set is mini.

The compression ladder is a **lib contract with unit tests** —
`layoutSectionTabs` in `lib/binder-spreads.ts` covers the containment
invariant (`top ≥ 0` and `top + height ≤ gutterHeight`) across 2/8/27/40 tabs
at gutter heights 300/600/900px. If you change default heights or the gap,
update the tests.

**A mini tab is a compressed state of a labeled control, not a new glyph.** The
full label is always present as the button's `title` attribute and
`aria-label`, so assistive technology and pointer hover always expose the real
name. There is no Key entry for mini tabs — they require no separate legend
entry because they reduce from full tabs, not from standalone glyphs.

### Exact-fraction geometry rule

The pages + spine already consume exactly `--slide-size` (the exact-fraction
contract from PR-1). Tab gutters live **outside** that budget:

- `--spread-tab-gutter: 30px` is set on the `.is-spread` track rule.
- When tabs actually render the backdrop also carries `is-tabbed`, and the
  `.is-spread.is-tabbed` track override subtracts both gutters from the
  `--slide-size` first min() term (`calc(100cqw - 2 * var(--spread-tab-gutter))`),
  so pages+spine still fit inside the available viewport width. A no-tab
  spread binder (≤1 section) keeps the plain `.is-spread` sizing — no width
  is reserved for gutters that don't exist.
- The slide's `.binder-pages-slide--tabbed` modifier widens its `flex-basis` to
  `calc(var(--slide-size) + 2 * var(--spread-tab-gutter))` so the slide
  envelope covers both gutters — applied to every slide (windowed or
  placeholder) so slide widths never change as spreads enter/leave the
  render window.
- The centering spacers (`::before/::after`) have an `.is-spread.is-tabbed`
  override that accounts for the extra gutter width so first/last spreads
  still center.

**Hard rule:** anything added to a spread slide must either live inside the
pages+spine fraction budget (touching `--spread-page-frac` / `--spread-spine-frac`)
or extend the slide's flex-basis explicitly (like the `--tabbed` modifier above).
Never let content push the pages' computed height past the track — the
exact-fraction contract is what eliminates height overflow at every viewport.
