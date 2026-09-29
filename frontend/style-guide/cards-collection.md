# Style guide: Cards, collection & binders

Card rows and tables, the collection hub, binders, import review and card-level terminology. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, colour and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## Sticky chrome stacks (collection hub)

Stacked sticky bars (hub tabs → search row → controls row on `/collection`) pin
at offsets that must equal the exact rendered height of every bar above them.
Those heights are **layout contracts, not styling**:

- **Token-driven offsets, fixed heights.** `--hub-tabs-sticky-h` (2.9rem) and
  `--collection-search-sticky-h` (3.8rem; 3rem on phones) live in `tokens.css`;
  each bar sets `height:` to its token and the bar below pins at the sum. Never
  derive a pinned-under bar's height from padding + content — font metrics vary
  per platform, and a guessed offset opened a visible gap on Android. Anything
  added to a fixed-height bar must fit on one line (the SearchPill shrinks);
  wrapping controls belong in the auto-height controls row, whose own underside
  is tracked by live measurement (`chromeBottom` in `CardListTable`), never by
  CSS arithmetic.
- **1px seam overlap.** Each bar pins 1px above the bottom of the bar above it
  (`top: calc(… - 1px)`): DPR subpixel rounding otherwise opens a see-through
  seam between stacked sticky elements while scrolling.
- **Phones pin the minimum.** At `≤600px` width — or `≤480px` height, i.e.
  landscape phones — only the hub tabs + search row stay sticky; the
  sort/group/view controls row scrolls away with content (`position: static`).
  Mid-scroll the essential tool is search, and sort/group changes reposition
  the list anyway. Precedent: the binders/lists index ("only the search bar
  pins; the sort/view row scrolls away"). With the bottom tab bar, tabs, and
  search already pinned on a phone, do not add further sticky rows there.
- **Under the hub, pin below the tabs.** Any sticky row on a page that shows a
  hub tab strip must offset by it via an `.app-main:has(.collection-hub-tabs)`
  scoped rule pinning at `calc(var(--hub-tabs-sticky-h) - 1px)` (see
  `.collection-toolbar-row`, `.binders-index-search-row`). A bare `top: 0`
  slides **over** the tab strip when scrolled — same z tier, later in DOM. The
  old `.collection-hub-tabs ~ *` form relied on the strip coming BEFORE the
  page root; since T135 step 3 it sits inside the page under the header, so
  that form matches nothing (`styles/hub-tabs-placement.test.ts` bans it). A
  detail page has no strip, so its sticky rows keep their no-tabs default.
- **The seam rule binds measured offsets too.** A bar whose pin is computed in
  JS (the card table's header, pinned under the auto-height controls row)
  subtracts the same 1px, and re-measures whenever a bar above it changes
  height — not only when the scrollport does. The controls row grows and
  shrinks on its own (wrapping, select mode's bulk bar, the result count
  appearing once a filter narrows the set); observing only the scroll
  container left the header stamped at its mount-time offset, which parked it
  a dozen pixels low with rows scrolling through the gap.

## The card table — one row, one column vocabulary, four surfaces

Every list of cards in the app is the same component at three densities: grid
(`CardGridCell`), the thumbnail flow row and the compact row (`CardRow`), and —
from **768px** up — the **card table**: aligned columns under a labelled header.
Collection, a binder's list view, a list's compact view and the shared/friend
views all render it. A new card-listing surface joins them; it does not grow its
own table.

- **Columns are declared, never hardcoded.** `shared/CardTable.tsx` owns the
  `CardTableCol` vocabulary, each column's label, its width track
  (`--ct-w-<col>` in `collection.css`) and its **tier**. A surface picks a
  preset from that module and passes the same array to `CardTableFrame`,
  `CardTableHead` and `CardRow`, so the header, the cells and the grid template
  cannot disagree. `CardTable.test.tsx` holds them to it.
- **A column a surface can't fill doesn't get a header.** Binder trades its
  Binder column for the physical page number (a binder page never needs to name
  itself — see "Binder pages" below); a list drops Binder and Notes, which a
  printing reference doesn't carry, and adds the target price only where the
  editor exists; a shared view drops the owner's private annotations and the
  per-row menu, and drops Qty/Price/Total outright when the surface withholds
  them rather than heading three empty tracks.
- **A column earns its track by being used, on a surface you browse.** Cond,
  Lang and Notes are blank on a copy that carries nothing unusual. A binder or
  a list runs its preset through `visibleColumns(preset, copies)` and drops the
  ones no visible row fills, because a 1,000-card binder otherwise spends three
  tracks — one of them the second-widest in the table — printing "NM", "EN" and
  nothing. **Collection is the exception and keeps them:** it is the audit view,
  where those are columns you sort and scan by, and one that vanished whenever
  every copy happened to be near-mint would be worse than one that reads NM.
- **Size a column track for its HEADER, not its data.** The header is uppercase
  `--text-xs` with tracking and may carry a 14px sort arrow, so a track sized to
  its values clips its own label — `--ct-w-qty: 3ch` fit "999" and rendered
  "QTY" as "TY". Tracks are declared in `rem`, never `ch` (which measures the
  wrapper's font, not the header's). `card-table-header-fit.test.ts` recomputes
  every floor.
- **Sortable only where a click sorts.** A column renders as a button only when
  the surface maps it to a sort key. Collection and Lists do; a binder's order
  is rule-driven, so its headers are labels. A header you can click that does
  nothing is worse than one you can't.
- **Tiers, not per-surface media queries.** Each column declares tier 1/2/3;
  two `@container` rules on `.collection-table` zero the dropped column's track
  and hide its cells by `data-tier`. Name, Price and Total are tier 1 — what a
  row is and what it costs survive every width. Below 768px there is no table
  at all: the compact flow row stays and sort lives in the SortMenu.
- **One header per table, not per section.** In a grouped surface (a binder's
  White / Blue / Multicolor sections) the header sits above every section
  inside one `CardTableFrame`, so the columns line up across the whole binder
  instead of each block finding its own widths.
- **The table is one slab, and a group divider is a ROW of it.** `CardTableFrame`
  takes `framed`: the frame carries the border, the radius and the surface, and
  the header and every row list inside go flush. A section divider is the shared
  `SectionHeaderBar` rendered inline, never a bar floating above a separately
  bordered box — a binder that carried the page-grid's `.section-header-toggle`
  into the table read as three unconnected cards. Where the surface is not
  virtualized (a binder), pin the group row below the column header with real
  `position: sticky` at `--ct-head-h`; only a virtualized surface (Collection,
  whose rows are absolutely positioned) needs the measured floating overlay.
- **A group label carries the case it was given.** No `text-transform` on
  `.collection-list-section-label`, on any surface. `getSectionMeta` returns
  display-ready labels, and they are two different kinds of thing — category
  words the app wrote ("White", "Creature", "Mythic") and names that came from
  card data ("Bloomburrow", "Secret Lair Drop: Artist Series"). CSS can't tell
  them apart, so uppercasing decorated the first kind by mangling the second.
  (A `*-section-label` heading a block of FORM controls — the filter panels,
  the card editor — is a different class and stays uppercase: that text is
  always a category word the app wrote.)
- **The header pins below whatever is sticky above it.** A table nested under a
  hub's tab strip pins at `--hub-tabs-sticky-h`, not at the top of the
  scrollport — which is behind the tabs, where the header vanishes for the whole
  scroll. A surface with a deeper stack (Collection: tabs + search + controls)
  measures its own offset and passes `top` inline, which wins over the CSS.

## Collection search hands off to Add cards (T153 decision C, 2026-09-27)

Collection search is about **your collection**, never a second live search.
Once the collection search box reaches 2 characters — whether or not any
local rows match, since owning one printing is not a reason to hide a route
to another — the list's trailing position (a grid tile in grid view, a row
below the list/compact table) offers **one hand-off**, never a second inline
results panel: "Add “{query}” to your collection…" (curly quotes, the
picker-action `…`). Clicking it opens the Add cards sheet on the Search tab
with the query pre-filled; the sheet runs its own search. This replaced an
inline `<InlineCardSearch>` panel that duplicated the Add cards sheet's Search
tab on the same screen — `InlineCardSearch` itself stays the shared
results-and-add engine for the surfaces that still own their own input
(`/search`, `/tags`, a list's add panel, the import Fix row); only
`CardListTable`'s second-search duplicate was removed.

A local zero-match state never competes with the hand-off: the plain
"No matches" empty state is gated on the same "query too short" condition
that gates the hand-off, so once the hand-off can show, it is the only thing
in that space.

**Reachable four ways**, all landing on the same sheet: the hand-off above;
`/collection?add=search|list|scan|products` (`&q=` seeds the Search tab),
which `?add=list` already used pre-T153 and keeps working; the ⌘K commands
"Add cards", "Import a list" and "Scan cards" (the last gated on
`useCanScan()`, the same gate the sheet's own Scan tab uses); and the `A` key
on a collection page (guarded like every other single-letter shortcut here —
suppressed while typing, listed in the `?` overlay).

## Card-name chips

Card-name chips render the name on **one line with ellipsis truncation** and
never wrap. Put the truncating text node on the shared
`.card-name-chip-text` utility, and make sure any pill/chip flex item that must
shrink also has `max-width: 100%` and `min-width: 0` so the ellipsis can engage.

The full card name must remain reachable: expose it with `title` on the name
element for desktop hover, and keep any existing tap-to-preview/card carousel
affordance for touch. `title` is never the sole path to the full name.

## Printed names: sort and label by what the card says (2026-09-24)

About 660 printings carry a Scryfall `flavor_name`: the Final Fantasy "through
the ages" Light Up the Stage reads **A Promise Fulfilled**, plus Godzilla,
Secret Lair and the rest. The ruling:

- **Sort by the printed name.** `printedName(card)` from
  `@spellcontrol/binder-routing` (flavor name, else oracle name). The engine's
  Name sort, A–Z sections and the shared views read it. Deck rows do not: see
  the decklist amendment below.
- **Search matches either name.** `nameMatchesNormalized(card, q)`, never a
  bare `normalizeForSearch(card.name)` on a card that has a printing.
- **Label with `<CardName card={…} />`.** It leads with the printed name and
  keeps the oracle name alongside in `--text-secondary` at `--text-xs`, on the
  same line, so fixed-height rows keep their height. The oracle half gives way
  first: it ellipsizes, and below 4em it drops out entirely instead of leaving
  a sliver. `stacked` puts it on its own line, only in a header with room for
  it (the card preview). Every other card renders as its bare name.
- **Exports, deck checks and anything oracle-level keep the oracle name.**
  Other tools do not resolve flavor names, and a row grouped by oracle name
  (trades, friends' collections, EDHREC data) has no single printing to name.
- **Amendment, 2026-09-29: a decklist leads with the oracle name.** Deck rows
  and the printed decklist render `<CardName card={row} oracleFirst />` and
  sort by `row.name`. A deck is read by the name the rules use, and the stored
  printing is not always one the player chose: an import picked Marvel's
  "Widow-Making Infiltrator" for a plain `1 Dauthi Voidwalker` because it was
  the cheapest printing. Pass the `row`, never `row.card`: the row's set and
  collector number come from the owned copy when one is allocated, so the
  name agrees with the art beside it. A name-only lookup
  (`/api/cards/lookup`) skips renamed printings whenever a plain one exists.
  Collection, binder and search surfaces still lead with the printed name.

## Binder pages — a page labels itself; a header never repeats it

When binder page-filling (`packSections`) merges several groups onto shared
pages, the section stops being a thing the user can point at — its boundary is
wherever the fill happened to land on a page edge. Those binders render as **one
continuous run of pages with no section headers at all** (`PageRun` in
`BinderView`), each page carrying its own heading naming what is physically in
it. Never label the same content twice: a header listing every merged group,
above pages that each re-list their own, is the pattern this replaced.

- **The heading is one clamped block, not a chip list.** `.page-label` clamps to
  two lines and reserves that height **unconditionally**, so a page naming three
  drops and a page naming one still start their grids on the same baseline.
  Variable-height headings above a row of page grids read as broken layout —
  that ragged top edge is exactly how the chip version failed.
- **Full text stays reachable:** `title` on the heading, and the page number
  opens the flipbook, whose context line repeats the label untruncated.
- **Suppress a heading that says nothing.** When every page in the run would
  carry identical text (an ungrouped binder: "All cards"), render none.
- **A header that must exist names the first group and counts the rest.** List
  view and the shared binder view keep collapsible section blocks (their rows
  carry the page number, so the header is the only grouping chrome they have) —
  those take `sectionHeading(cardLabels, section.label)`, which renders
  "Artist Series Mark Poole +23 more" and leaves the full run on `title`. The
  count is of groups **still visible** after search/filters, so a header never
  advertises a drop with no rows under it. `+N more` is the app's standing
  overflow idiom (Home's `WaitingOnYou`, `DeckAnalysisPanel`) — don't invent
  another.
- **One card's context is never the section label.** Anything naming a single
  card's group — the preview carousel's context line — reads
  `section.cardLabels[i]`; only a header reads `label`.

## Color pip rows — AND/OR match-mode chip

Every WUBRG+C color pip row that filters _cards or decks by their own colors_
(collection dialog, lists, deck add-cards, shared views, decks index, friend
collection) carries `ColorMatchModeToggle`
(`components/shared/ColorMatchModeToggle.tsx`): a `chip-joiner`-styled AND/OR
pill plus a plain-language hint ("any selected color" / "only these
colors"). One combine-operator language app-wide — the pill is the same one
`ChipExpressionBuilder` renders between chips, so AND is always the
accent-filled variant and OR the muted one.

- **Placement:** dialog/popover sections put it right-aligned in the section
  label row (`*-section-label--split`). There is no longer an inline pip row
  anywhere: the friend hub used to append the toggle after a bare pip row,
  which spread the pips across a phone and squeezed the hint into a
  three-line sliver at the edge. It now mounts the same `CollectionFiltersDialog`
  the collection and the public share views use (`useSharedFilters` with the
  `card-facts` facet set), so every card-filtering surface shares one filter
  door, one pip row, and one AND/OR placement.
- **Binder / list rule rows** (`FilterGroupEditor`, the Color identity rule):
  the rule label is a fixed-width column, so the toggle follows the pips in
  the control column (`.rule-color-identity`) and wraps onto its own line on
  a phone rather than squeezing its hint. The rule runs the same
  `colorSelectionMatches`, so Save as binder carries a collection color filter
  over exactly. The older one-bucket-per-card rule shows as **Color group**
  only on rules saved with it; the picker never offers it.
- **The hint is mandatory.** Between two value chips the operator explains
  itself; standing alone it doesn't — never render the bare pill without the
  hint text.
- **Semantics:** OR = card shows any selected color (`colorSelectionMatches`
  in `lib/colors.ts`, the single predicate); AND = the card's colors are
  **exactly** the selection (Blue alone = mono-blue, R + W = Boros only, not
  Naya). AND is an exact match, not a superset one: a lone pip reading as
  "every card that happens to contain blue" is the bug that made the mode
  useless for picking a mono color. Card surfaces default to OR; the decks index defaults to
  AND (its pre-existing behavior). Filter chips echo the mode: "White, Red"
  (OR) vs "White + Red" (AND) via `colorChipLabel`.
- **Deliberate exceptions — no toggle:** combos ("fits inside these colors",
  subset), Discover decks (identity-subset, server-side), and the commander
  finder (`CommanderSearch`). Their color rows mean something else; don't
  "unify" them onto this chip. The finder asks a commander question, so its
  switch is **Exactly / Within** (a `SegmentedControl`, shown once a color is
  on): Exactly is the identity itself (Golgari = black-green only), Within is
  anything castable in those colors, colorless included. The hint beside it is
  mandatory here too and spells the selection out in words ("Black-green
  commanders only", "Anything you can play in black-green").

## Manual price-override badge (E204)

`PriceOverrideBadge` (`components/shared/PriceOverrideBadge.tsx`) marks a copy
whose `purchasePrice` came from the user, not Scryfall — a manual market-price
correction for a printing Scryfall prices wrong or not at all (altered,
signed, graded, misprint, an obscure foreign printing). Same shape family as
`ProxyBadge`/`FoilBadge`: a small square "M" glyph chip, `--info`-toned (a
deliberate correction reads differently from `ProxyBadge`'s warn-toned "this
is $0, not real"), never color-only (the letter carries the meaning).

- **Always visible, never hover-gated — this is the opposite case from tag
  chips' "system hints hide behind hover, user content doesn't."** An
  overridden price that looks identical to a live market number is a
  data-integrity trap, not a nice-to-have detail, so the chip renders at rest
  everywhere a price does.
- **Lives next to the price, not the name-badge cluster.** `ProxyBadge`/
  `FoilBadge` sit beside the card name because they're identity flags; a price
  override is a price annotation, so it sits beside the number it explains
  (`CardRow`'s `.collection-list-price`, `CardPreview`'s price line, the grid
  tile's top-right corner cluster alongside `ProxyBadge`, `CardSlot`'s hover
  tooltip).
- **Grid tiles fold it into the existing `ProxyBadge` top-right cluster and
  the tile's constructed `aria-label`** (`, manually priced`) rather than a
  new prop — `CardGridCell` already reads `card.proxy` directly for the same
  purpose, so `card.priceOverride` follows the identical path.
- **One chip, two states, not two components.** A currency-mismatched
  override (recorded in EUR, viewed in USD, or vice versa — this app has no
  FX conversion, see `applyPrices` in `lib/card-prices.ts`) dims the same chip
  to `.is-dormant` rather than hiding it: the override still exists, it's just
  not the number currently on screen, and the dimmed chip + its `title` say
  so. Losing the indicator entirely on a currency flip would look like the
  override silently vanished.

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
The popover itself must land **on its trigger**: it portals to `<body>` and
forwards every coordinate `computePopoverPlacement` returns (`right` for a
right-aligned trigger, `bottom` when flipped above), then re-measures its real
content height after the first paint so the side and height cap match the
context's actual sections. Reading only `left`/`top` out of the helper is what
once parked the binder Key at the far-left edge of a wide screen —
`Legend.test.tsx` guards both anchors.

## Import review surface (E130)

A multi-outcome operation (an import that can simultaneously succeed, route
cards, withhold rows for a few different reasons, and need a repair) gets
**one review card, not one banner per outcome.** The pre-E130 `UploadPanel`
stacked up to four separately-bordered banners (success, binder-routing,
fetch-errors, unresolved-names) after a single import — reference
implementation is `components/UploadPanel.tsx`'s `.import-review` container
and `UnresolvedNameRow`:

- **One container** (`.import-review`, `--radius-lg`, `--surface` bg) with a
  single header: a small-caps title that reads `Import needs a look` if
  anything is still actionable (fetch errors to retry, names to fix) or
  `Import summary` when everything resolved cleanly — `lib/import-review.ts`
  `importReviewHeadline()` is the pure decision. Only fetch-errors and
  unresolved-names escalate the headline; malformed/skipped/clamped rows are
  informational only (nothing left to do), so they don't.
- **Sections, not boxes.** Each bucket (routing rows, fetch errors, malformed
  rows, unresolved names) is a `.import-review-section` divided by a hairline
  top border, not its own bordered card — that's what actually kills the
  banner-stack, re-boxing each bucket individually would just rebuild it one
  level in.
- **One dismiss for the informational part only.** The header's × clears the
  success line + routing rows (purely narrative — "here's what just
  happened"). Fetch errors keep their own Retry with no dismiss, and
  unresolved names keep their own per-row repair — a summary dismiss must
  never be able to silently drop a bucket that still needs Retry or Fix
  (this is the E72 contract: fetchErrors is a retryable outage bucket, never
  something a UI affordance quietly loses).
- **Inline repair, not a new lookup.** An actionable per-item fix (the
  unresolved-name row's "Fix") reuses the app's existing search/autocomplete
  machinery (`InlineCardSearch`) rather than a bespoke picker — expand in
  place, prefill the query with the item's own text (doubling as the manual-
  search fallback if suggestions miss), collapse into a resolved state once
  the fix lands. Don't open a second overlay for a fix that fits inline.
- **A one-off add reuses the review card too, not a lone banner.**
  `ProductSearchPanel`'s "add to collection" (T153) stays on screen after the
  import and renders the same `.import-review` + `ImportRoutingSummary` shape
  as the list importer, with its own one-line success sentence in place of
  `importReviewHeadline()` (there is no fetch-error/unresolved-name bucket to
  escalate to `Import needs a look` in this flow, since those already have
  their own warning above the footer, from resolving the product itself).
  When the action also built a deck, the card adds an "Open deck" button
  instead of navigating away mid-summary, so "where did my cards go?" is
  answered before the sheet closes.
- **One hook owns every input that changes a binder's layout** (E457,
  2026-09-27): `lib/use-binder-layout-inputs.ts`'s `useBinderLayoutInputs()`
  is `pages/BinderPage.tsx`'s own materialize chain — cards decorated with
  oracle tags → Secret Lair drops → per-printing release dates, plus
  `allocatedCopyIds` and `setMap` — extracted so a caller outside BinderPage
  (the Add-list row prediction, the post-import routing summary in
  `AddCardsSheet`/`UploadPanel`/`ProductSearchPanel`) reads the SAME inputs
  rather than re-deriving its own subset. Three call sites each decorating a
  different (incomplete) slice is exactly how a tag-rule binder, or a page
  number, used to disagree with what BinderPage actually rendered. It answers
  for BinderPage's DEFAULT view — "group printings" off (a non-persisted
  toggle that starts off every session), no in-binder search — since that's
  the only state nameable from outside the page. `summarizeImportRouting`
  takes this hook's result directly (`summarizeImportRouting(importIds,
layout)`) instead of separate `cards`/`binders`/options arguments.
- **A routing row also names the page(s) the cards landed on**: `pages` on
  each `ImportRoutingEntry`, read off the same materialize pass (walking
  `section.pages[].slots`, which carries `pageNum`, never `section.cards`).
  `formatBinderPages` renders "p. 3" / "pp. 3, 7" / "pp. 3–5" (a contiguous
  run collapses to an en dash range, the same glyph every other range in the
  app uses — "A–Z", "1–5" — never a hyphen; the rest stay comma-separated) as
  a quieter, smaller trailing detail after the binder name
  (`.import-routing-pages`), never a second fact competing with it.
- **The Add list predicts each row's destination before commit**: a quiet
  line under a scan/search row (`.scan-row-binder` in `ScannerQueueSheet.tsx`)
  shows the binder pip + name `nextBinderMatch` would route that exact copy
  to (finish/condition/language included, since a binder rule can filter on
  finish), or "Matched no binder" — the same wording the post-import summary
  uses for its own unrouted row, so the two moments read as one vocabulary.
  Hidden entirely when the user has no binders. Filters are compiled once per
  render pass (`compileBinderCandidates` + `nextBinderMatchCompiled`), not
  once per row, since the list can hold a booster box.

**Import admin left the add flow (T153, 2026-09-26).** `UploadPanel` used to
mix adding cards with collection administration — an import-history aside
with per-import delete, a "Restore backup" file picker, and a "Clear all"
that wiped the whole collection. None of those are about the import in
progress, so they moved off the panel entirely:

- **Import history** is `components/ImportHistorySheet.tsx`, a card-picker
  sheet reachable from Collection's ⋮ menu ("Import history"), not the add
  flow. Its delete confirm states the truth about Undo — `deleteImports()`
  always follows with a toast offering one, so the old copy ("This can't be
  undone.") directly contradicted the toast a moment later. The confirm now
  reads "Other cards stay where they are. You can undo from the toast."
- **Restore from a backup file** lives in You › Backup & export
  (`/you/data`), not an import surface. Restoring a backup has no Undo
  (unlike history-delete and collection-clear, both of which do), so its
  confirm's "This can't be undone" stays accurate; its error copy no longer
  says "Couldn't restore that import" for an operation that isn't one.
- **Delete entire collection** (the former "Clear all") has two doors, one
  flow: the last, `danger` item in Collection's ⋮ (the collection is its own
  index, so this is the whole-library rule's "one home"; it hides with the
  other admin items on an empty collection) and You › Backup & export. Both
  render `components/DeleteCollectionDialog.tsx`: two steps, because a bulk
  wipe of thousands of rows is not the one-item delete that skips its
  confirm. The final step names the Undo toast instead of "This can't be
  undone", since `clearCards()` always offers one.
- **The mode dialog no longer blocks every import.** Importing adds to the
  collection straight away (identical in effect to the old replace-into-empty
  on a blank collection, since `importCards` treats an empty collection's
  merge and replace the same). The rarer choices — add as a new binder (with
  its name field) and replace the whole collection (still its own confirm +
  Undo) — live in a closed `Disclosure` labelled "Options" beside "Mark all
  as proxies", so a one-line paste is one click, not a dialog every time. The
  filename-based re-import warning (`findPriorImports`) still fires inline
  once a staged file's name matches prior history, pointing at Options rather
  than blocking; the content-based re-import gate (`findContentReimportMatch`)
  still hard-stops a probable duplicate regardless of the chosen mode.

## Card row information hierarchy

Collection/binder rows represent a **specific printing**, not just a card name —
the density tiers decide which fields drop, but never the printing identity.

**Printing-identity floor.** Any row that represents a specific printing carries
the **type glyph + accessible rarity chip + set code** at **every viewport
width**. This is the floor that keeps two printings of the same card name from
rendering pixel-identical (the pre-T36 compact-row bug: SET/#CN/foil all hidden
<768px). Only the wider #CN token and badge pills drop with density.

**Rarity is letter-first, not color-only.** Rarity rides as a small **C/U/R/M
letter chip** (`components/shared/RarityBadge`, gradient-tinted with the shared
`--rarity-*-from/to/border/text` palette). The **letter** is the signal so a
colorblind/low-vision user can read rarity (WCAG 1.4.1); the tint reinforces.
This **replaced** the old rarity-tinted keyrune set glyph on rows (`SetSymbol`),
which conveyed rarity by color alone and duplicated the set code's identity
role. `SetSymbol` lives on elsewhere (the Key, deck displays); the row identity
is now the legible 3-char **set code** text. Rarity shows in **list, compact and
grid** — consistently, not just where the row had room.

**Per-density field budgets.** Each density has a fixed budget — add a field by
trading one out, not by squeezing:

| Density            | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **List** (66px)    | thumb · name · foil · deck/binder badges · type glyph · rarity chip + set code + CN · mana · qty · value · condition + language chips (deviations only — detail-when-present, like the page chip)                                                                                                                                                                                                                                                                                                       |
| **Compact** (32px) | **<768px:** name · type glyph · rarity chip · set code · mana · qty · value. **≥768px it is the table** (below): qty · name (glyph + rarity chip + name + foil/proxy/deck badges) · set · # · condition · language · binder · notes · mana · price · total, under a sticky sortable header                                                                                                                                                                                                              |
| **Grid** (tile)    | art + qty badge + corner deck/binder badges + the **"Details" caption plate** under the card (price/sort-value line + rarity-tinted `SetSymbol` · set code · CN; per-line toggleable, default on). That set line carries the printing identity, so while it shows, the on-card **rarity chip** and duplicate-name **set-code chip** are suppressed; with it off both return — rarity top-right on every tile, the set chip bottom-left only when the same card name has >1 printing in the current rows |

**A row's name line: only the name truncates.** In list, compact and
the table, `.collection-list-name` is a flex row. The card name sits in its
own `.collection-list-name-text card-name-chip-text` span, the one item that
shrinks, floored at `min(6ch, 100%)` so it never falls to a couple of
letters. Every badge after it (foil, proxy, deck, cube, listed, binder) keeps
its size. It used to be one ellipsis box with the badges inline, so on a
phone a long name clipped every badge after it. Guard:
`styles/collection-list-name-badges.test.ts`.

**Where a card lives: three cube-and-deck badges, one chip.** `DeckBadge` is
the one "where is it" chip, in three kinds. A **deck** holds a copy: the deck's
color and the Layers glyph. A **physical cube** holds a copy: violet
`--cube-color` and the Boxes glyph. A cube **lists** the card but holds no copy
(a draft cube, a physical cube's pick it had no free copy for, or its
commanders): the same violet Boxes mark drawn **hollow and dashed**, the "no
physical home" mark the Uncategorized chip already uses. In a row that is a
dashed chip; on art it is the scrim with a dashed violet ring
(`data-identity="listed"`, STYLE_GUIDE § On-art scrims). A listing is not a
claim. It comes from `lib/cube-listings.ts`, by card name, and never enters the
allocation map, so a listed copy stays available to decks and binders. The
dashed badge reads "Listed in cube: <name>", links to the cube, and sits beside
any deck badge rather than replacing it. The card preview's context line
carries the same three as pills, and the Key has an entry for each. The binder
page grid (`CardSlot`) shows only real claims, since it answers "is this copy
in its pocket" and a listing never moves a copy.

**Table density (compact view, ≥768px) — the Moxfield-style collection table.**
Compact is not a fourth view mode: from tablet width up the same `compact`
setting renders `CardRow` in `table` mode — one grid cell per column on the
shared `--collection-table-cols` template (`styles/collection.css`), under a
sticky header of sort buttons (`CardListTable`, `.collection-table-head`) that
pins at the measured chrome bottom exactly like the section overlay, which in
turn pins below it. Rulings: (1) rows are independent grids (virtualized,
absolutely positioned), so every non-text track is a **fixed** width — that is
what keeps twelve columns aligned without subgrid; (2) column tiers drop by
**container** width, header and cells together via `data-col` (binder + mana
go first <1100px, then language + notes <900px), never by hiding a cell alone;
(3) **Price is the unit price and Total is price × qty** — only the table
earns the split, because the column label carries the meaning; for the same
reason **condition and language show for every copy there**, NM and English
included, while the flow rows keep their deviations-only rule; (4) the
printing-identity floor still holds — type glyph + rarity chip ride in the Name
cell, the set code has its own column; (5) header buttons wire into the
existing sort keys (`toggleSort`) and the SortMenu stays, as the accessible and
phone path — a header without a sort key is a label, not a dead button; (6)
below 768px the compact flow row is unchanged; a phone never sees the header.
**Notes** is a per-copy free-text field (`EnrichedCard.notes`, trimmed, absent
when blank, ≤500 chars, imported from a CSV "Notes"/"My Notes" column), edited
in `CardEditDialog` under Language with the same mixed-stack handling as cost
basis, shown only in the table's Notes column, and never projected onto a
public or friend share.

**One row, one tile — both are shared primitives.** A card row is
`components/shared/CardRow`; a grid tile is `components/shared/CardGridCell`.
Per-surface extras go in as slots (`menu`, `ownedBadge`, `targetPriceSlot`;
`cornerExtras`, `badges`, `ariaExtra`) — never as a private re-implementation.
The lists grid shipped its own tile once and silently missed the whole caption
plate, which is the same drift `CardRow` was extracted to end (#1413).
`CardGridCell.test.tsx` guards that every grid renders the shared tile. The
caption prefs are one device-wide setting shared by all grids, and the ≤640px
"View" popover that houses them is `shared/ViewPopoverPanel` ([§ Toolbars &](components.md#toolbars--action-rows-responsive)
action rows).

**Proxy chip — scoped to `proxy`, not its `altered`/`misprint` siblings.**
`shared/ProxyBadge` renders a small warn-toned "P" chip (letter-first, WCAG
1.4.1 — never color-only) in `CardRow`'s name line (next to `FoilBadge`) and
in `CardGridCell`'s top-right corner, sharing that spot with the rarity chip
via a `.collection-grid-topright` flex cluster rather than a private overlay
(the corner already exists for exactly this — see "one row, one tile" above).
It's baked into the two shared primitives directly, not a per-surface slot,
so every consumer gets it for free. `altered`/`misprint` have identical
plumbing (`CardEditDialog`'s flag chips, `CardPreview`'s inspector line) but
stay inspector-only: unlike proxy, they don't change a computed value — a
proxy is force-priced to $0 by `applyPrices` (`lib/card-prices.ts`), which is
what makes it worth surfacing at a glance everywhere a price total is read.
Revisit if a real ask for altered/misprint at-a-glance ever lands.

**Detail-when-present.** Per-copy chips (the binder page chip, condition,
language) render **only when that specific copy carries the value** — no
dash, no "Not set" placeholder; absence renders nothing, keeping rows quiet
by default and dense only where there's something to say. **Norms are
unmarked, deviations are chipped**: Near Mint and English never render a
chip (imports stamp `nm`/`en` on nearly every copy, so an always-on chip is
noise, not signal) — the row only speaks when a copy is LP/MP/HP/DMG or
non-English. The Key's Condition section says so in its title.

**Editable toggles show their state, always — even at the norm.** The rule
above governs _passive_ display chips that summarize existing data; it
doesn't apply to a control that's also the _only way to change_ the value.
The scanner's finish and condition editors (`CardScanner`'s last-scan panel,
`ScannerEditSheet` — E87) render at their default state too: finish always
shows "Non-foil" selected, condition always reads "NM" — a control that goes
invisible at the default has no way to discover the deviation it exists to
reach. They are form-kit pickers, never tap-to-cycle (§ Card scanner below).
In the scanned list, where the row is a summary and editing is a tap away,
the same two values are display tags, and only finish gets a color flourish
(rainbow foil, gold etched): finish IS a value signal. Condition stays
uncolored, matching `.card-list-condition`'s "quiet text, not a colored
badge" ruling above. The camera's last-scan panel gates finish behind
`finishes.length > 1` to stay one line; every other copy editor shows the
finish the printing lacks, disabled, with the reason under it (§ Copy details
below). Condition is never gated, since every physical card can be in any
condition.

### Card scanner (2026-09-25)

Redesigned against ManaBox, the scanner the owner actually uses, for two ways
of scanning: a few cards from the mail (check each one) and a whole booster
box (scan non-stop, fix the odd one).

- **The camera shows the whole 4:3 frame, full width** (`object-fit:
contain`), like a phone's camera app. Filling the screen cropped a third of
  the width off and read as zoomed in. Every control lives in the black bars
  above and below, so nothing covers the card.
- **The camera screen is pinned dark** (`data-theme="obsidian"` on
  `.scanner-root`) whatever the app theme, so form-kit controls on the
  last-scan panel read against the camera. **The sheets opened from it (the
  list, editing a card, settings) follow the app theme** like every other
  sheet: they're shared `<Modal>` sheets on `modal-backdrop--sheet
modal-backdrop--over-sheet`, and their menus portal to `<body>` anyway.
- **Anything opened from the scanner stacks above it.** The camera sits at
  `--z-overlay`, above the modal tier, so a sheet or confirm raised from it
  needs `--over-sheet` (`SCANNER_SHEET_BACKDROP`, or `useConfirm`'s
  `backdropClassName`). The old "Clear all" confirm opened on the plain
  modal tier and was hidden behind the camera.
- **Camera chrome is rect icon buttons** (T135), with torch, settings and the
  list grouped in one strip. The top bar always shows the card count; the
  value beside it is a setting.
- **No tap-to-cycle.** Finish and condition are the shared copy controls
  (§ Copy details): every option in view, HP one tap
  away instead of four blind ones.
- **Rare actions live in the list's ⋮**: select, sort, and "Clear the list"
  last and red behind a confirm. The footer carries only Keep scanning and
  the primary Add.
- **Repeat scans teach every time.** "Already added. Tap the screen to add
  another copy" shows whenever the matcher sees the card it just added, not
  once per session.

### Copy details: finish, condition, language (T153, 2026-09-26)

Every surface that makes or edits one physical copy picks its details with the
same controls, from `components/CopyControls` plus the kit:

- **Finish is `FinishControl`**: a `fill` `SegmentedControl` with each finish's
  price under its name. Non-foil and foil always show (etched only when the
  printing has it); a finish the printing was never made in stays, disabled,
  with "Not printed in foil." under it.
- **Condition is `ConditionControl`**: all five grades in view as the shorthand
  collectors use (`NM LP MP HP DMG`, in the data face), a `fill` track, the
  picked grade spelled out as the field hint so the codes have a path to their
  meaning. This replaced a pill `SelectMenu` that hid four of the five, the
  "select looks bad" report that opened the add-cards redesign. Five options
  is past the kit's segmented limit on purpose: they are tokens, not words,
  and fit one track at 320px.
- **Language stays a `SelectMenu`** in a `Field` (12 options). At add time
  English stands where "Not set" stood.
- **The unmarked defaults record nothing.** Near Mint and English at add time
  store no condition or language, the same meaning "Not set" had, so the card
  row's "norms are unmarked" rule above holds.
- **The Edit card dialog (`CardEditDialog`) reuses both controls.**
  `ConditionControl` takes a nullable `value` and an overridable `hint` for
  this one caller: an unset copy shows Near Mint selected (same "unmarked
  reads as NM" rule as above) but writes nothing unless the user actually
  picks a grade, and a grouped stack whose copies disagree shows no grade
  selected behind a "Mixed: …. Pick one to set them all." hint — picking one
  writes it across the group, matching a mixed field's placeholder-select
  convention below. Language keeps its own SelectMenu, now in a `Field` like
  the add picker's, with the same touched-tracking so an edit never rewrites
  a stored language the user didn't touch.
- **One finish vocabulary: Non-foil / Foil / Etched** (`FINISH_LABELS`), never
  "Normal", which reads as a frame or a layout beside those fields. The CSV
  export keeps "Normal" because that is what other tools import.
- **A search result tile carries nothing on its art** (E453, 2026-09-27). The
  printing, the "You own N" / "Added ×N" count and the "+" (a kit
  `IconButton`, 44px on touch) sit in a caption under the card, the way the
  collection grid captions price and set. A scrim "+" on the art covered the
  mana cost once it grew to its touch size.
- **A list row's "+" keeps its 44px target on touch but paints a 28px disc**
  (E459, 2026-09-27). Growing the solid accent circle to the whole target
  made it the heaviest thing in every row of /search, Add cards, list add and
  the deck add panel. `.inline-card-search-add` and the −/+ stepper keep the
  44px box (padding `--space-2`, `background-clip: content-box`), so the rows
  keep their height and the tap area is unchanged; the focus ring follows the
  painted disc. This is the in-box form of the ghost hit-area rule above: use
  it when the box can stay 44px, and the `::after` ghost when growing the box
  would stretch a dense row.
- **The deck editor's add panel (`CardSearchPanel`) renders the same list-row
  look** (E457, 2026-09-27), not a lookalike of its own: its three result tabs
  (Collection, Suggestions, Scryfall) render `CardSearchResults`' own
  `inline-card-search-item`/`-row`/`-add`/`-preview-trigger`/`-thumb`/`-name`/
  `-mana`/`-trailing`/`-meta` classes (`styles/binder-card-management.css`,
  loaded globally from `main.tsx`, so there is no chunk to move it into) via a
  local `SearchResultRow` shell, instead of forking a second copy of the same
  CSS in `deck-builder-card-search.css`. The engine stays its own — zones, fit
  signals, legality/off-color badges, in-deck counts, the binder-location
  badge, EDHREC/combo fit, "Fit & cut" — every deck-specific signal rides in
  the shared row's trailing `.inline-card-search-meta` slot, the same slot
  the collection-wide search fills with "You own N" / "Added ×N". No grid or
  compact view here: the panel has always been list-only (dense, badge-heavy
  rows don't fit a caption tile), so only the list row's look applies.
- Labels are sentence-case `Field` labels above the control, never uppercase
  side labels ([§ Config surfaces](components.md#config-surfaces-t139)). Two fields to a row once the container, not
  the viewport, is 30rem wide.
- **Sticky defaults are one settings sheet ("Add settings"), not per-surface
  state.** `ScannerSettingsSheet` (`lib/scanner-settings.ts`'s persisted store)
  holds `defaultFinish` / `defaultCondition` / `defaultLanguage`, opened from
  the scanner's gear and from a matching gear in the Add cards sheet header.
  A quick add ("+" with no picker) applies these three; an explicit picker add
  is used exactly as chosen and never re-defaulted. Set Foil + LP + Japanese
  once and both entry points, and every future quick add, start there — the
  whole point is that nothing asks "Not set" twice.

**Touch rule.** Hover-revealed information (titles/tooltips on glyphs, hover
peeks) is **enhancement-only** — on coarse pointers it doesn't exist, so nothing
may be _only_ reachable via hover. Every hover affordance needs a tap path;
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

### Dense pick-list thumb (guided brew — E128)

A **dense pick list** is a scrollable list of many rows (tens of cards) where
each row is otherwise text-only — the guided-brew "Deck so far" panel
(`BrewRunningDeck`) is the canonical example: a running list of accepted
picks next to the curve/color meters. These lists still want the tactile
"physical card" cue art gives (the thing meters-only panels lack), but at a
size that keeps many rows on screen at once — smaller than the shared
add-cards row thumb (`.inline-card-search-thumb`, 34px wide, same 488/680
aspect) and well below the 66px **List** density tile.

- **Size: 1.8rem × 2.5rem** (~29×40px), same card aspect ratio (0.72) as the
  add-cards thumb, just scaled down for row density.
- Resolved via `useCardThumb(name, 'small')` — the `'small'` Scryfall version,
  since the render size doesn't need `'normal'`'s resolution.
- **Decorative** (`aria-hidden`, `alt=""`) — the row's adjacent name text is
  the accessible label, same rule as `RowThumb`/`Thumb` elsewhere.
- **Loading/miss state:** a neutral `--surface-raised` box, no spinner/error
  icon — matches the established thumb placeholder pattern app-wide (the box
  never collapses to zero size, so nothing reflows when the image resolves).
- Row layout becomes a 3-column grid (`thumb · minmax(0,1fr) name/slot stack ·
remove`), not a flex line, since the thumb sets the row height and the
  name/slot pair now stacks vertically in the middle column.

### Default view posture is card-forward (E127)

Every surface with a persisted list/grid view toggle (collection, deck
mainboard) **defaults to grid/visual for a user who has never chosen** — list
and compact stay fully intact, one click away, and any explicit prior choice
(including a pre-E127 install that had never touched the toggle and so has no
stored key) still wins forever. The mechanism is exactly the existing
`localStorage` read used by `CardListTable`'s `readStoredCollectionView()` and
`DeckDisplay`'s `readStoredViewMode()`: only the **absence** of a stored key
falls through to the new default; any persisted value — set only by an
explicit toggle click, never by a mount-time effect — is honored unchanged.
Don't build a separate "has the user ever opened this view" flag; the
presence of the key already encodes that.

### View-mode toggle option order: richest → sparsest

The options inside a `ViewModeToggle` always run **most visual → most dense**:
grid (or its surface-native equivalent — binder `pages`, cube `gallery`) →
list → compact. Collection, search, product search, binder, and the shared
views all follow it; the list detail view drifted (`list/compact/grid`) and
was corrected to match. Order is independent of the _default_: a surface may
default to `list` (lists do) while still presenting grid first.

**Decision-context art reads as a card, not an icon.** A surface where the
user is choosing between several cards (not just scanning a list they already
own) resolves art at `useCardThumb`'s `'normal'` size, matching
`CardSearchPanel`'s add-cards row thumb — never `'small'`, which is reserved
for genuinely dense, already-decided lists (the guided-brew pick list, E128
above). `CommanderResultCard` (every commander finder list, and the editor's
"In this deck" legends) is the reference.

### Grid "Details" captions — fixed-height lines, per-line opt-out

A card grid may carry short fixed-height text lines under each tile — never a
freeform multi-line name/set/price block (that's what list view is for; names
are on the art, qty/rarity are already overlaid on the tile). Two lines exist,
each independently toggleable:

- **Price / sort value** — **echoes the active sort key's value** so any
  ordering is legible in grid view: dates for the date sorts, rank for the
  EDHREC sort, otherwise **price** (the one collector datum the art can't
  show) — unit price, USD-pinned like the list rows (`purchasePrice` is
  USD-sourced), unknown (zero) rendered as `—`.
- **Set & rarity** — the collector-app line (ManaBox/Moxfield convention):
  rarity-tinted keyrune glyph via the shared `SetSymbol` primitive + `CODE ·
collector number`.

The control is a **`Details` toolbar popover** (the `ToolbarPopover` +
`menuitemcheckbox` pattern shared with the deck toolbar's `Show` menu — now a
shared component, `components/shared/ToolbarPopover.tsx`), persisted per
device as JSON (`mtg-collection-grid-caption-prefs`, migrating the retired
boolean `mtg-collection-grid-caption`), all lines default **on**. Captions are
`aria-hidden` display text, not controls — their values fold into the tile
button's `aria-label` instead. Reference: `CardListTable` grid view
(`.collection-grid-cell` / `.collection-grid-captions` /
`.collection-grid-caption[--set]`); captions wrap **outside**
`.collection-grid-item` because that tile class is shared with the
Sets/binder-management grids, and the plate's net rendered height must stay
in lockstep with `GRID_CAPTION_H` × enabled lines + `GRID_CAPTION_PLATE_PAD`
(the grid virtualizer is measureElement-free).

**Captions attach visually, not by proximity alone.** The lines ride on a
`--surface` **footer plate** (`.collection-grid-captions`, bottom corners
`var(--radius)`) tucked up behind the card's bottom edge (negative
margin + `z-index: -1` inside the cell's stacking context), so card + captions
read as one tile and the row gap stays clearly empty — mirrors the E132
"tiles wear their meta" posture.

**A caption line suppresses the on-card overlays it duplicates.** With the
Set & rarity line on, the tile's `RarityBadge` and the duplicate-printings
set-code corner chip are not rendered (rarity lives in the glyph tint, set
code in the caption); they return when the line is toggled off. Overlays
nothing duplicates (qty, surplus, deck/binder badges) always stay. Don't show
the same datum twice on one tile.

### Index tiles wear cover art (E132)

An index of **containers** (decks, binders) gives every grid tile a cover: a
full-width art banner on top (`clamp(7rem, 22vw, 10rem)` tall, `object-fit:
cover; object-position: center top` so the focal subject survives the crop),
name/meta below. The two index grids share this geometry so they read as one
family — `.decks-index-card-art` and `.binders-index-card-art` are the
references. Rules:

- **Every grid tile gets a banner**, art or not — coverless tiles show a solid
  band of the container's identity color (a "plain binder cover"), same
  height, so rows stay uniform. List rows show a small thumb (or nothing when
  coverless — the colored left border still carries identity); compact rows
  never show art.
- **The cover is derived, user-overridable.** Decks use the commander's art;
  binders use the **most valuable card** (price, ties toward the lower EDHREC
  rank — `lib/binder-cover.ts`), overridable per card via "Set cover" /
  "Remove cover" in the card preview's icon bar inside that binder. The
  override is stored as a **Scryfall printing id** on the def (durable across
  the copyId regeneration every import causes) and silently falls back to
  automatic when the card leaves the binder.
- **Art always derives from the stored `imageNormal` via `scryfallArtCrop`**
  — never trust a persisted `art_crop` (the offline slim bundle fakes it, see
  #843) and never hit `api.scryfall.com?format=image`.
- Covers are **decorative**: `alt=""` + `aria-hidden`; the tile's name text is
  the accessible label.
- **A badge on the cover that names a count goes where the count is.** Home's
  "+N new cards" was a label the click fell through, so it opened the deck
  and the N cards were nowhere on screen. A badge like that is its own link,
  a sibling of the tile's link (a link can't nest inside one), pinned over
  the art the way the ⋮ is, with a hit area past the ~20px plate and its own
  accessible name ("Review 2 new cards for Krenko"). Its destination shows
  exactly the counted items, so the number on the badge and the number where
  it lands are the same one. `.home-deck-arrivals-link` is the reference.
- **The cover is the art crop, never the full card.** Discover showed the
  commander's full card, so its printed title bar sat at the top of the
  banner and the quick actions covered it. Every deck tile shows the same
  crop (`deckCoverArt`, or `scryfallArtCrop` on a printing's URL).
- **One hover for every tile, defined once** (`base-layout.css`, Index
  tiles). A tile that opens a deck or a binder, on any surface and in any
  view, answers the pointer the same way: its frame rings 1px in the tile's
  own colour (`--tile-color`: the deck's or binder's colour, else accent)
  and lifts to `--shadow-card-hover`, and in grid its cover art zooms to
  1.03, clipped by the tile's link at the art's corners. Keyboard focus on
  the tile's link gets the same answer. Reduced motion keeps the ring and
  the lift and drops the zoom and the transitions. A family adds only what
  is its own, such as Discover's quick actions fading in; it never restyles
  the frame or moves the cover. The hover used to be three behaviours, and
  the decks and binders one tinted a border that #2486 had removed, so for a
  day it did nothing. Guard: `styles/index-tile-hover.test.ts`.

### The meta line under a tile/row name is ONE flex row

`.decks-index-card-meta` (shared by the decks index, Discover tiles, and the
public profile) is the reference. Rulings:

- **Flex, never inline.** An inline meta line renders adjacent JSX elements
  with **no whitespace between them** — that's how the Globe visibility badge
  ended up welded to the commander name — and leaves spacing to ad-hoc
  per-child margins that drift apart. One `display: flex` + one `gap`
  (`0.15rem 0.45rem`) sets the whole row's rhythm; children carry no margins.
- **Only the long tail truncates.** Pips and badges are `flex-shrink: 0`-ish
  fixed content; the "Commander · N cards · Manual" tail
  (`.decks-index-card-detail`) is the single ellipsis target. Target it by
  **class, never `> span:last-child`** — that selector silently retargets the
  moment anything is appended to the row.
- **The deck value is pinned to the end of the tail (2026-09-25).** The
  index prints each deck's value (`lib/deck-value.ts`, the same number the
  deck hero shows and the Value sort orders by). It sits in
  `.decks-index-card-facts`, one flex item holding the detail and the value:
  the detail shrinks, the value never does, and a CSS `::before` supplies the
  `·` separator (a space either side) so it reads as the tail's last item. Never put it inside the detail
  text (a partner pair truncates it away) or as a loose sibling of the detail
  (on a phone it wraps onto a line that starts with `·`). It stays in Compact,
  where it is what a Value sort is read by, and it is omitted for a deck with
  nothing priced rather than printed as `$0`.
- **Badges on `--surface-raised` need a hairline.** The format badge's own
  `--surface-raised` fill vanishes against a raised card and it degrades into
  bare uppercase text; on card meta rows it takes
  `border: 0.5px solid var(--border)` + `background: var(--surface)`. An
  icon-only status badge (public/visibility) wears the **same pill shell** so
  it reads as a peer of the format badge instead of a glyph loose in prose.
- **The timestamp is metadata, not a third line.** "Edited 3d ago" rides the
  meta row — muted, `white-space: nowrap`. In List at ≥601px it takes
  `margin-left: auto` and parks at the trailing edge (the convention every
  deck manager uses); below that it flows inline, because a right-aligned
  scrap on a wrapped second line reads as a layout bug. A row is two lines:
  name, then meta.
- **A list row is as tall as its thumb.** Once the meta collapses to one line,
  the row's height is the art's — so the thumb is a landscape crop of the
  landscape source (`104×72`), not a square, and the ⋮ menu centers on the row
  (`top: 50%`) instead of pinning to a corner it no longer has.

---

## Card-stat terminology (mana value / mana cost / price)

Three distinct card numbers were historically shown under overlapping names
("CMC", "Avg CMC", "cost"). Users had to learn that "CMC" and "mana value" meant
the same thing, and "cost" ambiguously meant either the mana number or the dollar
price. Canonical vocabulary, use it everywhere **user-facing** (labels, aria,
chips, tooltips, analysis messages):

| Concept                       | Canonical term                                    | Never say                                       |
| ----------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| The converted-cost **number** | **Mana value** (`Avg mana value` for the average) | ~~CMC~~, ~~Avg CMC~~, ~~cost~~ (for the number) |
| The **`{2}{G}` pip symbols**  | **Mana cost**                                     | —                                               |
| The **dollar amount**         | **Price**                                         | ~~cost~~ (for dollars)                          |

- "Mana value" is MTG's official term since 2021; "CMC" is legacy and reads as
  jargon to newer players. Spell it out ("Mana value"), don't abbreviate to
  "MV" — an unfamiliar abbreviation trades one bit of jargon for another.
- **Reserve "cost" for mana _cost_ (the pips) only.** Don't use "cost" for the
  mana-value number (say "mana value") or for money (say "price"). This keeps
  "cost" and "price" from colliding on the same screen.
- **Code is exempt** — field names, sort keys (`key: 'cmc'`), CSS classes, and
  `cmcMin`/`averageCmc` stay as-is; the Scryfall field really is `cmc`. Only the
  strings a user reads change. Comments may keep "CMC" for brevity.

---

## Binder flipbook — one page per slide (2026-09-07 ruling)

The flipbook (`BinderPagePreview`) shows **one binder page per slide, centered,
at every width.** The desktop facing-pages spread mode (two pages + spine,
section index tabs on the gutters, `lib/binder-spreads.ts`, `binder-spread.css`,
UX-403 / #602 / #603) was **retired in #1777**: the user's ruling is that the
page itself is what gets centered, regardless of whether the binder is
double-sided. A spread centered the _pair_, so every page sat ~290px off center
and the first spread of a double-sided binder was a lone page that then jumped
to pairs — two different centering rules in one carousel. `doubleSided` still
lives on the binder definition (capacity math, sheet backs as discrete pages);
it no longer changes how the flipbook lays pages out.

Don't rebuild spreads or the edge tabs. Section context stays in the panel's
context line (`<label> · page N`), and the grid view's page headings carry the
labels untruncated.

## Checklist grids — owned vs missing (E131)

A "checklist" grid renders a fixed universe of printings (a set's card list)
where the user owns some and lacks the rest — first used by the Sets tab
(`pages/SetsPage.tsx`).

- **Reuse the `.collection-grid-item` tile family** (aspect ratio, radius,
  focus ring, `RarityBadge`, corner chips) — a checklist tile is still a
  printing tile and keeps the printing-identity floor (collector number in a
  `.collection-grid-set`-style corner chip).
- **Missing = ghost, not absent.** Unowned cards stay in place, desaturated
  and dimmed (`grayscale + opacity` on the image), with a scrim "Missing"
  chip. Hover (hover-gated) partially restores the art as an invitation.
  Never drop missing cards from the default view — the gaps ARE the feature.
- **Completion numbers never round up:** a partial set displays at most 99%
  (`completionPct` in `lib/set-completion.ts`); 100% is reserved for a truly
  complete set and is the only state that uses `--brand-seal-gold` (bar fill,
  check icon). Crossing to 100% while mounted fires the seal (standard
  once-per-subject rules in "Completion moments").
- **Ownership filter is the ImportCube pattern:** `Tabs variant="scrollable"`
  with All / Owned / Missing + counts; each filter's empty state says
  something real ("You own every card in <set>").
- Big checklists (Secret Lair ~2600 tiles) stay un-virtualized: tiles carry
  `content-visibility: auto` + `contain-intrinsic-size` instead of a JS
  windowing dependency.
