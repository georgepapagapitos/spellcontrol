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

## Overlays

- On-demand panels that shouldn't live inline (Add cards, Test hand) use the
  shared **card-picker** pattern: `.card-picker-root` + `.card-picker-sheet` —
  a **bottom sheet on mobile, centered modal ≥1024px**. Dismiss via backdrop
  tap, a close button, and `Esc`.

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

Transform/opacity only — never animate layout properties. Every entry
animation has a symmetric exit. Motion expresses causality (where did it
come from / where did it go), not decoration.

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

## Extending this guide

When you and a reviewer settle a recurring visual question ("should X be a pill?",
"which radius?", "where does this overlay live?"), add the ruling here in a
sentence or two. Keep entries short and prescriptive — a rule, the rationale if
it's non-obvious, and the anti-pattern it prevents. This doc is only useful if it
stays current, so prefer editing it over re-deciding.
