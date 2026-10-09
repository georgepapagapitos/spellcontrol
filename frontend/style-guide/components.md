# Style guide: Shared components

Tabs, toolbars, editors, config surfaces, empty states, hints and tooltips: the pieces most screens compose. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, color and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## Tabs / view switchers

- Page-level "distinct views" switcher → the `underline` variant of
  `components/overlays/Tabs.tsx` (accent underline tracks the active tab). It reads
  unambiguously as tabs; the soft nav-pill look of the site and section nav
  (`.site-nav-link`, `HubTabsNav`) does **not**, and stays there.
- **The accent cover dye marks the CURRENT tab of the primary nav only; a
  second nav tier below it marks its current tab with an accent underline.**
  Both the leather header nav and the hub strip (`HubTabsNav`) share
  `.site-nav-link`, and both used to take the dye on `.active` — so on
  `/collection/lists` the parent (COLLECTION) and its child (LISTS) rendered as
  two identical filled tabs, one above the other, each hanging off its own
  hairline ~12px apart. Same marker at both levels = no hierarchy, and the pair
  read as a staircase. Their near-alignment was coincidence, not structure — the
  offset moves with whichever pair of tabs is current — so the fix is to
  separate the **tiers**, never to align the boxes. The hub's current tab is
  now `--text-primary` + `box-shadow: inset 0 -2px 0 var(--accent)` riding the
  strip's bottom border (inset, so the tab's box and the strip's layout are
  untouched), with no hover lift, because it is the page you are already on.
  Any third nav tier steps down again — it does not reach back for the dye.
- **A scrollable tab strip tells you it scrolls.** `Tabs` (`--scrollable`,
  `--underline`) sets `data-overflow="start|end|both"` on its root
  from its own scroll position and the stylesheet masks that edge with a
  `--space-6` fade (`components/overlays/Tabs.css`), the same tell `HubTabsNav`
  carries; the selected tab is also scrolled into view on change. A strip
  whose last tab is cut off flat at the viewport edge reads as the end of
  the list — the fade is what says "more". Every strip on the primitive
  gets it for free; don't hand-roll a per-page gradient.
- All tabbed surfaces go through the shared `components/overlays/Tabs.tsx` primitive
  (roving tabindex, arrow-key nav, `role=tablist`/`tab`/`tabpanel`). Don't
  hand-roll a tab strip. **This applies inside overlays, sheets, modals, editor
  panels, and admin/debug pages too** — an internal audience does not exempt a
  view from keyboard navigation. Partial ARIA (a hand-rolled `role="tab"` with
  no roving tabindex or arrow keys) is **worse** than none: it advertises a
  contract the component then fails to honor. Use the primitive.
- **Position a boxed `Tabs` strip with `margin`, never `padding`.** The
  `className` a consumer passes lands on the `.sc-tabs` element itself — the
  box that paints the strip's background and border, and whose own `0.2rem`
  padding is the active pill's inset. A consumer `padding` on that class
  replaces the inset: the strip's background runs edge to edge while the pill
  sits flush against one side (the rules reference, binder card editor and
  opponent board all shipped this way). `styles/tabs-consumer-overrides.test.ts`
  guards every `fitted`/`scrollable` consumer; `underline` resets its own box
  and is exempt.
- **A fitted strip that would ellipsize wraps instead.** `fitted` shares the
  row equally and clips labels, so four labeled tabs with count badges read
  as "Bat… 3 / Gra… 1 / Co… 0" on a 360px sheet (the opponent board, E280).
  Below the sheet breakpoint such a strip wraps to a 2×2 grid
  (`flex-wrap: wrap` + a ~50% basis on `.sc-tab`) — keeping every label a whole word
  and the strip one tablist. Don't abbreviate labels or switch to `scrollable`
  to dodge the wrap; a whole word beats a hidden tab.
- **`fitted` requires labels that are short AND equal**, never more than three
  tabs. The concrete test: at 320px and full panel width every label must render
  in full with no ellipsis (a 3-tab fitted strip gives each tab ~106px ≈ 10
  characters; a trailing count badge counts toward that width). If any label
  fails, use `variant="scrollable"` (tabs size to content, the strip scrolls).
  Four or more tabs always use `scrollable`. "In deck" vs "One card away (N)" and
  "Battlefield" both fail the test.
- **A boxed track hugs its content; only `fitted` fills the row.** The three
  track primitives (the `scrollable` Tabs strip, `SegmentedControl` and
  `ViewModeToggle`) carry `width: fit-content; max-width: 100%`, so the box
  ends where the last option ends and still scrolls or wraps when the options
  outrun the row. A track stretched across the panel with its options huddled
  at the left reads as an empty field. It shipped that way on the currency
  toggle, the cube size toggle and both Combos strips, each time patched in
  the consumer. Fix it on the primitive and never add a per-consumer `width`
  for it. Never `align-self` either: a definite width already opts out of a
  column's stretch, and these tracks also sit in toolbar rows, where
  `align-self` knocks them off the row's center line. A two-way picker is one
  of the three primitives, never a hand-rolled fieldset: an icon layout switch
  is `ViewModeToggle`, a labeled one-of inside a panel is `SegmentedControl`.
  `styles/settings-card-body-stretch.test.ts` guards all three.
- **Pass `variant="underline"` explicitly on every page/section-level switcher.**
  `Tabs` defaults to `variant="fitted"` (equal-width segments, each label clipped
  with `text-overflow: ellipsis`). `fitted` is **only** for 2–3 short, equal-length
  labels inside a panel (combos/analysis; Play's Host/Join sub-switcher). Omitting
  the prop on a page-level switcher with unequal labels silently truncates them at
  every width — "Online"→"Onli…", "Create account"→"Create acc…" — because the
  segments are forced into equal fractions regardless of available room. This bit
  both the Play sections switcher and the Auth (Sign in / Create account) toggle.
  Compliant reference call sites: DeckEditor, Friends, Cube.
- **An exclusive-value picker is NOT a tab strip.** A segmented control that
  picks a _setting_ (USD/EUR price currency) rather than switching visible
  views uses native radio semantics — a `fieldset` of visually-hidden
  `<input type="radio">`s stretched over styled label spans — not `Tabs.tsx`
  (`role=tablist` advertises panels that don't exist) and not `aria-pressed`
  button pairs (radios give exclusivity + arrow-key group nav for free). Same
  family as the Settings theme picker. Reference: the shared `SegmentedControl`
  (`components/shared/form.tsx`), which is exactly this pattern packaged as a
  primitive — SettingsPage's Price currency row is one of its ~11 call sites.
  **Never hand-roll the ARIA instead** (`role="radiogroup"` + `role="radio"`
  buttons). Sixteen components did, and every one shipped with no roving
  tabindex and no arrow-key handling — a 7-swatch color picker ate 7 tab
  stops while announcing "radio group, 1 of 7" and then ignoring the arrows.
  That is the same "partial ARIA is worse than none" failure called out for
  tabs above. Pinned by `src/test/no-aria-only-radiogroups.test.ts` (E201).
- **A segmented control inside a TRACK marks the selected segment with a
  raised chip, never an accent fill.** The track is a padded, bordered
  container (`--surface`, `var(--radius-lg)` or `999px`, `var(--space-1)`
  padding + gap); the selected segment lifts onto `--surface-raised` with
  `box-shadow: inset 0 0 0 1px var(--border-strong), var(--shadow-raised)`
  and `--text-primary` text at weight 600, while the rest stay
  `--text-secondary` on transparent. **The ring and the weight are part of the
  chip (revised 2026-09-24, E410).** The chip alone read faint on the light
  themes, where `--surface-raised` sits a few shades off `--surface` (Public
  on the new-deck Visibility control looked unselected). The ring is inset so
  it takes no layout and never overlaps a neighbor. Guard:
  `styles/segmented-selected-chip.test.ts`. **`--accent` stays reserved
  for primary actions** — filling a passive setting with the same color as
  the Save button makes the two compete, which read worst on the home hero,
  where a scope toggle sits directly beneath the primary CTA. On a track that
  is already `--surface-raised`, invert it: the chip lifts to `--surface`
  (`.deck-curve-phases-toggle`, `.card-group-layout-toggle`), keeping the ring
  and the weight.
  Reference: `.segmented-option.is-selected` in `components/shared/form.css`.
  This applies **only to controls in a track**. A standalone row of chips or
  option cards with no container behind them (`.format-pill-row`,
  `.bracket-pill-row`, `.option-grid`, `.gen-mode-grid`, the Discover filter
  chips, `.deck-editor-zone-toggle`) has nothing to raise against, so those
  keep their accent fill / accent tint — the tint specifically for larger
  multi-line option cards, where a solid fill behind a label + sublabel is
  heavy and hurts the sublabel's contrast.
- **`fitted` Tabs = a real tab strip, not a value-picker**, even though it
  visually reads as one segmented control. The test: does each segment swap
  in a _different set of rows_ (a view), or does it just set an inert
  property with no panel of its own? The add-cards panel's source switch
  (`CardSearchPanel.tsx`: Collection | Suggestions | Scryfall) is the
  reference: each segment swaps in a different result list, so it is `Tabs` +
  `role="tablist"`/`"tab"`/`"tabpanel"`, **not** the radio-fieldset above
  (that pattern is for a single inert setting like currency, where there's no
  panel to switch; using it here would falsely suggest there's nothing to
  disclose). A single-tab case drops the strip rather than rendering a 1-item
  tablist.
- **Sideboard and Considering are deck sections, not a panel (2026-09-27,
  supersedes E176's tabbed panel).** They render as two more sections at the
  foot of the deck (`.deck-outzone` in `DeckDisplay.tsx`), drawn by the same
  renderer and header as the deck in the current view mode: tiles in grid, a
  stack in stacks, rows on the deck's own column grid in list. Chevron, icon,
  name, count and price like any section, collapsible outside stacks (keyed
  `outzone:<title>`, so the choice holds under every lens). The old shape was
  a bordered, tinted panel titled "Not in the deck" with a Sideboard |
  Considering `fitted` tab strip over a row list in every view mode. Under a
  grid of card art that read as a form from another app, and the tab hid one
  pile behind the other for a zone of a handful of cards. The rulings:
  - **Each pile is ONE section**, whatever the lens. A pile of a few cards
    split by type would put a header over every second card.
  - **An empty pile stays on the page** as its header plus one muted line
    (`TypedGroup.empty` → `.deck-section-empty`), because it is where "Move to
    sideboard" and "Move to considering" land and where the page hero's "+N
    sideboard" link jumps. It states no price. A pile a search filters to
    nothing hides like any other section instead of claiming to be empty.
  - **What separates them from the deck is order and the pile's own name**,
    plus `margin-top: var(--space-5)`. No box, no divider, no extra title.
  - **Neither pile feeds stats, legality, mana or the role lens**, which
    never dims their rows.
- **`BinderTabs.tsx` is a deliberate, permanent exception to "all tabbed
  surfaces go through `Tabs.tsx`" above (E164).** It hand-rolls plain
  `<button className="tab">` elements instead of the primitive because each
  binder tab carries **what the primitive has no slot for**: a fill in the
  binder's own color and a Manual badge, plus a trailing "+ New binder" tab
  and an "Export" action. It used to hang a per-tab ⋯ menu (reorder, edit,
  delete) off the active tab too; E472 removed it, because the binder's
  actions have one home on its page, the header ⋮ (see § Binder views).
  `Tabs`' `TabItem[]` is a flat label/count/icon shape with one `onChange`,
  and bolting per-tab color on for this single consumer would be speculative
  (YAGNI) until a second tab strip needs the same thing.
  **The a11y gap this used to leave open is closed (E206)** — hand-rolling the
  markup doesn't mean hand-waving the semantics: `BinderTabs` carries its own
  `role="tablist"`/`"tab"`/`aria-selected` and roving tabindex with
  ←/→/Home/End navigation, built directly on the component rather than by
  extending `Tabs.tsx` (no second consumer of the per-tab affordance set
  existed at the time — see the revisit condition below). Two things about
  the pattern are worth naming so they don't get re-derived or regressed:
  - **The `role="tablist"` wrapper scopes to just the real tabs.** The
    trailing "+ New binder"/"Export"/"Delete all" buttons are actions, not
    views to switch to, so they render as plain buttons _outside_ the
    tablist wrapper rather than fake `role="tab"` elements — a `display:
contents` wrapper (`.binder-tablist`) carries the role without adding a
    layout box, so `.binder-tab-row`'s flex/scroll behavior is unaffected.
    `display: contents` has a documented history of dropping an element
    (and its role) out of the accessibility tree entirely; it's safe here
    only because role preservation for elements with an explicit ARIA role
    is fixed in every engine this app targets — Chromium 89+, Firefox, and
    WebKit (Safari 16 on macOS, iOS Safari 17). It stays a hazardous
    property for role-bearing wrappers in general, and **jsdom/happy-dom
    tests cannot catch a regression in it** — they don't model CSS-driven
    accessibility-tree exclusion at all, so a browser regression here would
    leave the whole suite green while the tablist silently lost its role.
    Anyone reusing this trick for a role-bearing wrapper should confirm the
    role survives in a real browser's accessibility inspector, not just in
    tests.
  - **The `BinderOverflowMenu` trigger is a DOM sibling of the tab button,
    never a descendant.** Nesting an interactive control inside `role="tab"`
    is its own a11y bug — roving tabindex only manages the tab elements
    themselves, so a button nested inside one becomes unreachable by
    keyboard. `.binder-tab-group` already rendered the trigger as a sibling
    before E206; that shape is what made adding the roles safe without a
    restructure, and it must stay that way if this component changes again.
  - **What must still stay in lockstep with `Tabs.tsx`** even though the
    implementations are separate: the pill's corner radius (`var(--radius)`,
    same token family `Tabs` uses for `.sc-tab`); the **active tab reading as
    the highest-contrast, filled state** in the same "stamped" vocabulary as
    every other active/pressed control in the app (T53's inset top-face
    highlight + weight/color shift) — `BinderTabs` fills with the binder's own
    color rather than `--accent` because the tab set doubles as a binder-color
    legend, which is an intentional, narrower divergence, not sloppiness;
    the `2px solid var(--accent)` / `2px` offset `:focus-visible` ring
    (`.tab:focus-visible` in `styles/tabs.css` matches the ring every other
    tab/button in the app uses); and the overflow behavior on a cramped strip
    — horizontal scroll with a hidden scrollbar and touch momentum
    (`overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling:
touch`), byte-identical between `.binder-tab-row` and `.sc-tabs--scrollable`.
    The 44px coarse-pointer touch target: `.sc-tab` and `.tab` now **both** get
    an explicit `min-height: 44px` under `pointer: coarse` / `≤700px`. E164
    closed a real gap here — `.tab`'s `6px 14px` padding alone is only ~33px
    tall, which breached the E68 convention. Keep the two blocks in lockstep.
  - **Revisit condition:** if a **second** tab strip ever needs the same
    per-tab reorder/edit/delete affordance set, extract a slot API onto
    `Tabs.tsx` (an optional per-tab trailing-affordance render prop) and
    migrate both consumers onto it — don't copy `BinderTabs`'s hand-rolled
    pattern to the second call site. One consumer needing this is not enough
    to justify the primitive growing an affordance-slot API; two is.

## Toolbars & action rows (responsive)

Horizontal strips of buttons/controls in a header are the app's most repeated
overflow bug: each time a new control is added, the row outgrows a phone and the
last item clips. There are **two kinds of strip**, each with one rule — and one
hard constraint they share.

**Hard constraint (both kinds):** a strip that can ever exceed the viewport must
**never** be `flex-shrink: 0` + no-wrap. That combination is exactly what clips
at 320px. If it can't shrink, it must wrap or collapse.

**Every multi-button row declares its own `gap: var(--space-2)`.** `.btn` sets
no sibling margin by design, so _all_ spacing between buttons comes from the
parent — a flex row that omits `gap` renders its buttons flush against each
other with zero separation. The `display: flex; justify-content: flex-end;`
footer idiom is the usual carrier: it was copy-pasted into several action rows
without the `gap` line, which shipped touching Cancel/Confirm pairs across the
choice dialogs, the card-picker sheets, the deck-filter popovers and the build
report. When you write that idiom, write the third line too.

1. **Action rows** — a primary call-to-action plus secondary actions (the page
   heroes: Decks / Collection / Binders).
   - Keep the **primary CTA labeled and always visible.**
   - Collapse the **secondary actions into a `⋮` overflow at `≤600px`** using the
     shared `components/overlays/OverflowMenu.tsx` (kebab + popover, outside-click/Esc
     close; opens from its own wrapper — for **virtualized rows** use
     `CardRowMenu` instead, which portals out of the clipping row). The Decks
     hero is the reference: New deck stays a labeled pill, Import deck + Add
     precon move into the kebab on phones.
   - Don't "solve" crowding by going **icon-only on ambiguous glyphs** — a box
     for "Add precon" isn't legible without its label. Icon-only is only for
     universal glyphs (search, close, settings). When a labeled action must
     shrink on phones, swap to a **shorter label** instead of dropping the text
     (Home's Quick Actions are the reference: "Import cards" → "Import",
     "Plan a game night" → "Game night" at ≤600px, long/short span pair with
     the aria-label matching the long form).
   - **A kebab that outgrows ~6-7 rows needs labeled sections, not one flat
     list** (E181 — the deck editor's `⋮` had grown to 12-13 rows across
     fifteen independent PRs, each adding one more item without ever looking
     at the whole menu). Group rows into small labeled clusters with hairline
     dividers between them (`DeckEditorOverflowMenu` in `DeckEditorPage.tsx`
     is the reference — a plain `text-xs`/uppercase/`--text-muted` label
     above each cluster, same idiom as `.collection-filters-section-label`);
     keep Undo/Redo unlabeled at top (their own top-of-menu convention
     predates sectioning) and destructive actions unlabeled at the very
     bottom. **Every row still needs the coarse-pointer 44px floor** — apply
     it to the shared row class, not to whichever row happened to be newest
     when someone last touched the file. **A menu tall enough to threaten
     off-screen rows needs `max-height` + `overflow-y: auto` on the panel**,
     not just on the outer page. And before adding a row that already exists
     as a visible primary control elsewhere on the same surface (E181's kebab
     carried Undo/Redo/Tokens/Pull list _and_ an inline copy of all four),
     ask which surface is the single source for that action — one export
     button beats a kebab AND a toolbar disagreeing about the entry point.

2. **Control rows** — pickers with no single primary action (Sort / Group /
   Filter / view-mode toggles; e.g. `.card-list-summary-actions`, the binder
   sort bar).
   - These **wrap** (`flex-wrap: wrap`) and may shrink — overflowing controls
     flow to a second line, never clip. Adding one more picker (this rule was
     written after "Group by" overflowed the collection toolbar) must stay safe
     by construction.
   - Keep each control compact: a `SelectMenu` shows its **current value** (icon
     - value), not a redundant static label.
   - **Wrap is the safety net, not the phone layout.** Once a control row
     carries enough pickers that it _always_ wraps on a phone — especially a
     **sticky** row, where every wrapped line permanently eats content space —
     consolidate instead of wrapping: split the controls into **data controls**
     (used while browsing: Select / Group / Sort) and **display preferences**
     (set-and-forget: zoom, detail-line toggles, view mode, the symbol Key),
     and collapse the display preferences into **one "View" `ToolbarPopover`
     at `≤640px`** (labeled rows inside the panel; the Key opens as a
     sub-page of the same panel). Desktop keeps every control visible. The
     collection toolbar is the reference (`ViewPopoverPanel` in
     `CardListTable.tsx`); the Decks-hero `⋮` kebab is the _action-row_
     analogue of this rule. Contextual buttons that survive on the row (e.g.
     Expand/Collapse all) may go icon-only on phones **only** if their glyph
     is unambiguous and they keep `title` + `aria-label`.
     The **deck toolbar** (`DeckViewPopoverPanel` in `DeckDisplay.tsx`) is the
     second adopter and the cautionary tale: it kept wrapping instead of
     collapsing long after this rule was written, and at 360px it reached
     **nine controls over three rows** — enough chrome that the decklist
     itself started below the fold on a phone. A control row that wraps to a
     third row isn't "responsive", it's unshipped.
   - **A row's own actions collapse separately from its display preferences.**
     The split is by _what the control does_, not by which fits: display
     preferences go in the "View" popover, actions that mutate the list
     (Select, Test hand, Export) go in a sibling `⋮` `OverflowMenu`. Don't
     park an action inside "View" just because the panel had room.
   - **This rule is CI-enforced, not just written down.**
     `src/components/control-row-budget.test.tsx` renders the deck toolbar and
     the collection toolbar at a phone viewport and asserts the visible
     control count in `.deck-toolbar-controls` / `.card-list-summary-actions`
     stays at its current, already-collapsed number. A PR that adds a new
     inline pill instead of folding it into "View" or the kebab fails that
     test with the actual vs. budgeted count — raise the budget only after
     genuinely re-collapsing the row, never as a way to let one more control
     through.
   - **A count is not the invariant — width is.** A row inside its control
     budget still wraps if the labels are long: the collection toolbar spent
     412px of a 344px row on four controls, so "View" took a line of its own
     above the cards, and the decks sort bar did the same with three. The
     budget test can't see that (no layout in happy-dom), so the nightly
     journey measures it in a real browser — `NO_WRAP_AT_PHONE` in
     `scripts/journey.mjs` fails any listed row that renders taller than its
     tallest child at the phone tier. When a row is over width, shorten before
     you wrap: a `SelectMenu`'s default-state trigger can name what the control
     _does_ ("Group") rather than restate that nothing is set ("No grouping"),
     and a toggle whose state is legible elsewhere on the screen can drop its
     idle label to the glyph (`.toolbar-label-compact` at ≤600px, with
     `aria-label` + `title` carrying the name). The ACTIVE label stays visible:
     "Done" is the way out of select mode and must never be a bare glyph.
   - **A search field is not a control to shorten.** When a search pill and
     its pickers can't share one phone row, the pill takes a row of its own at
     `≤600px` and the pickers share the next one: sort at the start, view
     toggle at the end. My Decks and Discover, the two tabs of one hub, both
     use this shape. The pickers row goes in `NO_WRAP_AT_PHONE`
     (`.decks-index-sort-bar`, `.discover-sort-bar`). A 120px search box that
     truncates its own placeholder is not a fit.

3. **Card action rows** — actions in the footer of a list card (the game-night
   cards are the reference). A card earns **at most ~3 visible controls**, at
   every breakpoint (not just `≤600px` — seven buttons on a card looks broken on
   desktop too):
   - Visible: the actions a _guest/attendee_ reaches for (Copy link, Add to
     calendar).
   - **Owner/management actions** (Edit, Stop repeating, Cancel…) collapse into
     a `⋮` `OverflowMenu` at the card's **top-right** (`margin-left: auto` in
     the head row). Destructive items go last in the menu with `danger: true` —
     a card footer is not the place for a standing red button.
   - **Multi-destination exports** (calendar, share targets) are **one labeled
     menu trigger** (`trigger` prop on `OverflowMenu`, e.g. "Add to calendar ▾"
     with a chevron), never one button per destination.

**Multi-destination exports are one labeled menu trigger — everywhere, not
just card action rows.** The rule above is stated in the card-row context
where it was first settled, but it's binding on **any** surface offering
multiple destinations for the same export/share action. The public
`/gn/:token` game-night page originally rendered "Google Calendar" and
"Download .ics" as two side-by-side `<a>`/`<button>` elements outside any
card — same anti-pattern, different surface. Fixed to reuse the identical
`OverflowMenu` "Add to calendar ▾" pattern from the authed card
(`GameNights.tsx`). Check for this on every new export/share surface, not
just card footers.

Verify all three at the **320px floor** in the Responsive section — that's where
the clip shows up first.

**A search sits beside the list it searches.** One search box serving two
lists needs a scope toggle to say which one, and the toggle is the tell: split
it, and give each list its own search in its own header (Home's hero once had
My decks / Discover over one box; each section now carries its own,
`HomeSectionSearch`). From 600px it is a `SearchPill` that submits to the
list's page; on a phone a second full-width pill in every section header costs
more than it earns, so it is a 44px search button that opens the list's page,
where search is the first control. The app-wide header search (⌘K / Search) is
a different thing and stays.

## Tag chips (E171)

User-defined card tags (deck list/grid + card-preview panel) are **neutral
secondary pills, never `--accent`**. A tagged row must never read as more
"official" or system-driven than a Partner tag or an allocation chip —
tags are the user's own free-text taxonomy, so they get the same quiet
plate as `.deck-row-alloc-chip-claimed-elsewhere`: `var(--surface-raised)`
background, `var(--text-secondary)` text, `var(--border)` 1px border, 999px
pill. Card-preview's dark panel uses the equivalent literal white-alpha
values (`rgba(255,255,255,.08)` bg / `.92` text / `.18` border) per that
panel's existing light-on-dark contract — never theme tokens there.

- **Display is read-only; editing lives in the preview panel and the card
  menu.** Tag chips render wherever a card shows (deck list row, grid tile
  badge, card-preview panel). Only two surfaces carry add/remove controls:
  the **card-preview panel** and the **card menu** (`DeckCardMenuBody`,
  rendered by the list kebab, the tile kebab and right-click alike).
  Amended 2026-09-21, from "the preview panel only". The rule was written to
  stop a second _inline_ editor appearing on every row and tile, each
  repeating the keyboard and focus work. A menu is not that: it is one
  shared, focus-managed body reached from three places, and its items come
  from a single action list (`deck-card-actions.ts`), so there is nothing to
  drift. It is also the only way tagging is reachable at all from the grid
  and stacks layouts, which have no row to hang chips on. The prohibition on
  **inline** tag controls on a row or tile stands unchanged.
- **Filing and membership are two intents, and the menu says which is which.**
  The card menu's Tags section offers "Move to tag" (a `menuitemradio` list
  that HOISTS the picked tag to `tags[0]`, so the card changes section) and
  "Add tag" (a `menuitemcheckbox` list that APPENDS or removes, so the card
  keeps its section). The ARIA role is the whole explanation of what a click
  will do, which is why they differ. Added 2026-09-21: before it, the fast
  path could not express something the card-preview panel could, so "also
  mark this a Wincon" silently moved the card out of Blink.
- **A right-click affordance always ships a visible control in the same
  place.** Right-click does not exist on touch and cannot be reached by
  keyboard, so a surface that opens a menu on `contextmenu` also renders a
  kebab: revealed on hover or focus where a fine pointer exists, and always
  visible under `pointer: coarse`. The deck's grid and stacks tiles are the
  reference (`.deck-card-grid-menu`).
- **Always visible, never hover-gated.** Unlike the system-derived hints
  next to it (synergy ✦, EDHREC %, which hide behind
  `.deck-row-hovermeta`'s `(hover:hover) and (pointer:fine)` gate), a
  card's own tags stay visible at rest. They're user-authored content, and
  — critically — visibility here is what explains the grouping: under
  "Group · Tags" a card is filed under its FIRST tag, so a card showing two
  chips that sits in the section named by one of them is self-evident only
  because both chips are on screen. A card with no tags renders no chip at
  all — zero clutter for anyone who's never touched the feature.
- **The app does not suggest tags.** There was a dashed ghost pill offering
  a role-derived tag on an untouched card; it was removed 2026-09-21 (E371).
  It only ever offered the four `ROLE_TITLES` words, which are exactly what
  the **Roles** lens partitions by and the role filter chips filter by — so
  accepting suggestions rebuilt, one card at a time, a grouping that was one
  click away, and the resulting tags collided with the app's own vocabulary
  on screen. A tag is worth storing when it says something the app cannot
  derive ("Blink", "Combo", "Cut"); if we can derive it, it belongs in a
  lens, not in the user's data. Don't reintroduce a suggestion that
  duplicates a derived taxonomy.
- **Grid tiles get an icon-only badge**, not the tag text (no room) — same
  art-scrim plate as the synergy/role badges beside it, with a small count
  past 1 tag. Full tag names are always readable in the list row or the
  card-preview panel.
- **Coarse-pointer remove/add controls use the invisible expanded hit-area
  technique** (`::after` 44×44 centered over the visual glyph under
  `@media (pointer: coarse)`), the same one `.deck-arrivals-chip` already
  uses — never grow the visible chip itself to 44px, that breaks the
  compact multi-chip flow.

## Rule & filter editors (#1626–#1630)

The binder rule editor, the dynamic-list rule sheet and the collection Filters
dialog all edit card predicates. These rulings apply to every one of them, and
to anything new that edits a predicate.

- **A field's row exists because the field is SET**, not because the field
  exists. The binder/list editor renders only fields with a value (plus ones
  the user just added); the rest live behind a searchable, grouped
  `Add condition` picker. The old fixed form rendered 22 rows for a binder with
  two rules. The vocabulary is data — `lib/search/filter-fields.ts`; a field absent
  from that registry is unreachable in the editor.
  (The collection Filters dialog stays a flat always-visible form: it is a
  narrow-then-apply surface, not an authoring one. `RuleFieldContext` is null
  there, which is what keeps the shared rows unconditional.)
- **Every row that can be set can be un-set from the row itself** — a trailing
  `×` that clears the value and takes the row with it. "Clear everything" is
  not a substitute for clearing one field.
- **Related booleans get ONE heading**, not one heading per checkbox. Four
  consecutive uppercase section labels each gating a single checkbox is how
  the binder editor spent its first screen on rarely-touched options and
  pushed the rules below the fold. They are switch rows now (§ Config
  surfaces).
- **One vocabulary for rules.** A binder or list has **rules**; a rule is
  "Match all of" its **conditions**, and more rules are alternatives — the
  "+ Also take other cards" button, under an "or" divider that follows every
  rule (E497; reopens the wording below, kept the structure). "Rule" used to
  mean both the group and the field inside it, and "AND/OR rule" asked for
  boolean logic before anything could be built. The one explanation lives in
  the ⓘ on the "Cards" heading.
  (Superseded 2026-09-28, E497: the button read "+ Or match other cards too"
  with no visual divider between rules — the divider now carries the "or"
  the button text used to state, so the button can name the ACTION instead.)
- **A predicate has one name across surfaces.** It was "Legalities" in the
  binder editor and "Format" in the collection dialog for the same field.
- **An editing surface shows a live match count.** You should never have to
  commit a filter to find out it matches nothing. Amber at zero.
- **A control that can only ever produce the empty set is a bug, not a
  freedom.** Rarity's joiner is locked to `OR` because a card has exactly one
  rarity, so "rare AND mythic" matches nothing by construction.
- **Options that need a sentence each are a `ChoiceList`, not a segmented
  control.** Three options in a 390px track turned "New page per section" into
  three lines apiece, and the one hint under it rewrote itself per option so
  the three could never be compared. Page filling is three radio rows with
  their hints always visible.
- **A rule's title line is its name, else its autoSummary sentence once it
  has a condition, else "Match all of"** (E497) — its live count and a `⋯`
  menu hold Rename, Duplicate and Remove. An unnamed rule with conditions
  reads what it actually matches ("rare, mythic · ≥ $1.00") instead of the
  generic "Match all of" every unnamed rule used to show; a genuinely empty
  rule still shows "Match all of" since there is nothing yet to summarize.
  The group used to open with an always-editable name field and two 12px
  icons (⎘ ×), which made every rule look like a form to fill in before it
  could do anything.
- **An info-tip sits beside the label it explains, never at the row's far
  edge.** `justify-content: space-between` on the Behavior rows parked each
  (i) 350px from its short checkbox label in the 700px modal, where it read
  as row decoration. A ragged tip column beats a tip nobody associates with
  its option.
- **Every section of an editor carries a heading, including the first.** The
  binder editor's name / layout / capacity / behavior / color block was the
  only unheaded section next to "Filters" and "Sort within binder", so it
  read as the dialog's loose top and the others as sub-sections. (Since T139
  the name and color are the dialog's header, and the rest is Cards, Order
  and Pages; peers still look like peers.)
- **A warning about a state the user has not authored yet waits for them.**
  "This binder has no filters" fired the instant "New binder" opened, before
  a single keystroke. It now waits until the binder is named, a rule group is
  edited, or a save is attempted; an EXISTING binder with no filters still
  warns straight away because that state is real.
- **A dialog list long enough to scroll gets a `SearchPill`**, in a band
  between the tabs and the scrolling body so it stays put. Manage cards
  listed 591 rows with no way to find one. The pill reuses the Add-cards
  picker's predicate (folded name, set code, collector number). The Order
  tab stays unfiltered: a drag-sortable list with hidden rows can't say where
  a drop lands.
- **The collection Filters dialog sections by the same registry groups the
  Add-condition picker uses, in the same order** (`lib/search/filter-fields.ts`:
  Identity, Cost, Text, Printing, Value & play) — one `.form-section-heading`
  per group, its fields inside as plain `Field` rows, not a second heading
  each. The dialog derives the group LIST from `FILTER_FIELD_GROUPS` (minus
  Advanced, which folds into Text — its one field, Scryfall query, has always
  sat next to the other free-text rows) rather than retyping the five names;
  a `dialogGroupVisible` switch is the only hand-kept fact per group ("does
  this dialog show anything here"). `FilterFieldEditor` takes an optional
  `group` prop (dialog variant only) so the dialog can call it once per group
  and interleave its own bespoke rows (color, rarity, set, price, CMC) at the
  right spot in registry order, instead of re-deciding "Format is Value &
  play" as a second hand-kept fact next to the picker's copy. Fields with no
  registry entry (Condition, Language, Binder membership — physical-copy or
  membership concepts, not card facts) sit under their own "This copy"
  heading after Value & play, alongside the Surplus/Proxy/Group-printings
  switches.
- **One set picker, not two.** `SetFilterPicker` takes a plain `options` list
  (`{ code, label, iconSvgUri?, releasedAt? }[]`) so both the binder/list rule
  editor (options = the sets you own) and the collection Filters dialog
  (options = every Scryfall set, via `setMapToOptions`) share one control.
  They used to be two components built from two different option shapes
  (`SetMultiSelect`, folded into this one).
- **The dynamic-list rule sheet is on the shared `Modal`**, exactly like
  BinderEditor: header / one scroll body / result footer with the live count
  and Save, bottom sheet on phone via `modal-backdrop--sheet`. It used to
  hand-roll its own backdrop + sheet shell with a `document` Escape listener
  that fired regardless of stacking, so a nested popover's Escape (the set
  picker, a suggestion list) closed the whole sheet instead of just that
  popover — Modal's own overlay-stack handling replaces it outright rather
  than gating the old listener.
- **"Save as a binder…"** sits in the collection Filters dialog's footer, next
  to Clear, and seeds `BinderEditor` from the DRAFT (not yet applied) filters
  via `editingBinderSeed` (`lib/search/collection-filters-to-binder.ts`). It shows
  only once a structured filter is set — a search-only draft has nothing a
  binder rule can express.

## Config surfaces (T139)

Every dialog that creates or edits a thing (a binder, a list rule, filters, a
card, a game night) is built from one kit in `components/shared/form`. The
binder editor was the first surface on it; the rest move one PR at a time.

**A page section with several closed `Disclosure` rows can scope its own
density tier**, instead of the kit's flat 44px — a bottom-sheet dialog and a
stacked page section don't read the same. `DeckCustomizer` scopes
`.disclosure-toggle` under `.deck-customizer-more-body` to 36/40/44px (guard:
`styles/deck-customizer-rows.test.ts`).

**A config dialog answers its questions in order of how often they change.**
The binder editor is the reference:

1. **Identity is the header.** Name and color are a color dot and an inline
   name field in the dialog's title bar, the way the deck hero edits both. Not
   a "Basics" form section.
2. **The main job is always open.** For a binder that is "Cards": its rules,
   plus the two switches that change membership (include deck and cube cards,
   keep printings together).
3. **Defaults most people keep are `Disclosure` rows that state their value**
   ("Order · Color (WUBRG), then Name", "Pages · 9-pocket · one side · …").
   Settings are grouped by what they are about: page filling and page breaks
   are Pages (paper), not Sort. A control that only applies in some states
   (sections by rule with two or more rules; page breaks with two or more
   sorts) is hidden until it applies, and its parent says how to unlock it.
4. **The answer sits in the footer, beside the primary button.** "300 cards
   land here · 400 match · 100 go to Secret Lair, above", amber at zero. It is
   the one place the count is stated; a rule's own count is its title line.
5. **A warning offers its fix as a button.** "Every matching card already
   lands in Secret Lair" carries "Move above Secret Lair"; the move previews in
   the counts at once and applies on Save like every other edit.

**A new X with presets starts from a chooser**, not from a blank form: the
preset tiles first (each with a live count of the user's own cards where one
means something), then "Blank", then any other way to start ("From a list").
A mode that shares almost nothing with the default (an import) is a start of
its own and shows only the controls it uses; never a segmented toggle halfway
down the form with the rest of the form still showing and ignored. Editing
never shows the chooser.

**Ten-plus tiles group by job** (E495, the binder chooser): tiles doing the
same kind of work sit under their own labeled group (`SectionHeader`
`variant="overline"`) — "Pull out a pile", "One slice", "Deck-building pools" —
rather than one flat grid that mixes "keep this safe" with "feed a deck".
Anything without a real filter (Blank, a catch-all, an import) stays in its
own dashed, ungrouped row last, unchanged from the single-preset case above.

- **Every tile states the order it will use and the page count it lands on**,
  not just a raw match count — a preset name (from the shared preset list the
  order picker itself offers) plus "N cards · N pages" from a real materialize
  at the surface's own new-item defaults. A tile that still needs a second
  step ("A set") states its order but swaps the count for the next step
  ("Pick the set next").
- **The count is "would land here", not "matches".** Run the SAME
  first-match-wins pass the editor's own footer uses, with the tile's filter
  appended LAST — where a new item actually goes — against the surface's real
  existing items. When something upstream claims the difference, say so
  instead of just showing a smaller number: "N match · would land" when
  partial, "N match · all in `<name>` now" when something already claims all
  of it.
- **Overlap between two tiles is said out loud, twice.** A standing note under
  the description states the relationship whether or not the other tile has
  been made yet ("Part of Ramp"); the live would-land count above independently
  confirms it once the other one actually exists. Neither replaces the other —
  the first is always true, the second is only true after the fact.
- **A tile whose filter needs a value picked on the spot (a color) puts the
  picker ON the tile**, as its own control (a real radiogroup, never silently
  defaulting), separate from the tile's own "make it" trigger so picking a
  value never also commits.
- **Compute every tile's count off the idle queue, never inline in render.**
  Ten-plus materialize passes against a real collection is real work (~100ms
  each on ~11k cards); block nothing, show "Counting…" per tile until its
  answer lands, and cache by (filter, order) so switching a picked value back
  to one already computed is instant.
- **On a phone, tiles compact to a row**: name on its own line, order and
  count together on the line under it; the description drops (the name, order
  and count already answer "what is this and what will it look like", and the
  full sentence is one tap away after picking). An overlap note is the one
  exception — kept, on its own line, because it changes what the tile means.

**The kit, one job each:**

| Piece              | Use it for                                                                                                                                                                                    | Never                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Section heading    | The heading over a block of fields. The ONLY uppercase role in a form (`.form-section-heading`).                                                                                              | Field labels or option text in uppercase.                               |
| `Field`            | A sentence-case label, the control, a visible hint.                                                                                                                                           | An InfoTip where one line of hint fits.                                 |
| `SwitchRow`        | A setting that is on or off: full-width `role="switch"`, label, one-line hint, On / Off value ([§ Table settings](overlays.md#table-settings-holds-preferences-never-game-state-2026-09-24)). | A checkbox for a setting. Checkboxes are for picking items from a list. |
| `SegmentedControl` | Two or three short options: native radios in a track, raised chip. `fill` for a row of short tokens that must all stay in view (condition grades).                                            | aria-pressed button pairs; options needing a sentence.                  |
| `ChoiceList`       | One-of where each option needs a sentence.                                                                                                                                                    | A single hint that rewrites itself per option.                          |
| `Disclosure`       | A group of settings most people leave alone; summary while closed.                                                                                                                            | Identity, or the dialog's main job.                                     |
| `SelectMenu`       | Five or more options. Inside a `Field` it draws as a field-width rect, not the toolbar pill.                                                                                                  | A native `<select>`.                                                    |
| `.form-input`      | A typed answer in a `Field` (text, date and time, a notes `<textarea>`): the same field-width rect as the `SelectMenu` above, 16px text.                                                      | A bare `<input>` in a `Field`, which renders as the browser's own box.  |

- **A group of rows is a fieldset whose legend wears the `Field` label**
  (serif, sentence case, `--text-secondary`), with the rows in one
  field-width rect on the `.form-input` surface and a hairline between rows.
  Never a box with its caption sitting on the border (the game-night dialog's
  Invite friends, Who's in, Blocked and vote-time groups). Guard:
  `src/test/form-kit-usage.test.ts` fails on an unclassed `<input>` or
  `<textarea>` directly in a `Field`.

- **`.field label` never uppercases a checkbox.** The old descendant rule
  caught every label inside a field, so the binder editor's "Double-sided" and
  "Fixed" read as headings (guard: `styles/form-labels.test.ts`).
- **A dialog on this kit opens as a bottom sheet on a phone**
  (`backdropClassName="modal-backdrop--sheet"`). Its footer keeps the answer
  and the primary action; Cancel leaves the phone footer because ×, the
  backdrop and the back gesture all dismiss.
- **A hand-rolled control fails CI.** `src/test/form-kit-usage.test.ts`
  counts `role="switch"` outside the kit, `aria-pressed={a === b}` (an
  exclusive choice on toggle buttons) and native `<select>` per file. A new
  file with one, or a higher count in a listed one, fails. Every listed file
  names the ruling that keeps it; the rollout's leftover debt (E423) is
  cleared, so a new match is fixed with the kit, never allowlisted.
- **An option that can't be picked right now stays in the group, disabled,
  with the reason in view** (`Option.disabled`, on `SegmentedControl` and
  `ChoiceList`). Hiding it teaches that the choice doesn't exist; graying it
  with no reason is a dead end. Public on the new-deck form while signed out
  is the case that needed it.

### Binder views

- **The list collapses identical adjacent copies; the page grid never does.**
  Seven "Mountain SLD #2418" rows say nothing seven times, so the list shows
  one row with a ×7 badge and the first copy's page number, and the section
  header reads "81 cards · 55 unique". The grid stays one pocket per copy
  because that IS the physical binder. Both read the same physical
  materialization, so the hero totals and page numbers never change with the
  view — the earlier "Group printings" toggle collapsed copies BEFORE
  materializing and so reported 452 cards in a 591-card binder; it now
  applies to the page grid only, where fewer pockets is the point.
- **The rules editor previews the DRAFT, not a summary (E493).** `BinderEditor`
  widens to a two-column modal (`binder-editor--wide`, 1120px) for the "rules"
  step: the left column is the editor, the right is a sticky `Preview` —
  the first spread of pages from a REAL materialize pass of the draft
  (`lib/binder/binder-counts.ts:materializeDraftPreview`), built from the exact
  `BinderInput` Save would write (one `buildDraftInput()` feeds both, so the
  preview can never show a binder Save wouldn't produce) and the same
  `useBinderLayoutInputs()` chain every other binder surface reads (never a
  second partial chain — see `one-binder-layout-chain.test.ts`). Pages reuse
  `PageGrid`, the same pocket component `BinderView` renders inline. The
  column is DEBOUNCED (200ms) against the draft's page-layout inputs — the
  footer's live counts stay instant, only the heavier page/section rebuild
  waits for typing to settle. A `Sections` list names each section's start
  page; clicking one jumps the spread. On a phone there's no room for a
  column, so a compact strip sits under the header instead (one mini page +
  page/binder-of-capacity stats + the first section); tapping it opens the
  real `BinderPagePreview` on the draft's own pages. Neither the preview nor
  the strip render during the "From a list" import step: each staged file
  becomes its own binder only once the import runs, so there is no single
  draft def to materialize yet.
- **"A card goes to the first binder that wants it" is a ladder, not a
  footnote (E493).** `BinderLadder` (Cards section, `routingMode: 'rules'`
  only) lists every binder in waterfall order plus Uncategorized last, counts
  from the SAME rules-only materialize pass the footer's "N land here" and
  "N go to X, above" already read (`countEffectiveLanding`'s `ladder` field)
  — they can't disagree because they're the same pass. The draft's own rung
  always reads "This binder", never its typed name mid-edit. A non-zero
  `caughtAbove` adds a dim line naming the catcher with the EXISTING
  "Move above" fix as a link (the same handler the amber zero-landing warning
  already wires — reused, not rebuilt; the two can coexist, so a test
  clicking "Move above X" uses `getAllByRole(...)[0]`). On a phone the ladder
  shows only its immediate neighbors (one above, the draft, one below) plus
  a "Show all binders" expander — ordinals are computed over the FULL list
  first, so the visible neighbors keep their real waterfall position instead
  of renumbering 1/2/3.
- **A whole-library destructive action has one home: the last, `danger`
  item in the index page's header ⋮.** "Delete all binders" / "decks" /
  "lists" and Collection's "Delete collection" all sit there. Red and last
  is the separation: the shared `OverflowMenu` draws no dividers (every card
  ⋮ already ends on a red Delete the same way), so don't add one for this
  item alone. It is offered only when there is more than one item (one
  item deletes from its own card or row). "Delete all binders" first sat in every binder page's tab strip
  as a peer of "+ New binder" and "Export", then under each index as a small
  red text link, which read as an afterthought and put the same verb in a
  different place on each page. Every other page-level destructive action
  (Delete binder, Delete pod) was already a ⋮ item.
- **A page is shown at a size you can read.** The page grid is a fluid grid
  whose track floor is 5rem per pocket column (`.page-row--p4/--p9/--p12`:
  10 / 15 / 20rem), so a pocket is the same size whatever the pocket count: a
  phone gets one full-width 9- or 12-pocket page per row (~110px pockets) and
  a desktop gets as many ~270px 9-pocket pages as fit. Pages used to be
  fixed 112/150/200px thumbnails: 42px pockets on a 1440 screen, and on a
  phone a lone page in one half of the row with the other half empty. Text-only
  pockets scale their name with the pocket (`cqw`), for the same reason.
- **A section teases one full row of pages, never a fixed page count**
  (`SECTION_PAGE_ROWS`; the header-less run of a page-filled binder shows
  `PAGE_RUN_ROWS`, three). The row's column count is read back from the
  rendered grid (`useGridColumns`), so with 9-pocket pages it is one page on
  a phone, two or three on a tablet, five on a laptop and seven on a 1920
  screen, and it
  follows every resize, rotation and zoom. A fixed three left four empty
  columns above "+32 more pages" on a wide monitor, and was a screen and a
  half of scroll per section on a phone. The "+N more pages" expander and the
  page viewer carry the rest. Any inline teaser over a fluid grid follows the
  same rule: cap in rows, not items.
- **A page's header is its door into the page viewer.** "Page 3" on the left,
  the book glyph "Browse pages" uses on the right, the whole row one button.
  It replaced an underlined mono "page 3" link floating centered above the page.
- **The cards no binder takes are the index's last tile, "Uncategorized"**
  (E471). One name for that pile everywhere: the collection filter, both pull
  lists and the ownership lens already said Uncategorized, so the tile does too
  (not "Unfiled", not "Matched no binder"). It sits after every binder because
  it is below every binder in priority; it never displaces them. Same geometry
  as a binder in grid, list and compact, with a dashed outline and a neutral
  band, because it is not a binder. It renders nothing when every card has a
  binder, and hides while searching or selecting. It is a button, not a link:
  it opens one sheet (`UncategorizedSheet`) with up to three binders made from
  the pile's biggest ideas (one per kind: card type, color, rarity, price, each
  counted by the real rule engine), an "Everything else" catch-all, and "See
  the cards". A suggestion opens the rules editor seeded, the same path as
  Save as binder, so nothing is created without the user seeing "N cards land
  here".
- **A card preview opened from a binder leads with why the card is there**
  (E470), in CardPreview's meta slot, the same slot the deck view uses for its
  context: "Filed by the rule “Rocks”." (the rule's name, else the editor's own
  auto title, from `lib/search/filter-summary.ts`), "Added here by hand…", the price
  margin, or its other printings. The reason is the one `materializeBinders`
  recorded when it placed the card (`MaterializedBinder.reasons`), never
  re-derived, so it cannot disagree with the routing. At most one "also" line:
  a binder above the user took it out of, else the first binder further down
  whose rules match it (catch-alls and manual binders say nothing). Same block
  in the page grid's preview, the page viewer and the list's preview
  (`useBinderCardPreview`).
- **The preview carries the card's binder actions**: Move to binder, then Set
  cover. Move hands the card to the move sheet, so the preview closes as it
  opens (`CardPreviewAction.closesPreview`), the way Edit does.
- **A binder has one menu** (E472): the same items, from
  `useBinderActions`, on its index tile's ⋮, the right-click that opens it,
  and its own page's header ⋮: **Binder rules**, **Share**, **Move up / Move
  down**, **Delete binder**. "Binder rules" is UX-305's name for the editor,
  now used everywhere. On the page, Binder rules and Share may stand as buttons
  where the header has room; reordering and Delete stay in the ⋮. Every move
  toasts how many cards changed binder, wherever it was made. The tab strip has
  no menu of its own.
- **An empty binder warns only where it does harm.** Above another binder it
  takes that binder's cards: the amber banner. Last in line it is a catch-all:
  a plain note saying what it does. Both open "This binder has no conditions".
- **One control row for all three views** (`BinderSummaryBar`): Browse pages,
  the sort chip, then Collapse, layout, Key and View options at the end.
  Display preferences (layout, card images, Group printings, the symbol key)
  are the View popover's on a phone (≤640px), where the row holds one line and
  the sort chip is the one control that ellipsizes. It used to be two copies of
  the same markup that wrapped to three rows at 390px around a stray "·", with
  two of the display toggles hidden behind an eye inside the search box.
- **Volumes are derived, never persisted** (E494). A binder bigger than its own
  `fixedCapacity` is physically several books — ONE rule set, N books — so
  `planVolumes` (`@spellcontrol/binder-routing`, wrapped by
  `lib/binder/binder-volumes.ts`) re-derives them from an already-materialized binder
  every render, exactly like page numbers themselves. It cuts at a section
  boundary whenever the next section fits in what's left of the current
  volume; a section bigger than a whole volume splits at a page boundary,
  never mid-page.
- **A normal shelving state, not a warning.** Splitting into volumes is how
  the user plans to shelve an oversize binder, so it reads neutral: no ⚠, no
  warn tone, on the hero or the index tile's "N volumes" chip. The
  over-capacity amount still rides along in the hero control's accessible
  title, for whoever wants the number, without painting the whole state red.
- **Never an inline panel — a sheet.** An insight surface never displaces the
  page's own content (`feedback_insight_surfaces_never_displace_content`), so
  the hero's volumes item is a plain-text `Button variant="link"` reading "N
  volumes" that opens `BinderVolumesSheet` (`Modal` +
  `modal-backdrop--sheet`: a bottom sheet on a phone, a centered dialog
  above — the same pattern as `DeckFormatSheet`). The sheet lists each
  volume's page range and first/last section ("White → Blue"), never inline
  in the page flow itself.
- **The fit is page-based, and the fix is a real action.**
  `smallestFittingCapacity` compares the binder's PAGE count against a
  size's own page depth (`floor(size / pocketSize)`), never a raw card
  count — a binder whose sections each start a fresh page can need far more
  pockets than its card total suggests, and a card-based comparison would
  silently offer a size that doesn't actually fit. When one fits, the sheet
  shows "Use a &lt;size&gt;-card binder": a real `updateBinder({ fixedCapacity
})` through the store's normal path, with an undo toast (same shape as
  `resumeRules`'s), never a hand-rolled sync write and never just a link to
  the editor. When nothing fits, the sheet says so plainly and still offers
  "Binder rules" as the secondary way in.
- Gate every volumes UI on `volumes !== null && volumes.length > 1` — a binder
  with no fixed capacity or one that fits never says "Vol 1".
- **Volumes are worked out once, from the unfiltered binder, and handed down.**
  BinderPage computes them from its search-free pass and passes them to the
  grid view (its page viewer) and the list view as a prop. A view never
  recomputes them from the binder it renders: during a search that is the
  narrowed pass, which drops pages. The list view did exactly that until
  2026-09-28, so a search inside a multi-volume binder renumbered its volumes.

### Plan a shelf (E496)

Most people don't want one binder — they want their whole collection in
binders, in the right order. `PlanShelfModal` (`Modal` +
`modal-backdrop--sheet`, same pattern as `BinderVolumesSheet`) proposes an
ordered set at once instead of a normal binder trip repeated seven times; the
plan engine (`lib/binder/shelf-plan.ts`) is pure and reuses `materializeBinders`
directly rather than re-deriving counts.

- **Four strategies, each a fixed bucket order, never user-reorderable**: By
  color (W/U/B/R/G, then Multicolor, each ONE rule group: the "Color group"
  field — `colors IS <key>`, a chip expression over `getColorKey`'s per-card
  bucket — AND `typeTokenChips NOT land`. Deliberately the legacy `colors`
  field here, not `colorIdentity` (the ground-truth audit's exact-combo rule,
  #2351): `colorIdentity` can express only one specific combo per group, so a
  Multicolor binder built from it needs 26 OR'd groups — unreadable in the
  rules editor. `colors`/`getColorKey` is the SAME bucket the Color sort's
  sections and the chooser's "One color" tile already use, so this isn't a
  new classification, just a plain single-rule binder; a card with no
  Scryfall color data reports `''` internally and matches no color binder,
  falling through to the catch-all rather than vanishing or getting its own
  bucket), By set (the collection's own biggest sets, oldest-set-first inside
  each — one per set is unusable and one per year doesn't map to a shelf, so
  this is the one sane middle), By card type (`TYPE_ORDER`'s own precedence,
  so an ambiguous card lands exactly where `getCardType` already says it
  belongs), and Value first, then color (three price tiers, then the same
  color split for what's left). Switching strategies re-proposes the whole
  bucket set and re-checks everything — a chosen strategy's rows don't carry
  over into another strategy's unrelated ones.
- **"Pull these out first" rows are the only reorderable ones** (Worth $5+,
  Commanders, Lands) — a grip-and-drag inside a bottom sheet fights the
  sheet's own swipe-to-dismiss, and three rows is short enough that Move
  up/down buttons are the whole affordance, on every width (no phone/desktop
  split the way the sort chain's grip has one). They sit ahead of every
  strategy's split in binder order, so first-match-wins lets them claim their
  cards before the split runs.
  - Checking a row is picking an item out of a list, not a setting, so it's a
    plain checkbox (`form-kit-usage.test.ts` correctly leaves checkboxes
    alone; a `pressed`/`aria-pressed` toggle-chip shape here would trip the
    guard, which is why the strategy picker above is a `ChoiceList`, not a
    chip row, despite the mockup drawing chips).
- **Every row shows a count and a page total whether it's checked or not.** A
  checked row's number is the real, engine-computed figure that will be
  created (a second `materializeBinders` pass with ONLY the checked rows); an
  unchecked row's is informational — what it would hold if you checked it now,
  given the rows above it — computed from a first pass with every row present
  so unchecking one is never a silent "where did that count go".
- **A catch-all is always last and always active — never optional, never
  shown as a real choice.** It has no interactive checkbox (a static
  checkmark instead), so the plan can always say "0 left over" and mean it; a
  guard test (`shelf-plan.test.ts`) asserts the invariant against the real
  engine for every strategy, not just trusts the arithmetic.
- **Every proposed binder is one rule group** (a guard test caps it at 2) —
  the plan is meant to be opened and read in "Binder rules" afterward, not
  just trusted; a bucket that needed a hidden OR-list to work would defeat
  that the moment someone looked.
- **Volumes reuse the exact same derivation as a normal binder** (`planVolumes`
  via `lib/binder/binder-volumes.ts`) — every proposed binder defaults to the
  standard 360-card/9-pocket size specifically so the plan's volumes note
  ("White · 3 volumes of 360") means something before the binder even exists,
  the same "derived, never persisted, a normal shelving state" ruling as
  above.
- **Existing binders are placed FIRST and never re-offered.** The plan
  materializes `[...existing binders, ...proposed rows]` in that order, so a
  card an existing binder already claims never reaches any plan row or the
  totals — "your 3 existing binders stay in front of these" in the footer is
  the literal routing order, not just copy.
- **Name collisions are silently disambiguated**, "White" → "White 2", against
  both the user's existing binder names and the plan's own rows — the
  editor's own collision PROMPT is specific to its import-batch step and
  isn't reusable here; a batch create has no natural place to pause and ask
  per name.
- **Create is one store operation** (`createBinders`, sibling of
  `createBinder`) — a shelf's worth of binders lands as a single `set()`
  (positions `existing count + index`), not N calls that would each
  re-render/re-persist. The confirmation toast ("Created 9 binders") offers
  Undo, which is exactly `deleteBinders` on the ids just created — no bespoke
  removal path.
- **Entry points**: the chooser's lead wide tile ("Organize my whole
  collection") and the binders index — its ⋮ menu once a collection exists,
  and the empty state's primary button once cards are imported but no binder
  exists yet. The chooser tile can't open the planner directly (it renders one
  layer inside `BinderEditor`, which the planner isn't part of) — it closes
  the editor and hands off via `?planShelf=1`, consumed once by the index page.
  Hidden entirely for an empty collection; a genuinely empty or fully-filed
  collection that reaches the sheet anyway (a direct link, a reload mid-param)
  gets an honest sentence instead of a picker with nothing to pick.

### Pages as pictures (E494/E473) — the editor's own Pages disclosure

Everything above is the binder PAGE's volumes UI (post-save). The editor's
Pages disclosure (`BinderEditor`) answers the same "what will my pages look
like" question while the binder is still a draft:

- **Pocket count is tiles, not a bare number.** The kit's own
  `SegmentedControl` (native radios — never a hand-rolled tile/card
  component), each option's label a `PocketGlyph` grid plus the count plus
  what a buyer would call it ("Most binders", "Toploader pages", "Zip
  binders") — a physical product, not a raw integer.
- **Sides is a two-outcome `SegmentedControl`** ("One side" / "Both sides"),
  matching the sort-direction ruling (§ Sort chains) rather than a switch —
  Double-sided read as a setting with only one label showing at a time.
- **Holds is chips of real SKU sizes**, from `standardBinderSizes(pocketSize)`
  (so a 4- or 12-pocket binder shows its OWN sizes, not the 9-pocket numbers),
  plus "No limit" and "Other…" (reveals the number input only then). A custom
  size that doesn't match a chip shows as "Other…" selected — never a chip
  silently unchecked.
- **"When a section ends" (page filling) gets a decorative pictogram per
  option** — two tiny CSS pages, `aria-hidden`, so "Keep sections whole" vs "Fill every
  pocket" is seen, not parsed from three sentences that all start "Every
  section…". The pictogram sits inside the same `<label>` as the option text,
  contributing nothing to its accessible name.
- **A control that can't do anything right now stays in the group, disabled,
  with the reason in view (T139)** — never hidden. Page filling and page
  breaks disable (with a one-line reason) when `sectionMode: 'group'`, since
  `buildGroupSections` never reads either; "Keep sections whole" disables when
  Leave room is set (see below); page breaks and "Section headers come from ›
  Rules" disable, rather than hide, below two rules.
- **"Leave room" (`BinderDef.sparePockets`, E473) reserves trailing pockets
  after each section** so new cards have somewhere to go without reshuffling
  everything after them — a `ChoiceList` of None / Half a page / A full page,
  sized to the current pocket count. It **forces page sharing off**
  (`packSections: true` disables) — reserved room can only stay contiguous
  and adjacent to its own section if nothing else is ever packed onto the
  same page — and is **inert under "Fill every pocket" packing**, which already leaves
  zero pockets by design; the field's own hint says so rather than blocking
  the pick.
- **The page-break select is named by the fields, not by "levels"**: "Nothing
  deeper", then "‹field› inside each ‹previous field›" — replacing "First 2
  sort levels" and "Section headers only".
- **Section headers come from" is a `ChoiceList`, not a `SegmentedControl`**
  (T139: options that need a sentence each) naming the REAL first field
  ("The first field above (Color)") instead of the generic "The first sort",
  and lives in the Order disclosure next to the fields that make the
  sections, not in Pages.
- **The editor's own over-capacity answer reuses the binder page's volumes
  vocabulary**, never a separate one: `formatPagesSummary` appends "N need M
  binders of C" to the closed summary the moment the DRAFT (not the saved
  binder) outgrows its own capacity, computed from the same debounced
  `materializeDraftPreview` pass the preview column already runs — never a
  second materialize call. The open body lists each volume compactly and
  offers "Use a binder that fits", which sets `fixedCapacity` to
  `smallestFittingCapacity(draftPreview.totalPages, …)` as an ordinary draft
  edit (applied on Save like everything else in this dialog — no toast, since
  nothing has been saved yet). When nothing fits, the same `noFitMessage()` the
  sheet uses says so, with no button. `volumesOfCapacity()`/`noFitMessage()`
  (`lib/binder/binder-volumes.ts`) are the ONE wording for "N binders of C" and "N/A
  fits" — `BinderVolumesSheet` and the editor both call them; a phrase should
  never be retyped at a second call site.

### Binder page viewer (flipbook)

- **Same geometry model as the card preview (rebuilt 2026-09-25).** Every
  length comes from the viewport (the backdrop is the one
  `container-type: size` box) and the page shape (`--page-w-ratio`): a top bar,
  the page centered on the stage, and a **fixed-height panel** below. No text
  may size the layout. The viewer used to be a grid with an auto-sized column,
  and a Secret Lair binder's six-drop section line grew that column to 1208px
  on a 384px phone, so the page, the name and the scrubber all centered
  off-screen and the viewer opened blank. Guarded by
  `binder-page-sizing.test.ts` and the journey's "binder page viewer geometry"
  check, which injects a long line.
- **The open page is the only thing at full strength.** Opaque page,
  neighbors under the card preview's dark wash (never opacity, which let the
  grid behind read through them) and a 90% scrim.
- **Each fact once.** The top bar says where you are ("Page 3 of 14"; during a
  search only matching pages remain, so it reads "Page 12 · 3 of 5 shown",
  the one case where the physical page and the position differ). Once a binder
  reads as more than one volume, the top bar leads with which book ("Vol 2 ·
  Page 45 of 63") — never for a binder that fits in one. The panel says what:
  the binder name, then the page's sections, at most two lines, ellipsized.
- **More than two pages get a scrubber** (a native range at the panel's foot).
  A 60-page binder is 59 swipes end to end; the scrubber jumps. Its touches
  stop at the input so a sideways drag can't start the sheet's swipe-down
  dismiss.
- **Arrows sit beside the page, are hidden on touch, and a disabled one is
  hidden everywhere.** A ghosted disabled arrow outranked the touch rule and
  showed page 1 a dead Previous arrow and no Next. Empty space closes, as in
  the card preview; a pocket opens its card.

### Sort chains

- **Named orders sit IN FRONT of the chain editor (E491).** Six presets — Set
  collection, Newest sets first, By color, By card type, Most valuable first,
  A to Z — are each just a saved chain with a name and a one-line description
  (`SORT_PRESETS` + `matchSortPreset()`/`describeSortChain()`, all in
  `@spellcontrol/binder-routing`; no engine change). A stored chain matching a
  preset shows that preset's NAME everywhere the chain appears — the pill, the
  sort sheet, the binder editor's Order summary — via one shared
  `sortOrderSummaryLabel()`; anything else is the chain spelled out in words
  ("Rarity, then price" — sentence case, only the first field keeps its
  capital; `EDHREC rank`'s acronym survives the lowercasing on purpose), never
  the field-id/arrow breadcrumb. The seventh option is **"Choose fields"** —
  never "Custom order", which already names the hand-dragged manual order
  (Manage cards › Order, #2446) and would collide with it. `SortPresetList`
  (radio rows with a description each — the sort sheet) and `SortPresetChips`
  (compact one-line pills — the binder editor's already-open Order disclosure,
  AND the desktop popover, where seven full-description rows pushed the chain
  editor below the fold of a 1440×900 panel) are the two renderings of the
  same list; don't hand-roll a third.
  - **"Choose fields" is a navigation, not a persisted value a native radio's
    `change` event can re-fire.** When no preset matches, "Choose fields" is
    already the checked option by construction — so a plain `onChange` handler
    never sees a second click on it (clicking an already-checked radio fires
    no `change` event at all). `SortPresetList` wraps the group in an
    `onClickCapture` that fires the navigation on every click regardless.
- **Direction is a two-option `SegmentedControl` showing BOTH outcomes**, never
  a single button stating the current value that flips on tap — the old editor
  flipped asc/desc by re-selecting the field you already had, with nothing on
  screen suggesting that did anything, while the ▲/▼ buttons sitting where a
  direction control belongs did reordering instead.
- **Label a direction with its EFFECT, not `asc`/`desc`.** Ascending release
  date is newest-_last_; ascending EDHREC rank is most-popular-_first_;
  ascending price is cheapest-first. One word, three mental models. Each field
  carries both phrasings in `SORT_FIELDS.dirLabels` ("Newest first", "A → Z",
  "Most played") — resolve with `sortDirectionLabel()`. A surface whose sort
  keys aren't the shared `SortField` union (decks, binders, lists) authors its
  own pair beside its option list; it does not fall back to asc/desc.
  `SORT_FIELDS` also carries a **`dirShort`** pair beside `dirLabels` (E492) —
  the same two outcomes, shortened ("Oldest"/"Newest", "Cheap"/"Pricey") for a
  width-capped host. Never a different direction, only shorter words. Both
  spans render always; a **container query** on the sort editor's own box
  (`@container sort-editor`, never a viewport media query — the popover/sheet
  is width-capped regardless of screen size, E299) shows the short one and
  hides the long one once the host narrows, so the SegmentedControl's
  accessible name — set explicitly per option, not left to the wrapping label
  — stays the long form at every width. **Color's ascending option renders as
  five color pips**, not the word "WUBRG" (jargon to a newer player; the pips
  are the physical game's own symbols) — the word survives only as the
  option's accessible name. Its descending option is "Reversed" at both
  lengths; "GRBUW" (WUBRG spelled backwards) was never anyone's word for that.
- **The field picker hides fields another row already uses.** A second pass on
  the same field has no ties left to break.
- **Levels have jobs, not just positions.** Row 1 is labeled **"Sections"**
  and has no remove control, ever — a binder needs one, so removing it isn't a
  disabled button, it's an absent one. Every row after it is labeled **"Inside
  each section"** once, not per row. This is the existing
  first-sort-makes-the-header rule, now visible instead of implicit.
- **Reorder is a drag handle with full keyboard support on a wide host, and a
  named row menu on a narrow one — never drag inside a sheet.** A drag gesture
  fights a bottom sheet's own swipe-to-dismiss and scroll. `SortEditor` decides
  by the same phone-tier query the rest of the app uses (`max-width: 599px`),
  not a prop the caller has to thread through:
  - **Wide:** a grip (`dnd-kit`'s `PointerSensor` + `KeyboardSensor`, the same
    machinery `SortValueOrderEditor`'s value chips already use) plus a
    standalone remove `IconButton`.
  - **Narrow:** an `OverflowMenu` per row — **"Use \<field\> for sections" /
    "Move \<field\> up" / "Move \<field\> down" / "Remove the \<field\> sort"**
    (the section row's menu has neither "Use for sections" nor "Remove") — and
    no standalone remove button; the menu takes the × off the row entirely.
    Every item names the row it acts on (§ Verbs — Menus), never "Move sort
    up" three times.
- **The tie-breaker hint is one plain sentence with a Change link, not an
  engine-vocabulary list.** "Then tie-broken by: Treatment → Finish → Name"
  became **"Copies that still tie: showcase before regular, foil before
  etched, then name."** — a customizable field (treatment, finish) reads as
  its two extreme values under its current order; a plain field is just named.
  **Change never touches the chain.** It expands, in place under the
  sentence, the same `SortValueOrderEditor` a chain row uses, one per
  customizable tie-breaker, and toggles back to "Done" to collapse — the
  earlier design _appended_ Treatment/Finish to the chain, which mutated it as
  a side effect of asking "what order do these tie-break in", silently
  disappeared once the chain hit `MAX_SORTS`, and is exactly why a
  tie-breaker isn't in the chain in the first place (nobody asked to sort by
  it). Change is always available, with no `MAX_SORTS` gate.
- **Same-day sets under a Release-date sort read A → Z** (or follow the chain's
  own Set direction when it has one) — never the date's direction. "Newest
  first" used to flip three same-day Secret Lair drops into Z → A headers while
  the cards inside sorted A → Z. The engine also keeps those sets contiguous on
  page-filled binders (`withImplicitTiebreakers` splices Set in after the date)
  so a page never labels itself with every drop released that day.
- **Rows are one-line flex rows, not a shared grid.** `.sort-editor` still
  declares `container-type: inline-size` (the popover/sheet host is
  width-capped independent of the viewport), but the old shared-grid-with-a-
  two-line-fallback design (E299) is gone: the field picker takes the
  available space (`flex: 1 1 auto; min-width: 0`), and the direction control's
  own `dirShort` swap is what keeps a row to one line at the sheet's width
  instead of wrapping.

#### The sort sheet on a phone (E492)

At the app's one phone tier (`max-width: 599px`), `SortPopover` swaps its
anchored popover for a bottom sheet built on the shared `<Modal
backdropClassName="modal-backdrop--sheet">` primitive — reuse it, don't
hand-roll a sheet with `useSheetExit` for this; `Modal` already gives Escape,
back-button integration, focus trap and the sheet-vs-centered-dialog CSS split
for free. Desktop keeps the small anchored popover it always had, now with the
same named orders — as `SortPresetChips`, not the sheet's radio list, so the
panel stays short enough to show the chain editor with no scroll — on top of
the chain editor it already showed.

- **The sheet opens on the named orders**, one radio row per preset with its
  description (`SortPresetList`); **"Choose fields"** drills into the chain
  editor with a back button reading "‹ Choose fields", and **"Done"** closes
  the sheet outright from either page. Every pick **applies live** — no Save
  button, because a sort is something you're looking at, not editing
  (§ Anchored panels).
- **"Your first sections"** — in the chain view only, a strip showing the
  binder's real first ~4 section labels and the page each starts on, plus a
  "+N more" tail, from the SAME materialized binder the page already computed
  (`BinderSection.pages[0].pageNum`) — never a re-derived estimate. Gives the
  chain editor visible feedback without closing the sheet to check it.
- **"Browse pages" reads "Browse" on a phone** — the book icon carries the
  rest — so the sort pill beside it keeps its width budget
  (`control-row-budget.test.tsx`, § Phone chrome density).
- **The camera FAB hides while ANY overlay is open**, not just its own
  scanner — `useAnyOverlayOpen()` (`lib/overlays/overlay-layer.ts`) subscribes to the
  same module-global layer stack every `Modal`/sheet already registers with,
  so a new overlay never needs its own opt-in. Before this, the FAB floated on
  top of whatever sheet or dialog was open over it.

#### The compact toolbar pill (E250)

Where sort is one **pill in a toolbar** rather than a row editor, the rulings
above still hold — the direction control just moves _inside the menu_, because
these rows are width-budgeted and CI-guarded (§ Toolbars & action rows). Use
**`components/search/SortMenu.tsx`**; don't re-assemble it from `SelectMenu` +
`SortDirArrow`. Seven toolbars each carried that same boilerplate, and the
arrow they rendered was a passive status glyph you had no way to act on.

```
┌─────────────────────────┐
│ ✓ Name          A → Z   │   active row states its RESOLVED direction
│   Color                 │
│   Price                 │
├─────────────────────────┤
│ ⇅ Reverse  (Z → A)      │   named action; says what it will PRODUCE
└─────────────────────────┘
```

- **Not a second toolbar button.** The menu is already open at the moment you
  want to reverse, and a per-toolbar direction button spends width on all
  seven — the exact budget the ≤640px "View" collapse exists to protect.
- **Reverse re-picks the active field.** Every one of these surfaces already
  flips direction when handed the field it is on, so the action needs no new
  callback anywhere — and the old re-select-to-flip gesture keeps working. It
  was never wrong, only invisible; leave it in.
- **The footer joins the arrow-key cycle, not Tab.** Tab _closes_ this popover
  family (`useMenuKeyboard`), so anything focusable below the list would be
  pointer-only otherwise. That's what `SelectMenu`'s `footer` prop wires up.
  The prop is opt-in: `SelectMenu` is also the group-by, tag and rule-field
  picker, and none of those has an action that belongs to the whole menu.
- **A sortable table column header is already this control** and is exempt:
  click a header to sort, click again to reverse is universal, and the header
  is itself the visible affordance (`SharedListView`).

### Anchored panels

- Portal + placement + dismiss come from `useAnchoredPanel`; the funnel trigger
  with its count badge is `<FilterTrigger>`. Don't hand-roll the
  measure-and-clamp effect — five popovers each carried a copy and they drifted
  (the active-count string differed between pages).
- **Live-apply for what you're LOOKING at; explicit Save for what you're
  EDITING.** Sort, view toggles and quick filters apply immediately with no
  button. Binder and list rules keep a Save. No popover in the family
  auto-closes on a pick — Discover's radios used to, and it was the only one
  that vanished mid-edit.
- An `InfoTip` beside a checkbox goes **outside** the `<label>`. A button
  inside a label is part of the label: tapping the tip would toggle the box,
  and its text lands in the checkbox's accessible name.

## Index-page insight strips (UX-334)

**First ask whether it belongs on the index at all.** A suggestion that edits
one entity lives where that entity is being worked on, not on the page you pass
through to pick it. "Between your decks" (E90) proposes moving a card from one
deck into another. It spent four PRs as a Decks Index strip (inline list →
strip + sheet → batch dismiss → reshaped rows) and still read as clutter,
because on the index it interrupts choosing a deck to ask for a two-deck edit
nobody opened the page for. It now lives as the **Your decks** lane of the
receiving deck's Coach feed (a `decks`-lane `Change`, applied through the
editor's `executeReallocation` so one Undo restores both decks). A strip is
for a fact about the page's own list (the public deck page's
`OwnershipLensStrip`: how much of this list you already own), not an
invitation to go edit something else.

When it does belong there, an insight/advisor engine surfaced on an index page
(readiness, coverage, cross-entity facts) **collapses to a one-row summary
strip that opens a sheet on tap — it never displaces the page's primary
content.** The first ship of "Between your decks" rendered its full suggestion
list inline above the Decks Index grid, pushing every deck below the fold. The
rules that came out of it:

- **Strip**: one toolbar-row tall, full-width, a real `<button>` (not a card),
  `min-height: 44px` on coarse pointers. Contents: a leading icon, a label, a
  small count pill (`999px`, `--surface` bg — a non-actionable label per the
  Pills rule), and space permitting a one-line teaser of the top item that
  truncates with ellipsis — **hide the teaser entirely below 600px rather than
  wrapping it**. Trailing chevron signals "opens something."
- **The strip carries a batch escape hatch — a trailing `✕` that dismisses
  every currently-visible item at once.** Per-item dismissal alone means N taps
  through a sheet to clear a lane the user doesn't want today, which is what
  made the first "Between your decks" ship feel unshakeable (`#1404`). Rules:
  - It dismisses **exactly the ids currently shown, never the lane itself** —
    a genuinely new batch still surfaces later. An "off forever" switch quietly
    kills a feature the user can never find again.
  - **Undo toast, not a confirm dialog.** These dismissals are device-local and
    non-destructive (no deck/collection mutation), so a modal confirm is friction
    for nothing; `toast.show({ actionLabel: 'Undo', onAction })` restores the
    batch. Persist via a bulk write, not N single writes.
  - **The `✕` is a SIBLING of the open-button, never nested inside it.** A
    `<button>` inside a `<button>` is invalid HTML and some engines swallow the
    inner click. The chrome (border, hover, focus ring) therefore moves onto a
    wrapper `<div>` that reacts to `:hover` / `:focus-within` of either child,
    and each child keeps its own focus ring + 44px coarse target.
- **Every row in the sheet must be self-sufficient: the user can reconstruct
  the proposed action from that row alone.** The first "Between your decks"
  sheet rendered `Card → DestinationDeck` and never named the **donor**
  deck until a sentence at the bottom of the card — so the surface's core object
  (a two-sided trade) wasn't readable off the row. A suggestion row leads with
  its subject (art + name + a `Type · N MV` meta line), then states the full
  action explicitly — for a move/trade, both ends as color-dotted chips with an
  arrow between them, never just the destination.
- **The accept and dismiss actions are not visual peers.** The primary action
  is a `.btn.btn-primary`; the per-row dismissal is a **quiet text button**
  (`--text-muted`, no border). Two bordered buttons side by side read as a 50/50
  choice, which misrepresents an advisory suggestion.
- **Zero visible items → render nothing.** No empty state on the index itself
  (a "you're all caught up" message, if ever needed, lives inside the sheet,
  not as a permanent fixture on the page).
- **One strip at a time on a phone, and a strip carries no outer margin.** Two
  lanes both having something to say is normal, and stacked they cost 108px of
  a 780px screen before the page's first row — the same "displaces the primary
  content" failure this ruling exists for, reached by addition rather than by
  one tall strip. Strips therefore share one wrapper slot: the wrapper owns
  the gap between them, collapses via `:empty`, and hides `:nth-child(n + 2)` at ≤600px.
  Nothing is lost — a strip unmounts when dismissed or when it has nothing to
  say, so whatever is left becomes the first child and surfaces. Desktop shows
  them all. The strips themselves declare no `margin-top`/`-bottom`: the host
  supplies the gap, and a strip that owns one charges it twice
  (`spacing-ownership.test.ts` guards both roots).
- **Tap opens the existing `card-picker` sheet shell** ([§ Overlays](../STYLE_GUIDE.md#overlays)) with the
  full suggestion cards — same accept/dismiss/undo behavior, just re-housed.
  Dismissing the last item inside the sheet closes it and removes the strip.
- This is a re-housing pattern, not a new interaction: the sheet's contents
  should be near-identical to what an inline surface would have shown, just
  gated behind one tap instead of always-on real estate.

**Known instances (sweep-3).** `BuildTimeCoachStrip` / `WedgeHintStrip` (navigating
variant). `BetweenYourDecks` was the first and moved to the Coach feed (see the top of
this section). The Decks-index "Build another" readiness
spotlight was a third (migrated in #1748 after it rendered three full cards and pushed
the first deck card to y=934 on a 780px phone) and was later removed outright: it
scored only the eight most recently imported legends, so its "closest to done" picks
were effectively alphabetical, and the commander finder's "Most of the deck owned" sort
already answers the question properly at the moment it is asked. Any advisor surface renders as a
collapsed 44px row and reserves its height, so an async fetch never shifts the grid
when it resolves.

## Empty states (E182)

**`components/shared/EmptyState`** is the one primitive for the `.empty-state`
family below — a primary shape (`tagline`/`hint`/`actions`/`mark`/`status`) and
a `compact` shape (one quiet line for a nested or secondary empty, or an
in-panel placeholder). It renders the same `.empty-state`/`.empty-state-tagline`/
`.empty-state-hint`/`.empty-state-actions` markup this section describes, so no
new CSS family is introduced; `src/test/empty-state-primitive.test.ts` fails on
a hand-rolled `className="empty-state"` or `"empty-state-tagline"` anywhere
else. This does not cover `DeckDisplay.tsx`'s `.deck-empty-state` (the
insight-strip-styled reference fix just below, a deliberately different,
icon-led shape for a generated card list) or a one-off inline picker/search
placeholder (a dropdown's "No matches" row) — those stay their own thing.

A surface whose primary content is a **generated list** (deck card list,
collection grid, any grouped-rows view) can legitimately have zero rows —
a brand-new manual deck, a fresh collection, a filtered-to-nothing view. That
is a distinct case from the "zero visible items" case in the insight-strip
rule above: an insight strip is optional advisory content, so it renders
nothing and disappears; the **primary content region itself** rendering
nothing is a dead first impression (a fully interactive toolbar pointing at
blank space), because the surface's whole reason to exist is missing. The
deck editor shipped fifteen PRs against a populated deck without any of them
noticing a brand-new deck rendered nothing below its toolbar — this is the
reference fix (`.deck-empty-state` in `DeckDisplay.tsx` +
`deck-builder-card-list.css`):

- **Reuse the insight-strip visual language** (one row, `--surface-raised`,
  `border-radius: var(--radius-lg)`) for the empty-state block itself — don't
  invent a bespoke illustration/empty-graphic system for one screen. Icon +
  headline + one detail sentence + a single primary CTA button, laid out like
  `WedgeHintStrip`/`BuildTimeCoachStrip` but **not dismissible** (there's
  nothing to dismiss it _to_ — the list stays empty until the user acts).
- **The copy names the next action, not just the absence of content.**
  "This deck is empty" alone is a dead end; pair it with what to do next
  ("Search the card index below and add your first cards") and a CTA that
  performs that action directly (`onAddCards` opens the same add-cards sheet
  the toolbar's own Add-cards button opens — one entry point, not a second
  one).
- **Branch the copy when the _reason_ for emptiness differs, not just the
  count.** Only branch when the underlying cause is genuinely different;
  don't multiply copy variants for cosmetic reasons.
- **An empty state never gates on a prerequisite the user can supply later
  (E465, 2026-09-27).** This section used to branch a Commander-format deck
  with no commander to "This deck needs a commander first." with one
  "Choose a commander" button. That button opened a "Pick a commander first"
  interstitial whose button only switched back to the Deck view: a loop, and
  a gate on the one thing a "just start a deck" user wants to do. Now the
  deck is simply empty: "This deck is empty." / "Add cards, or choose a
  commander first." with **Add cards as the one primary** and **Choose a
  commander as a secondary `Button` beside it** (two doors to two real
  places is still one primary CTA). Search shows every color until a
  commander exists; the deck checks flag off-color cards once one does.
- **An unfilled required slot is an open slot in its own place, not a
  banner.** A commander deck with cards and no commander renders its
  Commander section where the commander will sit, holding one dashed row
  (`CommanderOpenSlot`: "No commander yet" / "Choose one when you're ready.
  Until then, every color shows." with a primary Choose button; phones take
  the shorter "Every color shows until you choose."). Dashed is the app's
  "not filled yet" idiom, the same as BinderStartChooser's Blank tile. It
  leads the list view's command zone and the grid/stacks tiles alike, so no
  view is without the way in. The copy says what's true now instead of
  warning: an unfinished deck isn't a broken one, and no "missing commander"
  deck check exists.
- **A tab whose whole reading depends on a missing prerequisite says so in
  place of its content.** Coach with no commander renders an `.empty-state`
  ("Choose a commander and Coach reads the deck against it." + the Choose a
  commander button), never its feed's success-shaped "looks tuned" line.
- **Every door to one choice opens one surface.** The open slot, the empty
  state's secondary button, the Coach empty state and the commander row's
  "Change commander" menu item all open the same `CommanderPickerSheet`
  (Pattern B sheet: the commander-eligible cards already in the deck, then
  `CommanderSearch`). A pick is one store write and one Undo; replacing a
  seated commander goes through the existing keep/remove confirm. A deck
  still named "Untitled deck" takes the commander's short name on a pick
  (`withCommander` in the decks store; a typed name is never touched, and a
  server pull never renames).
- **Compute the condition from the same derived state the list already
  renders from** (`visibleGroups.length === 0`), not a re-derived proxy
  (`cards.length === 0`) that can drift from what the grouping logic actually
  produces — a commander-only deck has 0 mainboard cards but 1 non-empty
  group (its Commander section), and the empty state must not fire there.

**Nested empties (sweep-3).** When a sub-section's own empty state (a Trending rail)
renders inside a page whose primary region is also empty, the sub-section falls back
to one muted line: the page-level empty state is the one full empty state per screen.
A rail on a guest-landing or marketing surface hides itself below its data threshold
(the `FreshDecksRail` rule) rather than rendering an empty state. A pending state inside
a large fixed-height sheet fills the remaining height with skeleton rows, never one line
of text.

**Secondary sections: nothing, or one quiet line.** On a page made of
several sections (Home), a section with nothing in it takes one of two shapes,
never a full empty card and never a 44px row holding a grid cell (the old Home
bento left holes beside tall neighbors that way):

- **It renders nothing** when it only reports (price movers, recently added,
  things waiting on you). "All caught up" is reassurance, not content.
- **It keeps one quiet line** when it is also a way somewhere (Discover's
  door to browse, Around the table's Plan a game night and Find friends): one
  line, dashed like an empty sleeve (`--border-strong`, `--radius-lg`), with
  its doors on the right, and not a card, since there is no content to frame.

Either way, the doors a removed empty state carried have to live somewhere
with content (a header ⋮, a neighboring section), or they are lost.

## Wedge-feature discovery hints

A feature that ships with real product value but no proactive signal is
invisible in practice — a user can plausibly never find it. Rather than an
onboarding tour, carousel, or nag, this codebase surfaces such a feature with
a **contextual, once-only, dismissible hint at the moment it becomes
relevant**, built from two pieces: `lib/home/wedge-hints.ts` (precondition +
device-local "never again" persistence, one pair of functions per hint — see
the module doc for why this is _not_ a registry) and `WedgeHintStrip.tsx`
(the shared one-row presentational shell). Reference instances: the
binder-location hint in `CardSearchPanel.tsx`'s Collection tab, the deck
re-sync hint in `DeckEditorPage.tsx`, and the playtest drag-to-play hint in
`PlaytestBoard.tsx` (E484) — shown once a kept hand is on the board (gated
out during the opening-hand/mulligan takeover), wording switches on
`(pointer: coarse)` for the touch/mouse gesture name, and it retires itself
the first time a card actually moves from hand to the battlefield, not only
on dismiss.

- **Precondition gates on the feature being genuinely usable RIGHT NOW, not
  merely "the user could set it up."** The binder hint doesn't fire because
  the user has _a_ binder — it fires because a Collection-tab row actually
  routed to one (`binderByCardName.size > 0`), i.e. the badge it's pointing at
  is really on screen. Firing on an empty-state precondition teaches a user
  that hints are worthless; a hint that can't point at anything real is worse
  than no hint.
- **Device-local, never synced, dismissed forever.** Same
  `localStorage`-flag-per-hint shape as `nav-migration-tip.ts` — no dirty
  flag, no per-account state, no framework. Each hint is its own pair of
  `shouldShowXHint`/`dismissXHint` functions; a third hint is a third pair,
  not a registration call into something generic. If you're reaching for a
  `HintProvider`/config array, stop — that's over-built for a handful of
  hints.
- **At most one visible at a time, enforced by placement, not a priority
  queue.** The two reference hints physically can't overlap — the binder hint
  only renders inside the add-cards sheet, the resync hint only on the base
  deck-editor page — except for the one real overlap vector (the resync strip
  would sit directly behind the add-cards sheet's scrim), which is closed by
  hiding it while `showAddPanel` is true. A third hint sharing a surface with
  an existing one needs the same explicit mutual exclusion; don't rely on
  hoping two preconditions never line up.
- **`WedgeHintStrip` ground rules** (mirrors the Build-time coach strip's box
  model, since both are one-row insight surfaces, but is NOT the same
  component — a coaching nudge and an onboarding hint are different concepts
  that happen to share a shape): `role="status"`/`aria-live="polite"`
  announces its appearance without moving focus (never `.focus()` a hint into
  view — it's informational, not a modal); `useEscapeKey` dismisses it,
  matching every other click-away surface in the deck editor (harmless if a
  parent sheet's own Escape handler also fires from the same keypress —
  dismissing both the hint and its host sheet on one Escape is a reasonable
  outcome, not a bug); the dismiss control is always present, the action
  button (if any) is optional — an informational hint whose target is already
  on screen (the binder badge) needs no CTA, only a hint that opens something
  elsewhere (resync) does; `min-height: 44px` on coarse pointers on both
  buttons; `prefers-reduced-motion` kills the slide-in.
- **Caller owns spacing.** The strip has no built-in margin — it's a flex
  child of whatever renders it, so the host either already has a `gap` (e.g.
  `.deck-editor-main`) or declares one scoped to its own container (e.g.
  `.card-search-tabpanel`) rather than the shared component hard-coding
  margin that would double up wherever gap already exists.
- **Empty-state teach is a separate, case-by-case call**, not part of this
  pattern — a blank deck's card area can justify its own inline teach when a
  feature's value is obvious right there (not built for E169/E173; evaluate
  per feature).

## Info tooltips

When a label needs a plain-language explainer for a concept not everyone knows
(jargon, a scoring formula), use the shared **`components/overlays/InfoTip.tsx`** — a
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
- **`title=` is never the sole path to non-trivial detail.** A `title` attribute
  doesn't fire on touch and is unreliable for screen readers, so any indicator or
  toggle whose meaning lives in more than a one-word `title` (a flagged-cards
  list, a scoring formula, a toggle whose label understates what it does) must
  use `InfoTip` instead — keep the count/summary in the trigger's `aria-label`
  and put the detail in the tooltip body.
- **Not for per-row reasoning.** `InfoTip` explains a _concept_ (a term, a
  formula). The multi-factor "why this card" behind a cut/swap suggestion is
  different content — use the `WhyBreakdown` disclosure (see Suggestion feeds →
  Why disclosure), not an `ⓘ` on every row.

**Sweep-3 rulings (2026-09-06).** An InfoTip body is ≤ 35 words as one paragraph and
leads with what the number or label means to the player; how it was computed comes
second, if at all. A legend that already lists per-item definitions needs no sentence
above it re-describing what a legend is for. A `title=` on a labeled control over 8
words is the signal that the detail belongs somewhere touch can reach (a visible
caption or an InfoTip) — the `AvailableToggle`, the flagged-cards badge, the
`ListEntriesView` badges and the offline-settings buttons all shipped their only
explanation in a hover title.

### Keywords in card rules text (2026-09-27)

A card's rules text links its keywords to what the rules say they do. Render
rules text through `components/card/RulesText.tsx` (`RulesTextLine` with
`useRulesText`, or `RulesTextParagraphs`), never by splitting `oracle_text`
yourself. That gives reminder text its printed-card italic and every keyword its
link, on every surface at once.

- **The word stays the word.** A keyword keeps the text's font, size and color.
  A dotted underline in `--text-muted` is the only mark. It turns solid accent on
  hover and while its popover is open. A keyword line ("Flying, trample, haste")
  has to read as a line of text, not a row of links.
- **Click, not hover.** Rules text is read with the pointer resting on it, and a
  bubble that opens under the cursor covers the next line. So this is **not** an
  `InfoTip`. It is an anchored dialog (`useAnchoredPanel`) with an action in it,
  and a tooltip cannot hold an action.
- **Once per card, never in reminder text.** The first mention of a keyword on a
  face links. Later ones and the reminder parenthetical stay plain, because the
  reminder is already the explanation. The card's own name is never a keyword
  ("Arrow Storm deals 4 damage").
- **Everyday verbs are not links.** Destroy, exile, sacrifice, create, counter and
  the rest of `NOT_LINKED` in `lib/cards/keyword-glossary.ts` would underline half of
  every card. Link the terms a player might not know.
- **The popover says what the rule says.** Its body is the rule's own sentence
  (`“Ward [cost]” means “…”`), derived at build time into
  `public/keyword-glossary.json`. It is never a paraphrase of ours. "Read the full
  rule" opens the Rules reference sheet over whatever is open, searched to that
  keyword with its subrules expanded. Closing the sheet hands focus back to the
  keyword.
- A popover inside the card preview must not wake the preview. It stops its
  touch and click events at a `role="presentation"` wrapper, and the preview
  answers keys only while it is the topmost overlay layer.

### Flavor text in card rules text (2026-09-28)

Flavor is set apart the way the printed card sets it apart, in `CardText`
(`components/card/CardDetails.tsx`), so the card preview and the playtest Card info
dialog get it together. Guarded by `styles/card-text-flavor.test.ts`.

- **Italic means flavor or reminder text, nothing else.** That's what it means
  on the card. The keyword line ("Flying, double strike, haste") is upright; its
  dotted underlines already mark it.
- **A faded hairline sits between the rules and the flavor**, the card frame's
  flavor bar: `--border-strong`, transparent at both ends. It is faded because a
  full solid hairline already means "the next face of this card starts here".
  It is keyed on `.card-text-oracle + .card-text-flavor`, so a vanilla card's
  flavor, with nothing above it, gets no line.
- **Flavor stays a size step below the rules at every width.** The inspector
  column's body-size bump (≥1024px) lifts the rules lines and leaves the flavor
  at `--text-sm`.
- **Keep Scryfall's line breaks** (`white-space: pre-line`). An attribution
  ("—Jhoira") and a verse's second line arrive after a `\n`, and collapsing them
  runs the attribution into the quote.

### Deck-row "why it's here" affordances (E120)

A generated deck can record a per-card pick reason (`buildReport.cardProvenance`,
S2 #1076). A mainboard/sideboard row surfaces it through **exactly one** of
three affordances, in this priority order, never more than one at a time:

1. **Synergy pill present** (`.deck-row-synergy`, a commander-ability match) —
   the reason folds into that pill's `title` as an extra "Why it's here" line.
2. **Inclusion chip present** (`.deck-row-inclusion`, an EDHREC play-rate % or
   "Off-meta") — same fold-in, on that chip's `title` instead.
3. **Neither applies** — a dedicated `InfoTip` trigger, class
   `.deck-row-provenance-trigger`, wrapped in `.deck-row-provenance` for
   trailing-chip spacing. This is the gap the Scryfall-driven alt-generator
   modes fall into (oracle-role, art-theme, historical, PDH) — they carry no
   EDHREC signal and no commander-ability match, so tiers 1–2 never fire, and
   without a third affordance a real recorded reason would be unreachable.

**Reuse `InfoTip`, not `WhyBreakdown`, for tier 3** — this is a deliberate,
narrow exception to the "not for per-row reasoning" rule two bullets up.
`WhyBreakdown` is for a multi-factor, tone-tagged, always-open breakdown (the
Coach tab's `whyFactors`); tier 3 is a single recorded string, exactly the
shape `InfoTip` already handles, and it gets the reveal model (hover/focus/tap,
portal, Esc/scroll dismiss) for free instead of re-implementing it. Two things
make it a first-class per-row control rather than a generic concept gloss:

- **Pass a subject-specific `ariaLabel`** ("Why {card name} is in this deck")
  instead of `InfoTip`'s default "What is {label}?" template — `InfoTip` takes
  an `ariaLabel?` override for exactly this case (falls back to the default
  when omitted, so every other call site is unaffected).
- **Give the trigger a real 44px touch target** via a `className` on `InfoTip`
  (also a new optional prop) that adds a `(pointer: coarse) { ::after }` ghost
  centered on the button, mirroring `.set-filter-chip-x` in `collection.css`.
  This one matters here specifically because the synergy/inclusion siblings it
  sits beside are inert `<span>`s with nothing to tap — tier 3 is the row's
  first genuinely interactive, keyboard-reachable "why" control, so unlike its
  neighbors it needs a real target size.

Zero visual noise on a standard EDHREC-generated deck: tier 3 only mounts when
`cardProvenance` has an entry for that name **and** tiers 1–2 both fail their
render conditions, so nothing changes for the common case tiers 1–2 already
cover.

### Selection mode & drag reorder (E172)

Two patterns, both established in code before this guide caught up — this
section is the write-back, not a new invention.

**Selection mode — explicit toggle, never long-press-to-select.** A row's
whole-row tap/Enter/Space already means "open the card preview" everywhere in
the app; a bulk-select affordance must not fight that. The answer is a
deliberate **mode** the user opts into via a toolbar "Select" pill
(`.toolbar-pill`, `aria-pressed` carries the on/off state — see
`CardListTable.tsx`'s `selectMode` and `DeckDisplay.tsx`'s mirror of it), not
a gesture layered on top of the existing tap:

- While the mode is off, rows behave exactly as before (tap → preview).
- Turning it on reroutes the row's existing `onClick`/`onKeyDown` handler to
  toggle selection instead — same handler slot, different target function.
  Nothing about the card-preview carousel or the row's own buttons (qty
  button, kebab menu — which already `stopPropagation()`) needs to change.
- The row is `role="button" aria-pressed={selected}` — **not**
  `role="checkbox"` — with a small visual check glyph (`.deck-row-select-check`)
  inside, not a native `<input type="checkbox">`. This follows the "Read-only
  validation indicators" ruling above one level further: a checkbox ARIA role
  promises native checkbox keyboard semantics (Space only, no Enter, arrow-key
  siblings in some ATs) that a plain toggle button doesn't need to promise.
- A bulk-action bar appears only while the mode is on, between the toolbar and
  the content — never a floating/sticky overlay that could obscure a row.
- **The check badge overlays a corner only where there is art beneath it.**
  `.bulk-check` is absolutely positioned, so it reserves no space in the row's
  flow — fine on a grid tile or a list row whose leading edge is commander art,
  but on a **compact** row (decks/binders/lists, no thumbnail) the same badge
  landed on top of the deck name and ate its first characters (`atraxa` read as
  `axa`). Compact rows therefore get a dedicated **lane**: the badge centers
  vertically and the card takes a `padding-left` that clears it. The padding
  goes on the card rather than its inner link so one shared rule serves all
  three index surfaces without a per-surface specificity fight — and select
  mode already routes clicks through the card, so the lane stays a live toggle
  target rather than dead space.

**Drag reorder — a dedicated handle, never the whole row.** A vertical touch
drag anywhere in a scrolling list must scroll by default; only a gesture that
starts on an unambiguous, small, dedicated control should ever hijack it. Two
non-negotiables that follow from that:

- The drag handle (`.deck-row-drag-handle`, a `GripVertical` icon button) is
  the **only** element with dnd-kit's `listeners`/`attributes` bound — never
  the row's own `<li>`. Touching anywhere else on the row keeps scrolling;
  touching the handle is the only way to arm a drag. `touch-action: none` on
  the handle stops the browser's native touch-scroll gesture from fighting the
  handle once it's grabbed — everywhere else on the row keeps the default
  `touch-action` (native scroll).
- **Reordering is a deliberate, visible sort mode** ("Custom order" in the
  Sort menu), not a side effect available under whatever sort is active. The
  drag handle only renders when that mode is selected — a drag while the
  header still claims "sorted by CMC" would be a lie, so the affordance simply
  doesn't exist until the user has explicitly switched to Custom.
- **`@dnd-kit/*` is the house tool for this shape of problem** — already a
  dependency, already used once (`SortValueOrderEditor.tsx`). `PointerSensor`
  with `activationConstraint: { distance: 6 }` + `KeyboardSensor` +
  `sortableKeyboardCoordinates` gives pointer, touch, and keyboard reordering
  (focus the handle, Space to pick up, arrow keys to move, Space to drop, Esc
  to cancel) for free, plus built-in edge auto-scroll and a screen-reader live
  region — don't hand-roll any of it. Pass a custom `accessibility.announcements`
  object (per-section, naming the card and its 1-based position) rather than
  relying on dnd-kit's generic default text.
- **Don't apply dnd-kit's live `transform`/`transition` style to the row
  itself** if the same list also animates via a FLIP hook (`use-list-flip.ts`,
  which already imperatively glides rows on add/remove/reorder) — two systems
  fighting over one element's inline `transform` is visible jank. Let the FLIP
  hook own final-position settling; give the actively-dragged row only a dim
  (`.is-dragging { opacity }`), and use dnd-kit's `<DragOverlay>` (a small
  floating name chip, portaled by dnd-kit itself) for the "following the
  pointer" visual instead.
- Both the checkbox and the drag handle use the ghost-hit-area `::after`
  technique from "44px touch targets" above — the visible glyph stays small
  (it sits in a dense row) and the tappable area expands via a centered
  pseudo-element, same as `.set-filter-chip-x`.

## Invalidating-status cue (canceled, expired, …)

When a status means "this no longer applies" (a canceled game night; a
future lapsed/expired subject), the cue must survive a passing glance, not
just a close read: **a filled tone-colored badge** — background + border +
text all from the same status token trio (`--err-bg`/`--err-border`/
`--err-text` for "canceled") — never just an outline chip, which reads at
the same weight as a neutral label, **plus a strike-through on the subject
text it invalidates** (the card/page title, and any "when" line whose time no
longer matters). **Don't dim the badge along with the rest of the card** — a
blanket `opacity` on the whole surface mutes the one element that most needs
to stay loud; mute the invalidated text directly (`--text-secondary`/
`--text-muted` + `text-decoration: line-through`) and leave the badge at full
strength instead. Reference: `.game-night-cancelled-pill` +
`.game-night-card.is-cancelled .game-night-card-title` (GameNights.css), and
the mirrored `.game-night-cancelled-badge` + `.shared-view-title.is-cancelled`
on the public `/gn/:token` view (GameNightView.css) — same vocabulary on both
the authed card and the public detail page.
