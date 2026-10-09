# Style guide: Charts & meters

Line, radar and money charts, bars and meters. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, color and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## Charts (line / trend)

First instance: the Breakdown drawer's Value section (`components/collection/ValueTrend.tsx`).
Any future line/trend chart follows the same specs (horizontal bars stay on
`MeterBar`/`StackedBar` — this section is for plotted charts):

- **Marks:** 2px line, round join/cap, in `--accent`; area wash under it at
  ~10% opacity; current/hovered point is a ≥8px dot (r=4) with a **2px
  `--surface` ring** so it reads where it crosses the line.
- **Chrome is recessive:** gridlines are 1px solid `--border` hairlines at a
  few _clean_ values (1/2/2.5/5×10ᵏ steps), never dashed. One axis only —
  never a dual-axis chart.
- **Text wears text tokens, never the series color.** Tick/axis labels in
  `--text-muted`, endpoint label in `--text-secondary`, `tabular-nums` for
  tick columns. Label selectively (endpoint, extremes) — never every point.
- **Hover/readout layer is part of the deliverable:** crosshair snaps to the
  nearest data x (the reader aims at a date, not a 2px line), one tooltip
  with the **value strong, label secondary**; same readout on keyboard
  (arrow keys step points, Escape clears) and `role="status"` so it's
  announced. `touch-action: pan-y` so scrubbing doesn't eat page scroll.
- **A single series gets no legend** — the section title names it. ≥2 series
  need a legend before a second color is added.
- **No trend, no chart:** with fewer than two points the section renders
  nothing (insight-strip rule) — never an empty-state chart.

## Bars & meters

Every horizontal proportional bar goes through the shared
`components/shared/MeterBar.tsx` primitives — **never hand-roll a bar track**
(a `style={{ width: '…%' }}` fill div; a source-scan test,
`lib/no-handrolled-bar-tracks.test.ts`, enforces this):

- **`MeterBar`** — single fill: `value`/`max`, optional `color`,
  `size` (`sm` 6px meter / `md` 12px progress), `minPct` visual floor,
  `indeterminate` sweep, and `tick` (a target or threshold on the same
  scale, drawn as a 2px notch: the Dialed-in line on build health, a role's
  want). A target is a tick on the one bar, never a second bar beside it.
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
into `role="progressbar"` (see `ProgressBar`).

**Small-integer counts (a 0–3-ish scale) use discrete pips, not a bar.** A
proportional track reads as a percentage, so "Fits 1 engine" as a third-full
bar is false precision (E95). Render N round dots (`999px`, `var(--border)`
track / semantic fill color), `aria-hidden`, with the true count as adjacent
visible text — same a11y story as bars. Pips are fixed-size, so they don't
(and must not) route through `MeterBar`. Vertical charts (curve hero,
test-hand histogram) are charts, not meters, and stay bespoke. Radar/polar
charts also stay bespoke — see **"Radar / polar charts"** below.

**Category-view bucket header gauges (E124)** are `MeterBar` `size="sm"` with
`max={Math.max(target, count)}` — the same honest-length rule as any other
bar, just scaled per section rather than deck-wide. The generator's two
catch-all buckets, Synergy and Utility, never carry a target (there's no
planned slot count to gauge against) — those sections render a plain count,
never an ungauged bar standing in for one. A `<div>` (`MeterBar`'s root)
can't nest inside the section `<h3>` (phrasing content only), so the gauge
sits as a sibling of the heading inside a shared flex wrapper — see
`.deck-section-title-row` in `styles/deck-builder-card-list.css`.

## Money deltas & value sparklines (E76)

A signed money change ("+$18 this week", "Value down $4") follows the
stat-tile delta convention:

- **The sign carries the direction; color only reinforces it.** Always render
  the `+`/`−` (typographic minus, U+2212) in the text — color is never the
  sole channel. Whole dollars via `formatMoney(..., { wholeDollars: true })`.
- **Direction colors:** up = `var(--success)`, down = `var(--err-text)`,
  zero/flat = `var(--text-secondary)`. A zero delta reads as a word
  ("Steady"), not "+$0".
- **Color every rendering of the same delta, not just the sparkline's own
  line.** When one money delta is restated in more than one place on a
  page — a hero's inline figure, a sheet headline repeating it, a strip's
  compact teaser — every rendering gets the direction color, not only the
  first. `WelcomeDigest` shipped with the sheet headline colored and the
  strip teaser a few pixels away flat `--text-secondary`; fixed by giving
  the teaser's `$`-delta its own span with the same up/down/flat modifiers,
  leaving the surrounding compound text ("+$18 · Sol Ring → High Value")
  neutral — color only the money segment, never the whole line.
- **Be honest about the window.** "this week" only when the data actually
  spans ~a week and is current; a gappy or stale log names the baseline date
  instead ("since Jun 7" via `lib/collection/value-history.ts` `formatDayKey`).
- **A collection change is not a market move.** When cards were added or
  removed inside the window, the headline delta speaks for prices alone
  ("+$45 from prices this week") and the cards part follows as its own phrase
  ("+$1,058 from cards added"), in `--text-secondary`, never the direction
  colors: an import is not a gain. `formatValueDeltaChip` is the one place
  that decides this; a log that predates the split (no `market` on a point)
  shows the combined total and never a guessed breakdown.
- **Movers read in total impact.** A mover's headline figure is what it did to
  this collection (per-copy move × copies, the order the list is sorted in);
  the per-copy move is secondary detail ("×8 at −$0.31 each").
- **Trend sparklines** are decorative reinforcement: small inline SVG
  polyline, line in the accent at reduced opacity with the latest point as a
  solid accent dot, `aria-hidden` with the delta text (plus an `.sr-only`
  prefix) as the accessible content. Render nothing below two data points —
  no empty state. A full plotted chart instead follows § Charts (line /
  trend); reference: `components/collection/ValueTrend.tsx`.

## Radar / polar charts

A radar chart is permitted only when displaying **≥3 labeled dimensions of one
normalized measure** — where shape = balance, not absolute magnitude.

Rules (all mandatory):

- **Normalization must be stated in an adjacent caption.** Never imply an
  absolute scale. The caption reads "Engine balance, not power" with an
  InfoTip explaining that vertices are normalized to the busiest axis.
- **Every vertex carries its word + value** — label + count, no unlabeled
  vertices, ever. (The "charts say what they mean" obligation extends to polar
  geometry.) A two-part label breaks only at its slash, one name per line
  ("Tokens /" over "go-wide"); a width cap that broke inside a word or after
  a hyphen ("go- / wide") read as a rendering bug.
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
  `lib/deck-analysis/playstyle-radar.ts` + the co-located component; `radarLayout` is the
  single geometry source.
