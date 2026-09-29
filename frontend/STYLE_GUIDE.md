# Frontend style guide

A **living** reference for SpellControl's frontend design language — the visual
and CSS conventions that aren't enforced by tooling. This is for both humans and
agents: when you make a styling ruling that should hold across the app, write it
down here so the next person (or session) doesn't re-litigate it.

> Scope note: this is the **design language** (shape, color, spacing, responsive
> rules) **and the copy voice**. Architecture, build, and test conventions live
> in the repo-root `CLAUDE.md`, not here.

CSS is **not** covered by typecheck/eslint/CI (only stylelint, narrowly), so most
of these rules are enforced by review and visual checks, not the gate. Treat them
as real constraints anyway.

---

## Primitives index

The app's shared vocabulary, in one place. **Check here before building a new
small thing** — most "I just need a little X" instincts already have an answer,
and the ruling that governs each one is buried somewhere in the ~90 sections
below and in the appendices. This table is the lookup; the cited section is the law.

Paths are relative to `frontend/src/`. Two directories, one letter apart, mean
different things: **`components/shared/` holds primitives**; `components/share/`
is the public share-link feature (`/s/:token`, `/d/:slug`) and is not a
primitives directory.

### Card surfaces

| Reach for                                                   | Instead of                    | Ruling                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `components/shared/CardGridCell`                            | a bespoke grid tile           | [§ Card row information hierarchy](style-guide/cards-collection.md#card-row-information-hierarchy) · § Index tiles wear cover art |
| `components/shared/CardRow`                                 | a bespoke list row            | [§ Card row information hierarchy](style-guide/cards-collection.md#card-row-information-hierarchy)                                |
| `components/CardThumb` + `lib/card-thumbs` (`useCardThumb`) | a raw Scryfall image URL      | [§ Card art peek](style-guide/overlays.md#card-art-peek--hover--touch-long-press-e129)                                            |
| `components/CardPreview`                                    | a second card-detail view     | [§ Card art peek](style-guide/overlays.md#card-art-peek--hover--touch-long-press-e129) — there is exactly one card view           |
| `components/shared/ManaSymbol` (`ColorPip`)                 | a bare `mana-font` class      | [§ Symbol key / Legend](style-guide/cards-collection.md#symbol-key--legend)                                                       |
| `components/ManaCost`                                       | mapping a mana string by hand | [§ Card-stat terminology](style-guide/cards-collection.md#card-stat-terminology-mana-value--mana-cost--price)                     |
| `components/shared/SetSymbol`                               | a bare `keyrune` class        | [§ Symbol key / Legend](style-guide/cards-collection.md#symbol-key--legend)                                                       |

### Controls & chrome

| Reach for                                                      | Instead of                                           | Ruling                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `components/PageHeader`                                        | a hand-built `.binder-hero`                          | § Layout system                                                                                                             |
| `components/shared/Button` (`Button`)                          | a raw `className="btn …"`                            | § Shape language — Buttons are a primitive                                                                                  |
| `components/shared/Button` (`IconButton`)                      | a `<button>` holding only a glyph                    | § Shape language — Buttons are a primitive                                                                                  |
| `lib/icon-scale` (`ICON_SCALE`)                                | a one-off `lucide-react` size/strokeWidth pair       | § Icon scale                                                                                                                |
| `components/shared/CopyButton` (`CopyButton`/`CopyIconButton`) | a hand-rolled `Copied` label swap or copy toast      | § Verbs (Copy)                                                                                                              |
| `components/shared/Chip`                                       | a raw `className="…-chip"` element                   | § Shape language — Chips are a primitive                                                                                    |
| `components/shared/Chip` (`tone`)                              | a raw `-badge`/`-pill`/`-tag` label, or `is-*` tones | § Shape language — Badges, counts and surfaces are primitives                                                               |
| `components/shared/ArtBadge`                                   | a raw badge class on card art                        | § Shape language — Badges, counts and surfaces are primitives                                                               |
| `components/shared/Count`                                      | a raw count-bubble class                             | § Shape language — Badges, counts and surfaces are primitives                                                               |
| `components/shared/Surface`                                    | a raw tile, section-card or popover class            | § Layout system — Surfaces: one frame                                                                                       |
| `components/shared/SwipeRow`                                   | a hand-built horizontal tile row                     | § Layout system — A row of tiles                                                                                            |
| `components/shared/SectionHeader`                              | a hand-built `-section-head` row                     | § Layout system — Section header                                                                                            |
| `components/SearchPill`                                        | a bare `<input type="search">`                       | [§ Toolbars & action rows](style-guide/components.md#toolbars--action-rows-responsive) · § Responsive (keep `min-width: 0`) |
| `components/SelectMenu`                                        | a restyled `<select>`                                | [§ Toolbars & action rows](style-guide/components.md#toolbars--action-rows-responsive)                                      |
| `components/OverflowMenu`                                      | a hand-rolled `⋮` popover                            | [§ Toolbars & action rows](style-guide/components.md#toolbars--action-rows-responsive)                                      |
| `components/shared/CtxMenuShell`                               | a hand-rolled right-click menu                       | § Verbs (menus)                                                                                                             |
| `lib/use-menu-keyboard`                                        | a bespoke `role="menu"` key handler                  | § Verbs (menus)                                                                                                             |
| `components/shared/InlineRename`                               | a bespoke input-swap rename flow                     | § Verbs (rename)                                                                                                            |
| `OverflowMenu` `contextHost` (+ `lib/context-menu`)            | an `onContextMenu` on an item                        | § Verbs (menus)                                                                                                             |
| `components/shared/ToolbarPopover`                             | a second portal-popover impl                         | [§ Toolbars & action rows](style-guide/components.md#toolbars--action-rows-responsive)                                      |
| `components/shared/ViewPopoverPanel`                           | letting a phone toolbar wrap rows                    | [§ Toolbars & action rows](style-guide/components.md#toolbars--action-rows-responsive)                                      |
| `components/Tabs`                                              | bespoke tab markup                                   | [§ Tabs / view switchers](style-guide/components.md#tabs--view-switchers)                                                   |
| `components/ViewModeToggle`                                    | a bespoke layout switcher                            | [§ View-mode toggle option order](style-guide/cards-collection.md#view-mode-toggle-option-order-richest--sparsest)          |
| `components/shared/FilterChipsRow`                             | a bespoke active-filter row                          | [§ Tag chips](style-guide/components.md#tag-chips-e171)                                                                     |
| `components/shared/form` (`SwitchRow`)                         | a checkbox for an on/off setting                     | [§ Config surfaces](style-guide/components.md#config-surfaces-t139)                                                         |
| `components/shared/form` (`SegmentedControl`)                  | a new segmented-pill CSS family                      | [§ Config surfaces](style-guide/components.md#config-surfaces-t139)                                                         |
| `components/shared/form` (`ChoiceList`)                        | a hint that rewrites per option                      | [§ Config surfaces](style-guide/components.md#config-surfaces-t139)                                                         |
| `components/shared/form` (`Disclosure`)                        | a hand-rolled collapsible group                      | [§ Config surfaces](style-guide/components.md#config-surfaces-t139)                                                         |
| `components/shared/form` (`Field`)                             | an uppercase `.field label`                          | [§ Config surfaces](style-guide/components.md#config-surfaces-t139)                                                         |

### Overlays

- **Sheet-presented dialogs (Pattern B).** A dialog you _pick from_ — the
  share audience, "send to a friend" — is a bottom sheet at ≤600px and a
  centred dialog above, the way the OS share sheet behaves. Opt in with
  `<Modal backdropClassName="modal-backdrop--sheet">`; the rule lives next to
  Pattern A in `modals-dialogs.css`. Confirmations stay centred at every
  width: an alert is read, a sheet is picked from. Every `<Modal>` portals to
  `<body>` — rendered in place it inherits a `container-type` ancestor as its
  containing block, which is how the share dialog once opened clipped inside
  the deck hero with a backdrop that dimmed only that card.

| Reach for                                         | Instead of                           | Ruling                                                                  |
| ------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `components/Modal`                                | a bespoke `position: fixed` layer    | § Overlays — hand-rolled `.modal-backdrop` dialogs are the anti-pattern |
| `lib/use-sheet-exit` + `lib/use-lock-body-scroll` | hand-rolled open/close + scroll lock | § Overlays                                                              |
| `lib/use-escape-key`                              | a bare `keydown` listener            | § Overlays                                                              |
| `components/ConfirmDialog` / `lib/use-confirm`    | `window.confirm`                     | § Overlays                                                              |

### Feedback, state & identity

| Reach for                                                   | Instead of                                            | Ruling                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `components/shared/MeterBar`                                | a hand-rolled bar track                               | [§ Bars & meters](style-guide/data-display.md#bars--meters) — **never hand-roll a track**                              |
| `components/InfoTip`                                        | inline hand-holding prose                             | [§ Info tooltips](style-guide/components.md#info-tooltips)                                                             |
| `components/shared/EmptyState`                              | hand-rolled `.empty-state`/`.empty-state-tagline` JSX | [§ Empty states](style-guide/components.md#empty-states-e182)                                                          |
| `components/share/SharedEmptyState`                         | a bare `<p>` in a share/friend view                   | [§ Empty states](style-guide/components.md#empty-states-e182)                                                          |
| `components/share/SharedShell` (`LoadingView`, `ErrorView`) | a bare `Loading…` / a dead-end error on a public page | § Verbs (loading, empty, error)                                                                                        |
| `components/shared/ThinDataNote`                            | inventing a sample-size caveat                        | [§ Deck-analysis band words](style-guide/decks.md#deck-analysis-band-words)                                            |
| `components/deck/VerdictBadge`                              | a bespoke pass/fail pill                              | [§ Verdict badges](style-guide/decks.md#verdict-badges) · § One scoring vocabulary                                     |
| `components/shared/SealBurst` / `SealMoment`                | confetti                                              | [§ Completion moments (the seal)](style-guide/app-shell.md#completion-moments-the-seal)                                |
| `components/UserAvatar`                                     | a bespoke initials circle                             | § Icon scale                                                                                                           |
| `playtest/components/OpponentRail`                          | a bespoke multiplayer sidebar                         | [§ Opponent rail — never hide a seat](style-guide/overlays.md#opponent-rail--never-hide-a-seat)                        |
| `playtest/components/OpponentQuadrant`                      | a bespoke opponent board panel                        | [§ Desktop table with opponents: 2x2, not a rail](style-guide/overlays.md#desktop-table-with-opponents-2x2-not-a-rail) |

**Adding a primitive?** Add its row here _and_ its ruling to the relevant section
below. A primitive nobody can find gets re-implemented — that is what this table
exists to prevent.

---

## Verbs: one behaviour per action (T157, 2026-09-27)

The sections below this one are mostly about one surface each. This one is
about the actions every surface shares. A user learns how delete, rename or
retry behaves once, on whatever screen they meet it first, and expects the
same thing everywhere after. When a surface needs one of these verbs, it
behaves as written here; a surface that needs something different makes the
case in this section, not in its own. The 2026-09-27 audit found delete
working four ways, rename five and loading four, each correct on its own
screen.

**Delete and remove**

- **One item you can undo: no confirm.** It happens on the tap, then a toast
  `Deleted <name>` (or `Removed <name>` for taking a thing out of a thing)
  offers **Undo**. Decks, binders, lists, cubes, list entries.
- **Bulk and delete-all keep a confirm**, even when undoable: the toast shows
  only a count, so the dialog is where the user sees what is going. Its body
  says `You can undo from the toast.`, never `This can't be undone.`
- **Only an action nothing can reverse** (a server-side delete, wiping an
  account, replacing a collection from a backup) confirms with
  `This can't be undone.` Every such clause is traced to the action its confirm
  reaches, and fails if that action shows Undo (`lib/undo-honesty.test.ts`).
- Undo restores the object whole, at its old position, through the same
  persist path as the forward action. A restore that only works on this
  device is not an undo.

**Feedback after an action**

- Success toast wording: `Deleted <name>` / `Deleted 3 binders` /
  `Removed <name>` / `Moved <name> to your collection`. Success tone, no
  trailing period, ≤12 words (§ Voice & copy budgets).
- An action the user just watched happen needs no toast (a toggle, a
  reorder by drag); an action whose result is off screen or reversible does.

**Loading, empty, error**

- **Content loads behind a skeleton** shaped like what is coming. A spinner is
  for an action in progress (a button that is saving), never a page. Public
  shared pages use `LoadingView` from `components/share/SharedShell`. A page's
  whole loading state is never bare `Loading…` text.
- **An error offers Retry.** The button says `Retry`, never `Try again`
  (`copy-guards.test.ts`). A public link's `ErrorView` requires `onRetry`, so a
  new caller without one fails typecheck. Retry sits beside a way out, not
  instead of it.
- Empty states follow [§ Empty states](style-guide/components.md#empty-states-e182).

**Menus**

- Every `role="menu"` opens and moves the same way from the keyboard: arrow
  keys, Home/End, Escape closes and returns focus. Build it on `OverflowMenu`,
  `SelectMenu`, `ToolbarPopover` or `CtxMenuShell`, which run on
  `useMenuKeyboard`; a hand-rolled menu fails `src/test` (menu keyboard guard).
  Back does NOT close a menu (deliberately, E481) — see § Overlays → "Back
  closes the topmost overlay first"; Escape is still how one closes.
- **Right-click opens the ⋮'s menu (T162, 2026-09-27).** On any item with a ⋮
  (a card, a deck, a binder, a rule), a right-click opens that same menu with
  the same items, at the pointer. It is never a second menu with its own
  items: a user learns an item's actions once. The Context Menu key and
  Shift+F10 on the focused item open it too, hung off the ⋮ the way a click
  on it would. Pass `contextHost=".your-item"` to the item's `OverflowMenu`;
  a hand-rolled `onContextMenu` fails
  `src/test/right-click-opens-the-kebab-menu.test.ts`. The deck view is the
  one surface with its own path, a single `CtxMenuShell` card menu that the
  row ⋮, the tile ⋮ and a right-click all build from `cardMenuCtx`.
- **The item a menu acts on is marked while the menu is open**, however the
  menu was opened: `data-menu-open`, drawn as the accent ring (on the card
  art, for a tile). A right-click menu sits at the pointer, not beside its
  item, so the ring is how the user knows which card "Remove" means. In the
  deck's stacks the marked card also stays fanned out: the menu's backdrop
  takes the hover away, and a card sliding back under its neighbours while its
  menu was up is the bug that started this ruling.
- **What keeps the browser's menu:** Shift + right-click (Firefox's own
  convention, made to hold in Chrome and Edge too), a field, selected text
  under the pointer, and a link that is not the item's own (a deck badge on a
  card). An item that is a page of its own (a deck tile) passes `itemHref`:
  its menu gains **Open in new tab** and **Copy link** above the destructive
  rows, so taking the right-click from its link loses nothing the browser
  offered. The rules live in `lib/context-menu.ts`.
- **Inside a selection, a right-click acts on the selection** (the playtest
  board's rule, app-wide). In select mode, a right-click on an item that is
  one of two or more selected opens the selection's actions, headed by the
  bulk bar's own count ("3 decks selected"). A right-click on an item outside
  the selection opens that item's own menu and leaves the selection alone.
  The selection menu's actions are the bulk bar's, from one list per surface
  (`BulkSelectBar actions`, the collection's `bulkActions`, the deck's
  `DeckBulkAction[]`), so the bar and the menu cannot offer different things.
  The ⋮ always opens the item's own menu.
- **A menu with nothing to do does not render.** No ⋮, and a right-click is
  the browser's. A read-only shared deck used to open a menu holding one
  disabled "Remove from deck".
- **A right-click never comes without a visible ⋮** ([§ Tag chips](style-guide/components.md#tag-chips-e171)), revealed on
  hover or focus under a fine pointer and always shown under a coarse one,
  where there is no right-click. A grid tile keeps it top-right, where the
  deck and collection grids both put it.
- **One card menu per place, whatever the view.** A binder's pockets carry
  the menu its list view gives each row (`CardRowMenu variant="pocket"`, fed
  through `CardPreviewContext.cardMenu`); the collection's grid tile carries
  its list row's. The page flipbook is a viewer and has none.
- **Surfaces without per-item actions keep the browser's menu.** Search
  results, shared and friend views and Discover tiles have no ⋮, so a
  right-click there is the browser's (on a link tile, that is Open in new
  tab). Giving one of them a menu is a feature decision, not part of this
  contract.

**Copy**

- **A Copy control that stays on screen confirms in place.** Its label swaps
  to `Copied` (plus a check icon, if the control has one) for one fixed
  duration, then reverts; the swap is announced to a screen reader through a
  visually-hidden `aria-live="polite"` node beside the control (the
  label/icon change alone is not reliably announced) — no `role="status"` on
  it, since a page can hold several Copy controls plus its own unrelated
  status regions, and that role would make every one of them match a bare
  `getByRole('status')` query. No toast — the control already shows the
  confirmation. Built: `CopyButton`/`CopyIconButton`
  (`components/shared/CopyButton.tsx`), or `useCopyFeedback`
  (`lib/use-copy-feedback.ts`) directly for a bespoke non-`Button` trigger
  (the join-code chip in `OnlineLobby`/`PlayPage`). One duration everywhere —
  1500ms.
- **A copy action whose trigger disappears on use** (a menu item that closes
  the menu, a context-menu row) **confirms with a toast**: `Copied <what>`
  (≤12 words, success tone, no trailing period).
- **A failed copy always toasts an error** (`Couldn't copy <what>.`), in both
  cases — a silent failure on a control that just showed "Copied" is worse
  than the toast. Every clipboard-text write goes through `copyToClipboard`
  (`lib/clipboard.ts`) or one of the two primitives above, which call it;
  `src/test/no-direct-clipboard-write.test.ts` fails a `.tsx` file that calls
  `navigator.clipboard.writeText` directly.

**Rename**

- **Renaming an existing thing happens in place: the name is the field.**
  Activating the resting name (click/tap, or Enter/Space — it's a real
  `<button>`) swaps it for an input pre-filled and selected. Enter or blur
  saves; Escape reverts and returns focus to the name; an empty or unchanged
  value reverts without saving. No toast on save — the user watched it
  happen. Built: `components/shared/InlineRename`. It renders only the
  interactive part, never a heading, so it composes as a page `<h1>`'s
  content (`PageHeader`'s `title`, `DeckHero`'s `title`) without breaking
  heading semantics, or inline anywhere else a name can be renamed (a deck
  tag row). Adopted: pod name (drops the separate Done button — Enter/blur
  already saves a plain rename), the deck tag manager (one button per tag,
  dropping the old ✓/✕ pair), and the list/cube detail page title. The deck
  name keeps its Done button: its editor is the name **and** the colour
  together, one surface, and blur can't close that — picking a colour
  swatch keeps focus put on purpose, so Done is the explicit exit.
- **Naming something that doesn't exist yet stays a dialog.** Creating a
  list or saving a cube (`NameInputDialog`) has nothing on screen to edit in
  place, so it keeps the themed `window.prompt` replacement. A rename menu
  item on an index row (a list, a cube) is a shortcut onto the thing's own
  detail page: it navigates there and opens the title straight into edit
  mode, never a modal. Guard: `src/test/name-input-dialog-create-only.test.ts`
  fails if a `NameInputDialog`'s `onSubmit` calls a `rename*` mutator.
- **A rule's name inside `BinderEditor` stays a live field, not
  `InlineRename`.** `FilterGroupEditor`'s name input writes straight into the
  editor's own uncommitted draft on every keystroke (the whole rule set only
  lands on the dialog's Save), so there is no separate committed value for
  blur to fall back to — it still gets Escape-reverts, restoring the name
  the field opened with.

**Still open (tracked on T157):** undo for server-side removals (trade
decline, game-night RSVP, pods, friends). Until it is settled here, match
the nearest surface that already does it and say which one in the PR.

---

## Layout system (T135) — one build of each pattern, every screen

**Why this section exists.** A 2026-09-24 sweep of every route at phone, tablet
and desktop found the same nine patterns on almost every screen, each built by
hand per page: the page header (its markup copied into 19 pages, tabs above the
title on some hubs, below on others, beside it on tablet), tabs in three
visual styles, ten toolbar implementations that wrap into orphan rows, chip
rows in two shapes, cards inside cards, tile grids with stranded last items,
two stat-strip styles, a camera button covering content on every route, and a
density swing (tablet inherits phone-size controls, desktop drops to ~13px
text). The CSS carried ~1,900 off-scale spacing values and 32 distinct
viewport widths. The fix is structural: each pattern is built once and every
screen composes it. The rulings below are the target; screens move onto them
one PR at a time, and `styles/layout-ratchet.test.ts` stops the debt growing
meanwhile.

- **Page header: title → meta → actions → tabs, in that order, on every hub and
  every tier.** One meta line under the title. At most two visible actions
  (primary + one secondary) plus a `⋮` for the rest. The tab bar sits directly
  under the header, never above the title and never beside it. With art, the
  header follows [§ Page hero art](style-guide/app-shell.md#page-hero-art--phones-get-the-art-not-a-downgrade). **Built:** `components/PageHeader` owns the
  action rule. A page passes its actions as a list (one `primary`, any
  secondaries, `menuOnly` for destructive ones) and never decides visibility
  itself: the primary is always shown, wider than a phone the first secondary
  sits beside it, and the `⋮` holds exactly what isn't on screen. Every hub
  and detail header uses it except the deck page, whose art header is
  `components/deck/DeckHero` (owner's editor and shared deck both): back
  link, title, one meta line, actions, in one block. Its actions follow the
  same rule by tier: a phone shows Add cards (the primary) and `⋮`, a tablet
  adds Playtest, a desktop adds undo/redo. Tokens, Pull list, Duplicate and
  Delete live in the `⋮` at every width. The meta line reads format · count
  · value · bracket · sharing; the commander is the art and the command
  zone's first row, so the meta line doesn't name it again, and sharing is
  its last segment ("Sharing: Public"), not a boxed chip under the title. **Hub tabs, built:** each hub index
  page renders its strip (`CollectionHubTabs`, `DecksHubTabs`,
  `SocialHubTabs`) directly after its `PageHeader`; the pair owns its spacing
  (8px header → tabs on every hub; hosts with a flex gap declare it as
  `--host-gap` so it cancels instead of stacking). Detail pages (a binder, a
  list, a set) render no hub strip: the back link goes up a level and the
  main nav names the hub. Guard: `styles/hub-tabs-placement.test.ts`.
- **Toolbar: search grows, the order after it is fixed, and it never wraps.**
  What doesn't fit the width folds into one control (a sort/view pill on
  phone, a `⋯` pill wider up) instead of breaking onto a second row. A
  primary (filled) button never sits in a toolbar; it belongs to the header.
  **Built for the deck list** (`DeckToolbar`): above a phone the row is
  search · sort · group · card size · layout · Select · `⋯`, and
  `DeckToolbar` measures the row, so where the whole row doesn't fit (under
  ~760px in list view, ~880px otherwise) Group by and card size fold into the
  `⋯` and Select becomes its "Select cards" action. The `⋯` opens on the list
  actions (Select cards, Test hand, Export) and then the row details and the
  symbol key; a panel taller than the space under the row scrolls, so the
  actions lead. Export lives only here: the header `⋮` doesn't repeat it.
- **Chip rows are one line.** Past the width they scroll horizontally with an
  edge fade; they never wrap into a second row with one chip left over.
  Explanatory text for a chip row goes in an `InfoTip`, not a sentence under it.
  The fade is `useOverflowEdges` (`lib/use-overflow-edges.ts`), which sets
  `data-overflow` to the edge(s) with more behind them. It is the one copy:
  `Tabs`, the admin users table and the deck's role chips use it, so never
  hand-roll another scroll listener for a fade.
- **Surfaces: one frame.** Tiles are sleeves (`--surface-raised` +
  `--shadow-card`, no outline). A list is hairline rows under a section header,
  never a bordered card holding bordered rows. Outlines belong to controls.
  **Built for the deck list:** a section is its header (a 1px
  `--border-strong` rule) over rows split by 0.5px `--border` hairlines, on the
  page itself at every width. The per-section cards on a wide screen and the
  single bordered panel below 1100px are gone (`styles/deck-tab-density.test.ts`).
  **Built as `Surface` (T166):** its `variant` paints the frame once
  (`styles/base-layout.css`): a `sleeve` is `--surface-raised` +
  `--shadow-card` with no outline, `framed` is `--surface` with one 0.5px
  `--border` and no shadow, a `popover` is `--surface` with a 0.5px
  `--border-strong` and `--shadow-tooltip`, all at `--radius-lg`. A family
  keeps its padding (it follows the content) but never the frame; a surface
  nested in another frame drops its own. Guard: `styles/surface-plate.test.ts`.
- **One fact, one place, on every screen.** A number or a list appears once
  per screen, in the place that owns it; everything else links to it. First
  settled for the deck view ([§ Deck view](style-guide/decks.md#deck-view--one-fact-one-place-2026-09-08) — one fact, one place), then found
  again on Home, where the collection value was printed twice word for word
  and Discover repeated the decks shown beside it. A per-item count belongs on
  its item (a deck's new-card count on that deck's tile), never summed into a
  page-level figure that counts the same thing more than once.
- **A row of tiles is a grid on desktop and a swipe row below it.** On a
  phone each tile is under three-quarters of the width (72%) and on a tablet
  30%, so the next tile always peeks in and the row reads as scrollable; a
  desktop grid squeezed down to a phone is never the answer. The row runs out
  to the screen edge past `--page-gutter` (negative margin, matching padding),
  snaps per tile,
  hides its scrollbar, and sets `overflow-y: hidden` (a strip with only
  `overflow-x: auto` becomes an accidental two-axis scroller; the
  `overlay-containment` strip guard enforces it). Tiles in the row are the
  surface's own tiles, never a second design of the same object.
  **Built** as `SwipeRow` (`components/shared/SwipeRow`, T135): the list
  element itself, carrying the tiles' own list classes, with `columns` across
  on desktop. Home's Your decks and Discover and the welcome page's fresh
  public decks use it.
- **Section header: title · meta · tools.** A section inside a page is a
  title, one short meta, and on the right its tools: the section's own search
  ([§ Toolbars](style-guide/components.md#toolbars--action-rows-responsive), search beside its list) and one door, which is `Button variant="link"` with a trailing chevron (T135: one link style app-wide, no bespoke door class). The meta hides on a
  phone before anything wraps. **Built** as `SectionHeader` (T166): Home's
  `.home-section-head` is the reference markup; a section with no meta or
  tools gets only its heading. A section's own `<header>` is `as="header"`,
  which is always the row, so a tool that comes and goes (Trades' Clear
  history) never changes it; `leading` holds what sits ahead of the title
  (the deck list's collapse chevron and type glyph), `titleAfter` what
  follows it that a heading can't hold (the category gauge), and tools with
  no `toolsClassName` sit in the row as its last items. Its `variant` is the heading's role, painted
  once in `styles/base-layout.css`: a `title` (serif, `--text-lg`, 700) or an
  `overline` (a small uppercase serif label above its rows, at
  `--tracking-overline`). A family keeps its spacing, never the type. New
  uppercase text takes `--tracking-overline`, never a raw em value;
  `styles/tracking-ratchet.test.ts` freezes the raw letter-spacing left in
  each file and only lets it fall. Guard: `styles/section-heading-plate.test.ts`.
- **The camera button lives on the collection pages, on phones, only**, with
  bottom padding on the content so the last row scrolls clear of it. Everywhere
  else, scanning is reached through Add cards. **Built** (`ScanFab`): it tucks
  away while the page scrolls down (that is when you are reading the prices it
  floats over) and comes back on the way up or near the top; a focused button
  never tucks; reduced motion fades instead of sliding. The padding is keyed on
  `.app-shell:has(.scan-fab-btn)`, because the button is a sibling of
  `.app-main`, not inside it (`styles/scan-fab-clearance.test.ts`).
- **Density tiers: phone ≤599 · tablet 600–1023 · desktop ≥1024.** Controls
  44 / 40 / 36px, rows 44 / 40 / 36px, body text 16 / 15 / 15px, page gutter
  16 / 24 / 32px, all driven by tier tokens rather than per-component media
  queries. Tablet is its own tier: it does not inherit phone-size controls. **Built** (T135): `tokens.css` sets `--control-h` and
  `--gutter` per tier, floors `--control-h` at 44px on a touch pointer (last,
  so rule order can never undercut it), and sets `--text-base` to 1rem on a
  phone. The shared controls (`.btn`, `.pill-btn`, `.toolbar-pill`, `.tab`,
  `.search-pill`), the page gutter and the desktop header read them. List
  and menu rows read `--row-h` the same way (`.switch-row`, the sets lists,
  game-night attendees, Home's table and Your cards rows, rules history, tags,
  menus). **Long card lists are the density exception** (user ruling,
  2026-09-28): the decklist and the collection table keep their 36px rows at
  every tier, because a full-width row has slack on the height axis and 15
  cards fit a phone screen where 10 would at 44 (#1466). Guard:
  `styles/density-tiers.test.ts`.
- **A query that closes a tier ends on 599px or 1023px**, never 600 or 1024:
  `max-width: 600px` and `min-width: 600px` both match at exactly 600px, so
  that width ran phone and tablet rules together
  (`styles/tier-edge-queries.test.ts`, stylesheets and matchMedia strings).
- **Shape follows role** (§ Shape language — corners): actions are rects,
  and so are actionable filter/toggle chips (they act, same tier as a
  button); sort, search and toolbar pickers stay pills, and so do
  non-actionable label chips; circles are only the camera button and
  avatars. An icon-only action such as `⋮` is a rect the height of its row.

---

## Voice & copy

SpellControl talks to a Magic player who knows the game. Copy is **confident,
concrete, and MTG-literate** — it says what to do and what something means,
never what the app "is."

**The five rules:**

1. **Second person, imperative, concrete verb.** "Import your collection",
   "Pick a commander". Not "Collections can be imported" / "Deck building".
2. **Assume MTG literacy; don't over-explain.** Use commander, bracket,
   singleton, EDHREC, combo as a player would. Jargon a _casual_ player
   wouldn't know gets an InfoTip (see Info tooltips), not inline hand-holding.
3. **Be honest, including about limits.** "no account required", "No password
   reset — pick something you'll remember", "many casual decks genuinely have
   none". Never oversell; admitting a limit builds trust. Convey sophistication
   by being **specific about what the feature does**, never with adjectives
   ("powerful", "advanced", "AI-powered", "seamless") — a literate audience
   reads those as noise. **When a boolean gate (`canRsvp`, `canEdit`, …) can be
   false for more than one reason, surface the real reason or fall back to a
   reason-agnostic message — a wrong specific reason is worse than a vague
   one.** A public game-night page once told every non-repliable viewer "ask
   for an invite," even when the real reason was that the host had blocked
   them; the fix checks which condition actually applies and only names
   "invite-only" when that's true, otherwise says "You can't reply to this
   game night."
4. **Sentence case, no exclamation marks, no cutesy filler.** No "Oops!",
   "Awesome!", emoji, or marketing adjectives.
5. **Apostrophes are straight, quotes are curly.** Copy writes `'` (the
   codebase and this guide's examples do; a typographic `’` reads as a
   different glyph beside its neighbours), while quoted terms use `“ ”`
   ("try “sweeper”"). Card names and oracle text are data and keep whatever
   the source has — fixtures that test apostrophe normalisation stay `’`.
6. **Use contractions** — "Couldn't add {card}", not "Could not add". They match
   the human register everywhere user-facing (errors, confirms, hints).

7. **No em-dashes.** The em-dash is retired from UI copy (sweep-3, 2026-09-06). The
   "claim — justification" shape was the single strongest "a model wrote this"
   signal in the app (709 strings). Use a period and a second short sentence, a
   colon before a list or value, a comma for a genuine aside, or cut the second
   half (usually the right answer: it only restated or defended the first). The
   mid-dot `·` stays the separator for label/meta pairs ("Bracket 4 · Optimized").
   A lone trailing `—` is the unknown-value placeholder, not prose. Card names and
   oracle text are data and keep their source punctuation. Guarded by
   `src/copy-guards.test.ts`.
8. **No parenthetical asides.** No `(e.g. …)`, no jargon gloss `term (plain
meaning)`, no `(not X)`. A count qualifier `(4 of 10)` is fine. Placeholders
   show the example itself (`placeholder="Friday commander"`), never "e.g. …".
9. **Never narrate the app as the subject.** Not "SpellControl routes…", "the app
   bundles…", "we built…", "AI can judge…". State the result ("Cards file into the
   first matching binder") or address the player. The AI-written pill already
   discloses provenance; prose never repeats it.
10. **State a fact once.** No reassurance stacked on a correct fact ("this is
    expected, not a miss", "no matter what you pick", "nothing is left worse
    off"). A heading, subtitle and hint on one surface never say one thing three
    ways: keep the one that names the action. If a computed result looks
    surprising, give the surprising case its own visible branch.
11. **Action over mechanism.** A hint says what to do or what it means, never how
    the engine computed it ("rules read live card data…", "the substitute-ranking
    index couldn't be loaded", "Draw-per-turn model:"). If the mechanism is
    load-bearing it goes second, in its own sentence.
12. **No lists of three or more in running prose.** Two items joined by and/or is
    a sentence; three reads as a spec sheet. Cut to the one that matters or
    render a real list.
13. **Length budgets.** Toast ≤ 12 words. Empty-state hint: one sentence, ≤ 20
    words. Confirm body ≤ 2 sentences. InfoTip ≤ 35 words as one paragraph (past
    that: one lead sentence + a bullet list, the `DRIFT_TIP` shape). Dialog
    helper sentence ≤ 25 words. `title=` on a labeled control ≤ 8 words; longer
    detail moves to a visible caption or an `InfoTip` (touch can't hover). Filled
    with a real card name and count, a generated reason line still fits a phone
    row (~45 characters per line inside a 3-line clamp).
14. **Canonical strings.** The finality clause is exactly `This can't be undone.`
    The ellipsis is the single `…` glyph. No "please", no "simply", no "just" as
    filler, no exclamation marks. Banned adjectives: curated, tailored,
    intelligent, powerful, comprehensive, elevate, unlock, leverage, seamless,
    robust, effortless (the proper noun "Comprehensive Rules" is exempt). Plurals
    are computed (`copies`), never `copy(ies)`. Sentence case applies to assembled
    strings too (aria-labels and stepper labels built from templates capitalise
    the verb).
15. **No hedging in verdicts.** "may stall", "could use a small bump", "Consider
    adding…" become the fact and the move: "Curve is heavy. Expect slow turns." /
    "Add 2 lands."
16. **Sibling parity.** Two branches of one conditional string, two variants of
    one option, two adjacent confirm dialogs, the on/off toasts of one toggle:
    same tense, same sentence count, same punctuation. Read them side by side.
17. **A generated reason line states one claim and stops.** Build Report rows,
    coherence findings, gap notes and swap reasons: one clause for WHAT,
    optionally one short sentence for WHY, never a clause narrating HOW the
    engine decided. Several issues render as several short lines, never one
    semicolon-joined sentence. The E505 pass (2026-09-29) cut the same tails
    from hundreds of them:
    - **A defence of the claim.** "Kept 2 payoffs the deck can't feed yet.
      ~~Nothing stronger qualified.~~", "Already in your collection. ~~No
      purchase needed.~~", "Your deck is light on ramp. ~~This closes the
      gap.~~"
    - **The engine as narrator.** "on this build", "this time", "vs
      baseline", "picked on synergy, not just play-rate".
    - **A hedge where a verdict belongs** (rule 15). "may stall early"
      becomes "Expect some slow turns.", "Consider adding 3 lands" becomes
      "Add 3 lands."
    - **A locked action says what happened, then the fixed tail.** "You saw a
      new hand. That can't be taken back.", never the rules model behind it.
    - A `detail` string a caller wraps ("{card}: {detail}.") ends without a
      period, and a color in generated text is a word, never a raw letter.
18. **Shared facts are shared strings.** A fact stated on more than one surface
    (ownership status = "committed to another deck", the hand verdict
    `Keepable` / `Mulligan`, `Bracket N · Label` via `formatBracketLabel()`, the
    build-health words `Dialed in` / `Needs work`) is one constant, not
    independently authored prose per file. A fact with no better home goes
    in `lib/shared-copy.ts` (`PROXY_HINT`, `aiConsentBlurb()`).
19. **Plain words over precise ones.** Write what the player sees happen, not
    the property the engine guarantees. "Sections share a page when they fit
    whole. None is split." was accurate and unreadable ("None" reads as an
    option name). "Sections share pages, but one that won't fit starts a new
    page" says the same thing. For an option, the hint names the trade-off
    that picks it over its siblings ("Leaves room after each section for new
    cards"), not a restatement of its label.
20. **A hint earns its place.** No hint when the label and options already say
    it: a `Page breaks` select offering "Each set too" needs no "Each new set
    starts its own page" under it. No hint for a control that isn't shown
    ("Add a second sort to break pages deeper", "With two or more rules…"):
    when the condition is met the control appears, and until then the line is
    noise the player has to parse to learn it doesn't apply. The E505 sweep
    (2026-09-28) found the same few shapes on every surface:
    - **A subtitle that repeats its title.** A page, sheet or settings-section
      subtitle exists only when it adds a fact the title lacks ("Edit 4
      cards" needs no "Changes apply to every selected card").
    - **A `title=` that repeats the visible label.** Drop it. Keep one only
      when the label is cryptic on its own ("Fit & cut") or when it is an
      input's `pattern` validation message, which the browser shows on a bad
      entry.
    - **A reassurance tail.** "Everything else still works", "Nothing is sent
      until you ask", "Review the changes before you save": the next screen
      already shows it. Privacy and cost facts are not tails; they stay.
    - **A disabled control's reason** names what turns it on:
      `Needs “<option>”.`, not a sentence about the engine's state.

**Model-tells checklist** (run over any new copy before it ships):

- An em-dash anywhere? A `(…)` aside? Three items in a row?
- Is the app, a feature, "we", or "AI" the grammatical subject?
- Does it explain how the engine did it instead of what to do?
- Does it reassure or hedge ("may", "might", "consider", "this is expected")?
- Do the heading, subtitle and hint say the same thing twice?
- A marketing adjective, "please", "simply", an exclamation mark, `...`?
- Is there a sibling string (the other branch, the adjacent dialog) that should match?
- Filled with a real name and count, does it still fit a phone row?
- Would a `title=` survive on touch? If not, it's a caption or an InfoTip.
- Read cold by someone who's never opened this screen, does it make sense?
- Delete the hint: does the player lose anything?

**Primary empty states are two parts: tagline + hint.** A short tagline naming
the state ("No decks yet."), then ONE hint sentence giving the reason and the
action that changes it ("Build a deck from scratch…"). Never a bare line, never
an exclamation. Use the shared `.empty-state` + `.empty-state-tagline` +
`.empty-state-hint` markup (don't hand-roll a per-page empty class). This is for
**primary** (page/section-level) empties. A small **inline sub-panel
placeholder** (a sideboard slot list, a mini-chart's no-data line) may stay a
single concise line — the two-part pattern would read visually heavy there.

**A load failure is the `.discover-decks-error` strip, not an empty state.**
One row: the message in a `role="alert"` box plus a `.discover-decks-error-retry`
button when a reload exists. Discover, Saved decks, the Trending rail and both
combo surfaces share it; the rules live in the global `shared.css` slice so a
page that renders it before Discover has ever loaded is still styled. That
includes the Retry pill's 44px coarse-pointer floor: it once lived in
Discover's own sheet, and every other page shipped a 32px touch target
(`styles/error-strip-touch-floor.test.ts` keeps it in `shared.css`).

**Empty states carry no logo.** The breathing brand-mark aura above primary
empty states (E114) was retired with the mark itself
([§ Brand mark](style-guide/app-shell.md#brand-mark)). An empty state is its
tagline, its hint and its action; don't put an illustration or icon above it
to fill the space.

**A rail that sits above a page's own content renders nothing when it's
empty.** Discover's Trending rail is the example: the browse grid below is the
page, and a "Nothing trending yet" card above it only pushed the grid down. So
an empty rail returns `null` with no heading and no empty-state card, and its
loading skeleton reserves nothing when it was empty last time. The empty-state
rules above are for a page or section whose content IS that list.

**A social ranking counts people, never clicks.** A list the app curates by
popularity (Trending) reads rows that need a signed-in account per +1 (a like,
a save, a live copy, a distinct author), leaves the owner out, and shows nothing
until more than one person is behind it. Views are anonymous, so they are
counted once per viewer per day and may be shown or sorted on by the user, but
never feed a curated list.

**Content the app seeds lives on its own shelf and says so.** The precons are
published by one house account (`users.is_official`), never by invented
players. They get their own rail (`PreconsRail`) and their own view
(`/decks/discover?source=precons`), and stay out of the community grid, every
ranking, commander stats, user search and friend requests. On Discover the rail
sits under the community grid, because players' decks are that page's content.
A precon's byline names what it is ("Commander precon · Listed by SpellControl")
rather than crediting the house account as the deck's builder.

**A filtered-to-zero empty state's own "reset" button must not repeat a
nearby `SearchPill`'s built-in label.** `SearchPill` already renders its own
inline `×` labelled "Clear search" whenever its box has text — exactly the
condition under which a page-level zero-result empty state (`SharedEmptyState`
and any future one) also wants a way back to the full list. Label that second
affordance something distinct ("Reset search"), never a second "Clear search"
on the same page: two simultaneously-visible controls sharing one accessible
name is a real a11y/cohesion smell (caught by `SharedEmptyState.test.tsx`
failing on `getByRole('button', { name: 'Clear search' })` matching two
elements), not just a naming nit.

**Lift/co-play explanations (E71):** evidence phrasing is fixed vocabulary —
`Lifted by {A}, {B}` for cluster connectivity (up to 3 card names) and
`Pairs hard with {A}` for a single bomb pairing. Reuse these verbatim on any
surface explaining a lift-driven suggestion (Build Report hidden-synergy picks
and synergy fills, Coach fix-gaps rows); don't coin new synonyms ("synergizes
with", "co-played with"). Combine with other evidence using the mid-dot
separator: `Fits your deck's {tags} · Lifted by {A}, {B}`. Concrete card names
are the point — never replace them with a count or "AI" phrasing (rule 3).
The hidden-gems lane (E146) extends the same fixed vocabulary with
`Plays like {X}` for a card-similar functional twin of an in-deck card and
`Completes your {axis} engine` for scarce-side axis fit ({axis} is the synergy
axis's display label, e.g. "Tokens / go-wide"). Same rules: verbatim reuse,
mid-dot combining, no synonyms.

**Confirm dialogs:** the title is the question ("Delete \"{name}\"?"); the body
is a declarative consequence ending in a period ("This cannot be undone."). The
body never re-asks the question.

**Toasts:** a status fragment takes no period ("Added Sol Ring", "Undone: cut
Llanowar Elves"); a complete sentence takes one ("Prices refreshed.", "Link
copied to clipboard."). Pick fragment for action confirmations, sentence for
state announcements. A binary toggle's two toasts (on-state and off-state)
carry matching punctuation — review them side by side, not in isolation;
the cube physical toggle shipped one state with a period and its sibling
without.

**Physical-reconciliation actions (binder review queue, #1019):** when a row
asks the user to reconcile app state with the physical world, the button
grammar encodes who does the work. **Confirmations are past tense** — the user
reports a physical act already done: "Added it", "Moved it", "Moved all".
**Vetoes are imperative** — the user commands the app to change its state:
"Keep it here", "Don't add". Never "Got it"/"OK"/"Dismiss" for a confirmation —
those read as dismissing a notification, when the click actually asserts "the
cardboard is where you say it is." Repeated identical action buttons in a list
carry an aria-label qualified by the row's subject ("Moved it — Sol Ring") so
screen-reader users can tell them apart.

**One word for the queue: "to file" (E472).** The cards to put into or take
out of the real binder are "to file" on every surface: Home's Waiting on you
("cards to file"), the index chip ("3 to file") and the binder's banner ("To
file (since 2h ago): 3 in, 1 out"). The one-click check-off for the whole
binder is **All filed**, a past-tense confirmation like every other in the
queue, and the cleared line reads "All filed." Never "review", "reviewed" or
"Drift" in user copy; the code's `drift`/`review` names are internal.

**Manual mode and custom order are different things.** A **manual** binder
shows only the cards added to it by hand; its rules are kept but paused, and
the binder page says so ("Rules paused") with the way back (**Switch to
rules**, the editor's label, toasting with Undo). A **custom order** is only
the order cards sit in (Manage cards › Order, a SwitchRow). Never call the
order "manual".

**Binder route headers (review queue):** every review-queue group header is a
_move_, not a state — rendered as endpoints around a `lucide` `ArrowRight`
(`aria-label="to"`, the WelcomeDigest route precedent): `[•source] → here` for
incoming cards, `here → [•destination]` for outgoing. A binder endpoint is the
**binder-identity chip** — a 10px `border-radius: 50%` dot in the binder's
`def.color` plus its name (the same pattern as `.add-to-binder-swatch` in the
binder-picker sheets); Uncategorized is the same chip with a **hollow dashed
dot** (no home) in muted text. The viewed binder is always the quiet lowercase
word **"here"** — "Keep it here" already established that vocabulary on this
surface, and repeating the binder's own name in every group is noise. Never
phrase these headers as state ("now in X" was the pre-route form); the queue is
a physical work order and its headers name both ends of the move. Per-group bulk
buttons repeat across groups, so their aria-labels carry the route
("Added all — from Bulk", "Moved all — to High Value"); per-row confirm buttons
carry it too ("Moved it — Cut Down, to Bulk"), since the paired check-off (below)
makes the route part of what the button does, not just where it sits.

**One move, one confirmation:** a cross-binder move appears in both binders'
queues (outgoing in one, incoming in the other), but it is ONE physical act —
confirming it in either queue also stamps the other binder's review baseline, so
the matching row disappears there too. The cross-queue side effect is never
silent: the confirmation shows a success toast naming the other binder ("Moved
Cut Down to Bulk — checked off in both binders" / "Added Cut Down — checked off
in High Value too"). Moves to/from Uncategorized or out of the collection have
no counterpart queue: those acks stay single-sided and toast-free (the row
vanishing beside the click is feedback enough).

**Punctuation:** complete sentences end with a period; a trailing `…` means
either "in progress" (loading) **or** a **picker/selector action** — one that
lets you choose an item from a list ("Move to another deck…", "Pick another
card…", the "Save As…" convention); never decorative. It does **not** extend
to general CRUD dialog openers — "Plan a game night", "Edit night", "New
deck" open a form, not a picker, and stay bare. Em-dashes are retired from UI copy (rule 7).

**A hint names the control, never a place on the screen.** "Search the card
index below" was true when the deck editor had a card rail; the same surface is
now a sheet on a phone and a dialog on desktop, and "below" pointed at nothing.
Write "Open Add cards to search for cards and start your list" — the control's
own label survives every layout the surface will ever have.

**A first-time state doesn't reference a thing the user hasn't made.** The
import-mode dialog told a first import that cards "will be routed through your
binder rules" — with zero binders there are no rules. Branch the copy on the
precondition (`hasBinders`), the same way empty states branch on the reason
for emptiness ([§ Empty states](style-guide/components.md#empty-states-e182)).

**A field's meaning lives in a visible label, not a placeholder.** The
Google-link row shipped with an sr-only label and "Paste a share link" as its
only visible text — which said nothing about _which_ link, and truncated at
360px anyway. Placeholders are examples ("Paste the link"); the caption above
the field (`.import-link-label`, the `.import-deck-name-label` tier) says what
goes in it.

**Canonical terms (use exactly):** _collection_ (your cards), _binder_ (a
rule-defined group), _deck_, _power bracket_ (the 1–5 Commander tier — not
"bracket level"/"bracket target" in user-facing copy), _Coach_ (the
suggestion/tuning tab). The product's one-line promise leads with **collection**
("Plan your Magic: The Gathering collection") — binders, decks, and games all
live under it.

**One sanctioned exception — generation flavor.** `GenerationTakeover`'s loading
lines ("Knowledge is mana.", "The oracle reads between the lines…") are
deliberately atmospheric MTG flavor — the app's one cinematic moment. This is
the _only_ surface exempt from the functional-prose rules above. Don't extend
this register elsewhere, and don't flatten it here.

---

## Shape language — corners

**Rectangles act; pills label (plus the toolbar-control pill family).**

| Use                         | Radius                             | For                                                                                                                       |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Buttons — all of them**   | `var(--radius)` (6px) stamped rect | Every do-something button, hero CTAs included (`.pill-btn` is a historic name — T53 Phase 4 retired the 999px hero tier). |
| **Cards / panels / sheets** | `var(--radius-lg)` (10px)          | Container surfaces.                                                                                                       |
| **Pills (labels)**          | `999px`                            | **Non-actionable** chips, badges, counts, tags, color swatches/dots — things that _label_ state.                          |
| **Tape labels**             | `2px` (`.site-nav-count`)          | The Dymo-tape material label tier (T53): fixed dark tape + pale caps on **navigation chrome only** (nav/hub counts).      |

**Buttons are a primitive (E435, 2026-09-25).** Every action control renders
`Button` or `IconButton` from `components/shared/Button`, not a raw class. This
reverses the #1517 ruling that buttons stay CSS classes. The primitives
render the same classes, so moving a call site onto them changes no pixels.
They add what a class name can't enforce:

- the label always sits in its own element (`.btn-label`), and an icon slot
  (`icon`, `iconEnd`) is always `aria-hidden`, because the label or
  `IconButton`'s required `label` carries the name;
- a `<button>` defaults to `type="button"`, so one inside a form never submits
  it by accident (pass `type="submit"` for the one that should);
- `to` renders a router `<Link>` and `href` an `<a>`. A navigation is a link and
  an action is a button, never a `<div onClick>`; the types refuse `disabled` on
  a link. So a button whose `onClick` only calls `navigate()` is a link in
  disguise: it can't open in a new tab, shows no address and announces as a
  button. Give it `to` (router `state` and `replace` pass straight through);
  the control-primitives guard counts the disguised ones. The one exception
  is a navigation that must be disabled while something runs.

Two props choose the class. **`variant` is intent** (the fill-vs-outline tiers
below): `secondary` (default), `primary`, `danger`, `link`. **`placement` is
where the button lives**, which is what really separates the three families:
they differ in hover, weight and whether they shrink, not only in
size.

| `placement`        | Class                                  | Lives in                               | Differs by                                                                  |
| ------------------ | -------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `inline` (default) | `.btn` (+ `-primary` / `-danger`)      | dialogs, panels, inline actions        | grey hover, may shrink                                                      |
| `row`              | `.pill-btn` (+ `-primary` / `-danger`) | page heroes, action rows, the bulk bar | accent-tinted hover and focus, `flex-shrink: 0`, weight 500                 |
| `toolbar`          | `.toolbar-pill` (+ `-danger`)          | toolbar control rows                   | the 999px toolbar-control pill (below); its `danger` is neutral until hover |

`variant="link"` is `.btn-link` and exists only at `inline`. Any link-styled
text action — an inline "Retry", a "Show all"/"Show fewer" toggle, an
underlined mid-sentence link — takes `variant="link"` rather than a one-off
class re-implementing the same background/underline/coarse-floor rules (T152
W8j retired nine of those: `.card-rulings-retry`, `.link-button`, and their
kin). Because a link button sits inside text, its 44px touch floor is a
centred `::after` ghost, never a `min-height` that would push the sentence or
table row apart on a phone (`styles/inline-control-touch-floor.test.ts`).
A plain navigation that is part of a sentence's words ("Shown on your public
profile", "Browse by tag when…") stays a router `<Link>` with `.text-link`:
the button's side padding opens a gap on either side of the words, and
`.text-link` carries only the same ghost (2026-09-28).
Combinations no stylesheet defines (`row` + `link`, `toolbar` + `primary`)
don't compile.
`.btn-sm`, `.btn-secondary` and `.btn-quiet` were never defined anywhere, so
there is no `size` prop; a site that carried one painted as plain `.btn`.

**The icon gap is one value.** `--icon-gap` (tokens.css, `0.4rem`) sits
between a button's icon and its label in all three families, set by `.btn`,
`.pill-btn` and `.toolbar-pill` themselves. A surface never sets its own:
before T152 W8e, 26 did (from `0.2rem` to `--space-2`), and a dozen `.btn`
icons that no surface covered touched their label.
`styles/icon-gap-ownership.test.ts` fails on a rule that lands on a family
class and sets `gap`. When a row of labelled buttons stops fitting a narrow
phone, it wraps (the public deck's Playtest and Copy do at 360px); it doesn't
squeeze its icon gap to fit.

`IconButton` takes a `label` (the accessible name, and the hover tooltip unless
`title` overrides it or `title={false}` turns it off). With no `variant` or
`placement` it adds no shared class and the surface's own `className` carries
the look: most icon-only buttons are one-off close, step and menu controls. A button whose only child is card art (a deck-row or trade thumbnail that opens the preview) is not an icon button: it stays a bespoke `<button>`, and the guard lists it as a permanent entry with that reason. A drag handle is an icon button like any other: `IconButton` forwards dnd-kit's `attributes` and `listeners` untouched, and one whose name is a long keyboard instruction sets `title={false}` so the hover tooltip stays short.

**`variant="quiet"` (T152 W8m) is the shared look for a one-off icon-only
action** — close, back, dismiss — replacing every surface's own ad hoc rect or
circle CSS. It renders `.icon-btn`: a `var(--radius)` rect (never a circle —
circles are retired outside the camera button and avatars), 2rem square,
transparent until hover, with the usual focus ring and a 44px floor on
coarse pointers. It takes no `placement`: `<IconButton variant="quiet" label="Close" icon={<X />} />`. A bespoke icon-only control that isn't a close/back/dismiss
action (a stepper, a menu trigger with its own shape, board chrome) keeps its
own `className` instead.

A surface modifier goes in `className`, appended after the variant's classes,
exactly as `btn btn-primary shared-copy-btn` was. **Intent is the `variant`,
never a class.** A modifier that restates it (`upload-action-danger`,
`bulk-bar-danger`) fights the variant's own rules, and whichever is more
specific wins state by state: the import dialogs' Delete and Replace buttons
were primary at rest and turned red under the pointer. The control-primitives
guard fails on an intent class on `Button` or `IconButton`, with no allowlist. A genuinely bespoke control
(playtest board chrome, the life-counter HUD, chart and radar controls,
card-art overlays) keeps its own `<button>`; there is deliberately no `bare`
variant to launder one through. `SelectMenu`, `ToolbarPopover` and `Legend`
render their own `.toolbar-pill` trigger and stay that way. When a call site
restyles one of those triggers (`triggerClassName` on `OverflowMenu` or
`ToolbarPopover`), it takes the class from `buttonClass({ variant, placement })`,
the same vocabulary `Button` uses, rather than spelling out `btn …`. A label that hides on phones (`.toolbar-label-compact`) takes that class through `labelClassName`, which lands on `.btn-label` itself: a span nested inside it would leave an empty flex item holding the icon gap.

**Badges, counts and surfaces are primitives (T166, 2026-09-28).** The
second round of the library, run the way T152 ran: each primitive renders
the family's existing class, so moving a call site onto it changes no pixel,
and the convergence PRs then give each shape one look.

- A label pill, badge or tag is a label `Chip`, and wears **one pill**
  (`styles/search-controls.css`, "Label pills"): the [§ Verdict badges](style-guide/decks.md#verdict-badges)
  reference, a 0.5px hairline on `--surface`, `text-xs` at 600, sentence
  case (uppercase belongs to `--font-label` tape, never a chip). Its status
  is `tone` (`success | info | warn | err | accent | neutral`), an outline
  in the status colour painted by the pill, never a family `[data-tone]`
  rule. An invalidating status (a cancelled night, a player who left, a card
  the format bans) is the one filled case ([§ Invalidating-status cue](style-guide/components.md#invalidating-status-cue-cancelled-expired-)). A
  family keeps its own layout (margins, flex), never the pill. Coloured-text
  labels (rules reference, set card, availability) are not pills; a chip on
  card art takes the scrim tones (§ On-art scrims). Guard:
  `styles/label-pill-plate.test.ts`.
- Anything on card art is `ArtBadge`, pinned by `corner`
  (`top-start | top-end | bottom-start | bottom-end`). An icon-only one takes
  `label`, its accessible name. It is always the scrim plate
  (§ On-art scrims), never accent. The one fill is an identity mark (a
  deck, cube or binder), which takes its owner's colour.
- A count bubble is `Count`, `placement` `inline` or `corner`. It renders
  nothing at zero and is `aria-hidden`: the control it sits in says the
  number in words. A plain text count ("12 cards") is not a bubble and stays
  text a screen reader reads. Every bubble is one look (`styles/tabs.css`, "Count
  bubbles"): 1.125rem, `--font-label` 700 with tabular figures; a quiet tally
  is a hairline on `--surface`, an attention count (active filters, an unread
  door, the scan stack) is `tone="accent"` and fills; `corner` pins at one
  offset. Never a literal colour. Guard: `styles/count-bubble-plate.test.ts`.
- A tile, section card or anchored panel is `Surface` with its
  `variant` (`sleeve | framed | popover`, § Layout system). A tile that is
  itself a link or button keeps its own element.

Guard: `src/test/display-primitives-usage.test.ts`. The migration is done
(T166 W1-W5); what stays raw is a list of permanent entries, each with its
ruling: playtest and live-table chrome, the glyph components that are
themselves primitives (Foil, Proxy, PriceOverride, Rarity), counts that show
0 on purpose, role marks (coloured text, not a pill), the deck and binder
domain badges that render on rows and on art, and the `<header>` rows with a
collapse toggle ahead of the title. A new match is fixed with the primitive,
never by adding an entry.

**Chips are a primitive (E435, 2026-09-26).** A chip renders `Chip` from
`components/shared/Chip`. Chips have no shared look across roles — a label
chip's family, an action chip's family — except the actionable filter/toggle
role (below), so moving most chips onto `Chip` changes no pixels. The role
picks the element, one way each:

- no handler: a label chip, a `<span>` (`as="li"` inside a list);
- `pressed` + `onClick`: a filter toggle, `<button aria-pressed>`;
- `onClick` alone: an action chip, a `<button>`;
- `onRemove`: a removable chip, a label plus a sibling × `IconButton` named by
  `removeLabel` (never a control nested in the label).

The label sits in its own element (`.chip-label`, with `labelClassName` and
`labelTitle` for a family's own label class and the full name of one that
truncates). A count badge or state mark that is its own flex item goes in
`trailing`, and a leading glyph, dot or set icon in `icon` (rendered
`aria-hidden`); nesting either inside the label would pull it out of the flex
row. Some classes named `-chip` are not chips in this sense and stay as they
are: board chrome, a rule-builder token with its own toggle and remove
controls, a list item wrapping its own button, a drag-reorder item, a router
link. The guard lists each as a permanent entry with its reason. A `<label>`
wrapping a hidden checkbox or radio is a choice control, not a chip
([§ Tabs / view switchers](style-guide/components.md#tabs--view-switchers), the exclusive-value picker).

Guard: `src/test/control-primitives-usage.test.ts` counts raw control classes,
glyph-only `<button>`s and raw chip classes per file. The migration is done
(board T152), so its allowlist holds only PERMANENT exemptions, each with the
ruling that keeps it, and a test refuses any entry without one. A new file, or
a listed file that grows, fails: fix it with the primitive, never with an
entry.

**Actionable filter/toggle chips share one look (T152 W8k).** Every family in
this role — the deck/combo Format/Source/Result/Pieces chips, the Coach feed
lanes, the card-search availability toggles, the deck role bar, the theme
picker, the product-type facets, and the combos ownership filters — paints
through one `.filter-chip` class (`styles/search-controls.css`): a
`var(--radius)` rect, `--text-xs`, an accent-tint hover, an **accent fill**
(never a tint) on `[aria-pressed='true']`, and the 44px coarse-pointer floor.
Pressed state reads `aria-pressed` — never an `.is-active`/`.active` class —
so a family stopped painting that twin once its chip renders `Chip`. A
family's own class keeps only what's genuinely its own: an icon color, a
dashed sub-state, an italic "show more" action chip. `DiscoverFiltersPopover`'s
label+checkbox chips paint the same class on their `<span>` but key off
`:checked` instead, since they're a choice control, not a `Chip`.

**One frame per surface — never box a grid of self-framed tiles.** A
container whose children already carry border + raised fill (result-grid
tiles, playstyle chips, `CardGridCell`) gets no border or fill of its own;
the tiles _are_ the chrome. The commander picker's results panel shipped
framed around framed tiles and read as a box inside a box, worst with one
hit (a lone tile pressed flush into a tray with an empty framed column
beside it). The frame belongs only where the rows are borderless — the
partner picker's list keeps its tray (`.partner-panel`) for exactly that
reason. When you unbox a container, drop the inner padding it had for the
frame too, so its grid lines up with the sibling grids.

**A label chip that carries card art is a rect, not a pill.** The pill rule is
about _role_, and a chip holding a thumbnail is still a label — but a pill
cannot physically contain one. A pill's cap radius is half the chip's height,
so on a chip sized by a portrait card thumb (aspect 488/680) the cap's arc
passes ~8px in from the left edge while the art's square corner sits at the
padding, ~3px in: the corner renders _outside_ the border. `.trade-offer-chip`
shipped that way and read as a rendering bug. Use `var(--radius)`, which the
art's corner clears at any thumb size worth using, and which matches every
other thumb-bearing row in the app. Art itself stays rect regardless (see the
avatar exception below) — so does anything shaped around it.

**Tape labels are a scoped second label tier, not a pill replacement.** A
tape chip is still non-actionable (the pill rule's role logic is unchanged);
what's different is the material: fixed `#1e1c18`/`#f2ede0` tape colors on
every theme and ground (like `--art-scrim`, tape is tape), `--font-label`
caps, 2px corners. It's currently sanctioned **only** for the nav/hub count
chips riding the divider-tab navigation. Don't convert other label pills to
tape by default — extending tape to a new surface is a STYLE_GUIDE ruling,
not a drive-by. **On dark grounds the tape gets a pale keyline**
(`0 0 0 1px rgb(255 255 255 / 25%)`, scoped to `.site-header` and the active
tab's accent fill): the tape value nearly matches the leather, so without the
ring the chip silhouette sinks and only the digits float. The tape colors
never change — visibility comes from the edge, not from theming the tape.

**No labelled button is a pill — anywhere (T53 Phase 4).** The old hero-CTA
pill tier is retired: hero CTAs are stamped rects like every other button
(`.pill-btn`/`.pill-btn-primary` keep their historic class names — the
role-not-name ruling below covers them). The only pill-shaped _buttons_ left
are genuinely **circular icon-only** ones (equal width/height, no text — the
`⋮` overflow, the round `+`) and the toolbar-control family in the next
section. **T135 retires the circular icon-only button** (§ Layout system): a
`⋮` beside a rect "Add cards" read as two controls from different apps. As
screens migrate, an icon-only action becomes a rect the height of its row;
the only circles left are the camera button and avatars.

**Fill vs outline carries INTENT — the material pass maps onto it, never
changes it.** The two-tier semantic is unchanged and load-bearing: an
**accent-fill** rect is the primary/commit tier (per-card add with `Plus`,
bulk apply with `Check`, hero primary CTA, dialog confirm); an **outline**
rect (`--surface-raised` bg + border) is the secondary tier; danger mirrors
the same split (red fill = destructive confirm, red-tinted outline = danger
secondary like Sign out). T53 Phase 4 dresses each tier without moving any
button between tiers:

- Standing **fill** buttons wear the stamped pair
  `inset 0 1px 0 rgb(255 255 255 / 14%), 0 1px 0 rgb(0 0 0 / 12%)` — the
  active divider tab's top-face highlight, so buttons and tabs read as one
  pressed family (reference: `.btn-primary` in `tabs.css`).
- Standing **outline** buttons get a firm `1px --border-strong` edge (the
  0.5px hairline read flimsy on paper). No stamp — the stamp is the fill
  tier's signature.
- **Compact in-row action rects** (the `DeckCardRow` `.deck-card-row-act`
  anatomy family) stay flat by design — stamping dense list controls reads
  as noise. Their fill-vs-outline intent rules are unchanged.

When reskinning any surface: keep each button in its tier. Restyling a
secondary as a fill (or a primary as an outline) changes what the button
_means_, not how it looks — that's an intent inversion, not a facelift.

Anti-patterns this rule kills:

- The same action rendered as two shapes across breakpoints (e.g. a pill on
  mobile, a rect on desktop).
- Any labelled text button styled as a pill — it reads as a tag.
- A reskin that flattens the fill/outline hierarchy (every button filled, or
  every button outline) — the tiers are semantics, not decoration.

**The one labelled-pill exception below the hero: toolbar controls.** Compact
toolbar _pickers and disclosures_ — Sort / Group / Show / the view-mode toggle /
the card-size zoom stepper (`ZoomControl`) / the symbol **Key** — use the shared
`.toolbar-pill` (`999px`, `--surface` bg,
`0.5px --border-strong` border), not a rect. They're neither do-something
_actions_ (those are rects) nor static _labels_ (those are non-actionable chips)
but a third thing — _controls_ — and the pill is their established family
(`SelectMenu`, the `ToolbarPopover` trigger, `Legend variant="pill"`). This and
the circular icon-only button are the **only** labelled pills allowed below the
hero; a one-off labelled pill that _isn't_ part of this toolbar-control family
still reads as a tag — don't.

**The class name does not decide the shape — the element's _role_ does.** A
class called `.format-pill`, `.theme-chip`, `.game-menu-pill`, or `.bracket-pill`
is still a **rect** if it's a `<button>` that does something below the hero
(toggle, radio, action). Read the JSX, not the selector: a clickable that
mutates state is a rect; a non-actionable `<span>` that only displays state is a
pill; a compact toolbar picker/disclosure carrying the toolbar-pill signature
(`--surface`/`--surface-raised` bg + `0.5px --border-strong`) is a pill. When the
name and the role disagree, the role wins (the names predate this rule).

**Segmented controls split container vs option.** The wrapper
(`div[role="radiogroup"]`, e.g. `.binder-mode-toggle`) is a **container** →
`var(--radius-lg)`. Its inner option buttons are **rects** (`var(--radius)`)
unless the segmented control is a genuine _toolbar view-mode toggle_ that lives in
a control row (then the whole `.toolbar-pill` segmented family is `999px`, e.g.
`.pick-mode-toggle`). A radio/segmented selector inside a form or settings panel
is not that — its options are rects.

**A selector keeps its note in ONE block with it.** The cube's size picker
(six options, so a `SelectMenu` per [§ Config surfaces](style-guide/components.md#config-surfaces-t139)) sits in the `.cube-size`
column with its one-line note directly under it, so the note stays with the
control when `.cube-controls` becomes a toolbar row. A selector that decides
what a thing is FOR (a play format, a pod size) is not a filter; it leads the
controls, ahead of the "Draw from" pickers. The Draft / Commander format row
that used to lead this block was taken out of the UI (board T150): it only
swapped corpus targets and could not build a Commander cube. If a format comes
back, it is a `SegmentedControl` above the size, with its own note.

**Segmented options carry the 44px coarse floor on the SPAN, not the label.**
The label-wrapping-a-hidden-radio pattern (`.binder-mode-pill`,
`.rule-segmented-pill`, `.playtest-scry-mode`, `SegmentedControl`'s own
`.segmented-option`) puts padding and text in an inner `<span>`. A `min-height: 44px` on the label wrapper grows the pill
but leaves the span text-height and top-aligned inside it — the Private /
Public toggle shipped that way on phones. The span is a centering flex box
(`align-items: center`) and the coarse floor sits on it; the
`overlay-containment` guard's "segmented-control options" block enforces both.

**Toolbar steppers: ends disable, never hide.** A −/+ stepper over an ordered
range (the card-size `ZoomControl` in the collection/deck/list grids) renders as a
`.toolbar-viewmode` button pair — same pill family, lucide glyphs at
`width/height={14}`, and the coarse-pointer 2.75rem touch sizing for free. At a
range bound the end button gets `disabled` (`.toolbar-viewmode-btn:disabled`:
0.35 opacity, `cursor: default`; the hover rule is gated `:not(:disabled)`)
rather than disappearing — a vanishing button reads as a layout bug and shifts
its neighbors. Per-viewport curation belongs in the _range_ (e.g. narrow
viewports cap the max zoom step where larger steps stop changing the layout),
not in hiding the control. Established by the grid zoom control (#1206), which
replaced the 1×/2×/3× preset toggle.

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

**Collapsed disclosure groups show their current setting in the header** — a
muted, right-aligned, ellipsizing value summary (`.deck-customizer-group-summary`
in the deck-gen customizer is the reference) rendered only while closed, so a
non-default setting is never invisible ("Budget · $50 deck", "Salt · Unsalted").
Related ruling: **identity-level controls don't collapse.** A control that
changes _what kind of result_ the user gets (target bracket, Staples ↔ Brew)
stays always-open; collapsibles are for constraints and advanced tuning. Don't
bury an objective-function dial in a closed group with an opaque title.

**A body hidden with the `hidden` attribute must kill its own `display`.**
`hidden` is only a `display: none` in the browser's stylesheet, so any author
rule giving that element a `display` — `.deck-card-grid { display: grid }`,
`.deck-section-rows { display: flex }` — silently outranks it and the section
never closes: the chevron turns, `aria-expanded` flips, and every card stays on
screen. Pair the attribute with `.<body-class>[hidden] { display: none }` (or
hide from the panel's `.is-collapsed`, which the combos and test-hand lanes do).
Guarded by `styles/hidden-beats-display.test.ts`, which reads the JSX for every
`hidden={…}` body and fails on one whose class sets a `display` nothing beats.

**Avatars are circular — the one shape exception outside the button/label
taxonomy above.** `UserAvatar` (a person's card-art image, or a flat-colored
initial when unset) is `border-radius: 50%`, not `--radius`/`--radius-lg`/pill.
It's a deliberate, sanctioned exception: the pill-vs-rect rules above govern
_actionable_ and _label_ elements, and an avatar is neither — it's a
decorative person-identity glyph (`aria-hidden`, named by adjacent text), the
same category a circular profile photo occupies industry-wide. First shipped
in the profile editor (Settings), now also the public profile page
(`/u/:username`) header. Don't generalize the circle to other images or
thumbnails (card art, cover art stay rect via `--radius`/`--radius-lg`) —
this exception is scoped to person-identity avatars only.

## Icon scale

App-wide `lucide-react` usage ranged over 16 sizes (11–22px, plus a handful of
much larger illustrative marks) and 11 stroke widths with no stated rule
(board T157, 2026-09-27). Five (size, stroke) pairs are now **the** scale —
every new icon uses one of these, and existing call sites were migrated to
match in the same pass:

| Context                                                           | Size | Stroke |
| ----------------------------------------------------------------- | ---- | ------ |
| Micro (a badge/tag glyph, or a no-prose control in a dense row)   | 12px | 2      |
| Inline-with-text (a glyph beside a rendered word/phrase)          | 14px | 1.8    |
| Standalone trigger (a tappable icon-only or icon+chevron control) | 16px | 2      |
| Hero-adjacent (next to a page-hero heading/CTA)                   | 18px | 2      |
| Large control (a bigger dismiss/primary standalone icon)          | 20px | 1.8    |

Pick by the icon's role, not the surface it happens to sit on — a leading
icon inside a button label is "inline-with-text" even if the button itself is
a hero CTA.

The scale's canonical home is `lib/icon-scale.ts` (`ICON_SCALE`) — reach for it
when a size needs to travel through code; a JSX call site stays a plain
`width={14} height={14} strokeWidth={1.8}` literal, lucide's own idiomatic
shape. `src/test/icon-scale.test.ts` is the guard: it walks every non-test
source file, resolves each `lucide-react` import (aliases included), and fails
on a literal `size`/`width`/`height`/`strokeWidth` whose (size, stroke) pair
isn't one of the five above. `Button`/`IconButton` (`components/shared/
Button.tsx`) never size the glyph themselves — they just mark it
`aria-hidden` — so the size lives at the call site, which is what the guard
checks. A handful of sites are deliberately off-scale (a miniature preview
badge, an empty/error-state mark, a live-game touch target, a scanner/camera
CTA) and are named in the guard's own allowlist with the reason; anything else
the guard flags is a real regression to fix, not a value to allowlist.

## Typography — the four roles (T53/E154)

There are always exactly **four type roles**, and every rule below is written
against the _token_, never against a face name. Which faces fill them is a
user choice — see § Type sets.

| Role    | Token            | Scope                                                                                                                            | Never                                                 |
| ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Body    | `--font-serif`   | The default: body, controls, section/lane titles (incl. the serif-caps `.deck-combos-title` family)                              | —                                                     |
| Display | `--font-display` | **Hero tier only**: binder/deck hero names + page-identity titles at `--text-xl` and up (list below)                             | body, chrome, section titles, dialog titles, numerals |
| Label   | `--font-label`   | Chrome/tab/tape labels, uppercase + tracked — see [§ App chrome](style-guide/app-shell.md#app-chrome--leather--divider-tabs-t53) | prose, headings, form controls                        |
| Data    | `--font-mono`    | Data: prices, qty, set codes, tabular numerals                                                                                   | —                                                     |

In the default set (**Codex**) those roles are Eczar / Marcellus / Archivo
Narrow / IBM Plex Mono respectively. Older examples in this section were written
against **Folio** or **Grimoire**, both still selectable sets — where one names
a face, read the role.

**The default set is chosen for legibility, not for taste.** A default is what
every reader gets _before they know a picker exists_, so it is the one set that
has to work for someone who did not choose it. Grimoire — whose own registry
hint reads "Gothic and heavy. Loud on purpose" — is the least legible set we
ship, so it is an opt-in a click away in Settings → Appearance rather than the
thing a first-time visitor is handed. Codex keeps a distinctive inscriptional
display face without a decorative gothic one. Expressive sets stay fully
available; they are simply never the default. Flipping `DEFAULT_TYPESET` is four
coordinated edits plus a test fixture — see the comment on the constant, and
note the label face sets every mobile tab-bar cell's width, so a new default
must be checked at 360px.

### Type sets — the user-selectable typeface axis

`lib/typesets.ts` + `styles/typesets.css` + the picker in
`components/TypeSetPicker.tsx`. A set is a `data-typeset="<id>"` attribute on
`<html>`, exactly parallel to a theme's `data-theme`, and the two axes compose
freely: **a set touches only the four type tokens, a theme only color tokens.**
Rulings:

- **Sets swap all four roles together, never one.** There is deliberately no
  per-face picker. The display face's contrast is chosen against its body face
  and the label face against the chrome; letting users mix across sets is how a
  UI stops reading as one system. Adding a set means choosing a whole pairing.
- **Nothing but the four font tokens belongs in a `[data-typeset]` block.**
  Sizing stays on the `--text-*` scale and color stays with the themes. The one
  sanctioned exception is an optical correction where a body face's x-height
  makes the shared scale read a step small — use native `font-size-adjust`
  (as `almanac` does), never a per-set `--text-*` override, which would fork
  the scale. Put it on `body` **and** the form controls
  (`:is(body, button, input, select, textarea)`): the UA stylesheet sets the
  `font` shorthand on controls, which resets `font-size-adjust` instead of
  inheriting it, so a rule on `body` alone left every `<button>` label ~12%
  smaller than an `<a>` with the same `.btn` classes beside it (E433,
  guarded in `lib/typesets.test.ts`).
- **Every stack ends in the same generic families as the `tokens.css`
  defaults**, so a set whose webfont fails to load degrades to the same system
  serif/sans/mono rather than to an unrelated face.
- **Only the active set's fonts are downloaded.** The default set's faces are
  bundled (`styles/fonts.css`, preloaded from `index.html`); every other set's
  self-hosted sheet (`public/fonts/typeset-<id>.css`) is injected by
  `store/typeset.ts` and removed on the way back to the default.
  `typeSetHref(DEFAULT_TYPESET)` returns `null` for exactly that reason —
  returning a sheet would double-fetch the same families. The picker is the one
  place that loads them all, so its tiles preview rather than describe.
- **Every face is self-hosted and centres its capital height.** No face loads
  from Google Fonts: each `@font-face` carries `ascent-override` /
  `descent-override` computed from the font's own tables so the capitals sit
  exactly mid line box, with the total unchanged (so `line-height: normal`
  doesn't move). Without them every flex-centred label (`.btn`, `.pill-btn`,
  chips, tabs) sat a pixel or two off the icon beside it, low in Plain and high
  in Codex. `styles/font-metrics.test.ts` re-reads each woff2 and fails on a
  face that's missing them or carries stale numbers; the header of that test
  has the formula. Plain can't override `system-ui`, so it leads with
  `'SC Segoe UI'`, a `local()` alias of Windows' system face with the same
  correction (SF and Roboto are already within 0.2px). Don't reach for
  per-component nudges (`translate`, asymmetric padding) to centre a label:
  they fix one surface in one set and break it in the next.
  `text-box-trim` is not the fix either: it applies to block containers, and a
  button's bare text node is an anonymous flex item it never reaches.
- **`font-weight: 400` on `--font-display` still holds for every set.** Several
  display faces ship a single cut and synthesize a smeared faux-bold otherwise;
  sets whose face does have a bold simply render regular. Hierarchy still comes
  from size and face contrast, never weight.
- **A new set must be checked at 360px before it lands.** The label face sets
  the width of every mobile tab-bar cell, and a wide one overflows its cell —
  the exact bug E159 fixed. Verify the tab bar and the Collection hub strip at
  360px, not just at desktop.
- **Changing `DEFAULT_TYPESET` re-skins the app for everyone who has never
  opened the picker**, and must move the new default's faces into
  `styles/fonts.css` (and the old default's out into its own
  `typeset-<id>.css`), together with the `index.html` preloads. The comment on
  `DEFAULT_TYPESET` lists every coordinated edit.

Rulings for `--font-display` (restyle Phase 6):

- **It marks identity, not structure.** The display face answers "what am I
  looking at" — the page's own name. Adopters: `.binder-hero-name` (the shared
  page-title class — Collection/Decks/Binders/Lists/Sets/Play/Pods/Settings/
  Discover/Saved/Cube + real binder/list/set names), `.deck-editor-name`(+
  `-input` — the pair must match or toggling edit mode flashes fonts),
  `.deck-builder-header h1`, `.shared-view-title`, `.auth-title`,
  `.welcome-hero-headline`, `.friends-page-heading`, `.friend-hub-heading`,
  `.public-profile-name`, `.pod-hub-name`. Everything _functional_ stays
  `--font-serif`: dialog/sheet/modal titles (a confirm dialog is not ceremony),
  section and lane headings, empty-state taglines, error-state titles
  ("Link not found"), stat numerals, the `--text-lg` home greeting.
- **Always pair `font-family: var(--font-display)` with `font-weight: 400`.**
  Several sets' display faces ship a single cut (Germania One, Sorts Mill
  Goudy, Marcellus, IM Fell English…), and a leftover 600/700 makes the
  browser synthesize a smeared faux-bold. Sets whose face does have a bold
  simply render regular. Hierarchy comes from size
  - face contrast (the vintage-print convention), never weight. A rename input
    smaller than its title (`.pod-hub-name-input`, `--text-lg`) is a form
    control and stays `--font-serif` — only a same-size editable twin of the
    title itself (`.deck-editor-name-input`) wears the display face.
- **Fallback degrades to the set's own body face, not Georgia-bold-soup:**
  every set's display stack ends `<display>, <its body face>, 'Georgia', serif`
  (default: `'Germania One', 'Vollkorn', 'Georgia', serif`), so a failed font
  load renders a lighter same-set title and nothing else moves.
- **The display wordmark is one voice (E156).** Everywhere "SpellControl"
  renders at identity scale — `.site-brand` (header chrome), `.shared-brand`
  (public brandbar), `.auth-title` — it wears `--font-display` at
  `--text-lg`+ / weight 400. A split wordmark (two faces for the same brand
  name) is the one wrong state; if a new surface needs the brand at identity
  scale, copy the `.site-brand` treatment. **Micro renders are exempt and
  stay as they are**: the welcome hero's uppercase-tracked eyebrow
  (`.welcome-hero-wordmark`, `--text-sm`) and the deck-identity card's
  attribution line (`--text-xs`) function as labels, and an oldstyle display
  face dies in tiny tracked caps — don't "unify" those.

## System preferences — honour them, don't reinvent them

The OS already carries the reader's accessibility choices. Respond to those
signals rather than shipping an in-app duplicate of each one.

- **`prefers-color-scheme`** picks the first-run theme (light → Azorius,
  dark → Dimir). Read once, synchronously, pre-paint; a stored choice always
  wins afterwards and we never live-switch under the user.
- **`prefers-reduced-motion`** is a required branch on any non-trivial
  animation — see the motion rules later in this guide.
- **`prefers-contrast: more`** retires the two tokens that trade contrast for
  tone: `--text-muted` becomes `--text-secondary`, and `--border` becomes
  `--border-strong`. Every palette already clears AA (and AAA on primary text),
  so this is not a rescue — it honours a reader who asked for less subtlety.

  Three rules for that block, all load-bearing:
  1. **Re-point at stronger siblings; never declare new colours.** Each theme
     defines its own `--text-secondary` / `--border-strong`, so one block covers
     all ten with correct hues, and a new theme is covered the day it lands.
  2. **A token can never reference itself.**
     `--text-muted: color-mix(…, var(--text-muted), …)` is a cycle, which makes
     the property invalid at computed-value time and silently drops it.
  3. **It must stay last in `themes.css`.** `:root`, `[data-theme='…']` and
     `[data-scheme='…']` all carry equal specificity, so source order is the
     only reason it wins. A media query adds no specificity.

  `themes-contrast.test.ts` pins that secondary is at least as strong as muted
  in every theme — otherwise "more contrast" could mean _less_ in some theme,
  and nothing else would catch it, since the block declares no colour of its own.

## Interactive semantics (jsx-a11y, 2026-09-09)

`eslint-plugin-jsx-a11y` (recommended set) is part of `npm run lint`; these are
the rulings behind the config and the fixes that brought the tree to zero.

- **A thing you click is a `<button>`.** A `div`/`span`/`li` with `onClick`
  and no interactive children becomes `<button type="button">` with its
  classes kept (add `background: none; border: 0; padding: 0; font: inherit;
color: inherit; text-align: inherit;` to the element's OWN rule only if the
  button chrome shows through). One that must stay a `div` because it wraps
  other controls (a row with an inner button) gets `role="button"`,
  `tabIndex={0}`, and an Enter/Space `onKeyDown` — the pattern in
  `components/shared/CardRow.tsx`. Never an `eslint-disable`.
- **Backdrops.** The dim layer is `role="presentation"` and dismisses only on
  a hit on itself: `onClick={(e) => { e.stopPropagation(); if (e.target ===
e.currentTarget) close(); }}`. A full-screen viewer whose backdrop is covered by its
  own stage (the card preview) names its empty-space elements instead and
  checks the target against that list (`isEmptySpace` in `CardPreview`). That
  is the same rule: only empty space closes, and nothing interactive is ever
  in the list. The dialog panel inside carries NO click
  handler — the old `onClick={(e) => e.stopPropagation()}` on the panel was
  never an interaction. The backdrop keeps the propagation stop because
  overlays are portaled and React bubbles a click inside them to the tile
  that opened them.
- **Options are options.** A pick-list row is `role="option"` +
  `aria-selected` inside a `role="listbox"`, with its own Enter/Space
  handler even when the container drives arrow keys (`useMenuKeyboard`).
  A search input that opens one is `role="combobox"` with
  `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`.
- **Labels label a control.** `<label>` sits on a real input via `htmlFor`,
  or becomes a `<span id>` the custom control points at with
  `aria-labelledby`. A label wrapping an icon-only control carries its text
  as `.sr-only`.
- **Deliberate exceptions, in the config:** `no-autofocus` is off (sheets and
  dialogs focus their first field on open; `lib/overlay-layer.ts` restores
  focus on close), and `role="list"` on `ul`/`ol` is allowed (Safari/VoiceOver
  drops list semantics from `list-style: none` lists; the explicit role
  restores them).

## Z-index / layering

- **Always use the `--z-*` tokens** (in `styles/tokens.css`), never raw integers:
  `--z-dropdown` (50) · `--z-popover` (60) · `--z-refresh` (90) · `--z-panel` (100)
  · `--z-menu` (120)
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
  3. `--z-refresh` (90) — the **pull-to-refresh spinner**, nothing else. It
     descends from the top of `.app-main`, the same edge every sticky strip
     pins to, so it must clear all of them, and it stays under the app frame
     and every sheet. It shipped at a raw `5` and slid under the hub tabs.
     A new sticky rule inside the app stays below it;
     `styles/pull-to-refresh-stacking.test.ts` checks every sticky rule.
  4. `--z-menu` (120) — menus/popovers opened from a **header/hero that sits
     above sticky chrome** (e.g. a ⋮ overflow in the page hero). Above the
     sticky row so it floats over it instead of dropping behind.
  5. `--z-panel` (100) and up — fixed app frame (tab bar), sheets (`--z-sheet-*`),
     modals/overlays (`--z-modal`/`--z-overlay`), tooltips (`--z-tooltip`). These
     always sit above all of the above.
- **The recurring bug:** a sticky search/nav row at `--z-panel` swallows any menu
  opened from the hero above it. Two fixes are wrong (`calc(--z-panel + 1)` on the
  menu) and one is right (drop the sticky row to `--z-popover`, put the menu at
  `--z-menu`). Precedents that get it right: the deck editor's
  `.deck-editor-view-tabs` (`--z-popover`) + `.deck-editor-overflow-panel`
  (`--z-menu`); the decks/binders `…-index-search-row` (`--z-popover`) +
  `.overflow-menu-popover`.
- **Anything portaled to `<body>` stacks against body children, not its
  trigger's surface.** The shared ⋮ panel (`.overflow-menu-popover`) is
  therefore on `--z-portal-popover` (1200): it can be opened from inside a
  full-screen surface fixed at `--z-overlay` (the paper Horde table, the
  playtest board, the card preview), and at `--z-menu` it painted under that
  surface, unclickable (the Horde table's Undo / End game / Leave the table,
  2026-09). Never give one instance a lower override;
  `OverflowMenu.stacking.test.ts` enforces it.
- **Rule of thumb:** if A must paint over B, A's token must be strictly greater
  than B's — and B is whatever A physically overlaps, _not_ what's near it in the
  DOM. A sticky element creates its own stacking context, so its token wins
  against later siblings regardless of source order.
- **`.app-main` must never form a stacking context — no exceptions.** It is the
  scroll region every page renders into, and the mobile tab bar is its _later
  sibling_ in `.app-shell`. The moment `.app-main` becomes a stacking context its
  entire subtree composites as one unit at its own (auto) level, so every
  `position: fixed` overlay inside it — sheets, modals, scrims, at any `--z-*`
  token, including `--z-overlay` (1100) — paints **below** the tab bar. Nothing
  throws; sheets just render with the nav sitting on top of them at every mobile
  and native breakpoint. The properties that do it: `view-transition-name`,
  `transform`, `filter`, `backdrop-filter`, `perspective`, `contain` (layout /
  paint / strict / content), `container-type`, `will-change` of any of those,
  `isolation: isolate`. **This shipped once already:** the route transition named
  `.app-main` — `view-transition-name` forms a stacking context _permanently_,
  not only while a transition runs. The fix was to name the **chrome**
  (`.site-header`, `.mobile-tab-bar`, `.scan-fab-root` →
  `view-transition-name: sc-chrome-*`, each with `animation: none`) and let the
  content animate as `root`, which by definition excludes anything separately
  named. Guarded by `styles/overlay-containment.test.ts`.
- **Sheets that portal to `<body>` were immune** to the above, which is why this
  class of bug reads as arbitrary — roughly half the sheets looked correct. Never
  take a working portaled sheet as evidence the in-tree ones are fine.

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
sheets skip the hook). The rule is about the **entry animation**, not the
element type: an inline conditional render (`{show && <div className="card-picker-sheet">}`),
a full-page generation takeover, and a hand-rolled `.modal-backdrop` all need
it just as much as a named sheet component. Hand-rolled confirm/destructive
dialogs must route through the shared `<Modal>` (it owns the `is-closing` exit,
scroll-lock, focus-trap, Escape, and a `dismissable={!busy}` prop to lock
dismissal while work is in flight) rather than re-implementing the backdrop.

**Transient table/game moments skip `useSheetExit` — deliberately.** A
non-blocking notification overlay (a "Your turn" beat, a win ceremony, a
floating reaction — anything `role="status"` that the player may want to keep
playing THROUGH) must not trap focus, and `useSheetExit`'s focus-trap is
unconditional. These hand-roll a minimal `is-closing` + `animationend` exit
instead, and MUST include a `prefers-reduced-motion` branch that closes
synchronously (mirroring `useSheetExit`'s own carve-out): a disabled CSS
animation never fires `animationend`, so an animation-gated dismiss becomes a
stuck-open overlay under reduced motion. See `playtest/components/
TableMoments.tsx` / `TableSignals.tsx` for the reference shape.

### Tokens (styles/tokens.css)

| Token             | Value                             | Use                                 |
| ----------------- | --------------------------------- | ----------------------------------- |
| `--motion-fast`   | 120ms                             | hovers, presses, popover enter      |
| `--motion-base`   | 200ms                             | fades, drawer exits, toast leave    |
| `--motion-gentle` | 320ms                             | sheet exits, emphasis one-shots     |
| `--motion-drawer` | 500ms                             | full-screen sheet rise (entry only) |
| `--ease-out-soft` | cubic-bezier(0.2, 0.9, 0.3, 1)    | default for every entrance/move     |
| `--ease-drawer`   | cubic-bezier(0.32, 0.72, 0, 1)    | full-distance sheet travel          |
| `--ease-pop`      | cubic-bezier(0.2, 0.9, 0.25, 1.4) | overshoot: counters, numeric pops   |
| `linear`          |                                   | spinners, progress, confetti        |

**`motion-tokens.test.ts` ratchets raw durations (T157 W5).** A per-file count
of raw (non-token) `transition`/`animation` durations outside `@keyframes` may
not rise — snap a new one to the matching `--motion-*`/`--ease-*` token or a
canonical pattern below, or lock in a genuine improvement with
`UPDATE_MOTION_BASELINE=1 npm test -- src/styles/motion-tokens.test.ts`.

Don't invent a new bezier — if none of these reads right, that's a
STYLE_GUIDE discussion, not an inline constant.

**`--ease-pop`'s overshoot is scoped to numeric/counter pops** (a value tick,
a badge count bump) — a spring read that suits a number jumping. This is a
**documented decision, not an oversight**: `SealBurst` ([§ Completion moments](style-guide/app-shell.md#completion-moments-the-seal))
deliberately uses `--ease-out-soft` instead. A stamped seal settles into place;
it doesn't spring. Don't "fix" SealBurst to use `--ease-pop` for consistency
with the celebration-only half of this row's `Use` column — the two
celebration surfaces have different physical characters on purpose.

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
7. **Staggered entrance (panels & index cards)** — every cascade goes through
   `usePanelCascade(key)` + `panelCascadeClass(i, animating)` (the shared
   `panel-cascade-in` keyframe: 8px rise + fade, 40ms steps, capped at 6
   slots; reduced-motion gated). Key it to a computation identity (the
   analysis bento) or a page-scoped once-per-session key (`'decks-index:cascade'`,
   `'binders-index:cascade'`) — and pass the key **only when the list is
   non-empty**, or an empty first visit consumes the key with nothing to show.
   Don't hand-roll a bespoke list stagger.

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

**No gyro tilt.** The card preview never follows the phone's physical motion.
A device-orientation foil tilt shipped in #601 and was removed as distracting:
the card drifting while you simply hold the phone reads as jitter, not as a
binder in the hand. The cursor-driven tilt on hover devices stays (it only moves
when the user moves the pointer). Don't reintroduce a `deviceorientation`
listener; `use-holographic.test.tsx` guards against one.

### Reduced motion

Every keyframe gets a `prefers-reduced-motion: reduce` gate (the global
0.001ms kill is a backstop, not the mechanism — infinite loops must set
`animation: none` explicitly). **Why the backstop is not enough for an
`infinite` loop:** it shortens `animation-duration` to 0.001ms, which on a loop
runs ~1,000 cycles/second — a strobe categorically _more_ dangerous for
vestibular/photosensitive users than the original gentle animation. So every
`infinite` keyframe (pulsing dots, skeletons, winner glows) MUST carry an
explicit `@media (prefers-reduced-motion: reduce) { animation: none }` in its
own file. Any JS that waits on `animationend` must check `matchMedia` and
complete immediately under reduce (see `use-sheet-exit.ts` for the reference
implementation).

**One shared shimmer.** Every loading skeleton anywhere in the app uses the
single `skeleton-shimmer` keyframe (declared once in `footer-card-preview.css`);
do not declare a bespoke `@keyframes *-shimmer` clone. `motion-tokens.test.ts`
fails CI on any other `*-shimmer` keyframe.

**Infinite animations inside a scroll-snap carousel run on the active, resting
slide only (2026-09-07 ruling, #1772).** `skeleton-shimmer` animates
`background-position`, which is _not_ compositor accelerated — every tick
repaints the element on the main thread. Inside the binder flipbook's render
window that is ~120 pockets, and it turned every trackpad-pan frame into a full
repaint + re-raster (measured over one 2.5s pan: 29k paint records / 4.5k
raster tasks; 82 / 111 once paused) — the "stuttery, glitchy swipe". The rule
set in `footer-card-preview.css` pauses (`animation-play-state: paused`, so it
resumes in place) every slide-content animation on `:not(.is-active)` slides
and on all slides while the track carries `is-scrolling` (set by
`SnapCarousel` for the scroll plus its 150ms settle). Anything new that loops
inside a `.card-preview-slide` / `.binder-pages-slide` must join that selector
list.

**The foil moves by `transform`, never `background-position` (#1775).**
The ambient drift (grid tiles, deck tiles, binder pockets, touch-mode preview)
and the preview's cursor parallax used to animate `background-position` on the
shine — so even at rest a binder page with foil pockets repainted and
re-rastered every frame (740 paint records / 552 raster tasks per 3s of doing
nothing; the whole browser felt laggy with the flipbook open). Every foil layer
now lives on a 200% `::before`/`::after` canvas that _translates_, so the drift
and the parallax are compositor-only: 0 paint at rest, and a 2s cursor sweep
over the preview costs single-digit paints. Non-active carousel slides get
`animation: none` (no animation → no compositor layer) rather than `paused`.
Nothing may assume a `background-position` (or `background-size`,
`box-shadow`, `filter`) animation is cheap because "it's just a gradient" — if
it has to loop, it moves by `transform` or `opacity`.

**A foil canvas never shows its edge.** A canvas N% of the card covers it only
while its translate stays inside `[−(N − 100)/N, 0]` of its own size — for the
200% canvas, `[−50%, 0]`. #1775's first version paired a 3.2× canvas with a
2×/2.5× cursor parallax, so outside the middle of the card the canvas edge cut
across the art as a ruler-straight line and past ~75% the foil left the card
entirely. `styles/foil-geometry.test.ts` evaluates every `translate` in
`holographic.css` at cursor 0% and 100% and fails on any escape; a cursor var
it cannot resolve fails too.

**Foil layers are square; the host clips the corners.** The preview face
clips by `clip-path`, the tiles by `overflow` + radius. A rounded clip on a
blended layer whose canvas moves repaints that layer every frame (measured
~290 paints per 2s sweep with `border-radius: inherit` on the layers, 2
without), so the three layers carry no radius of their own.

### Foil

One engine (`styles/holographic.css`), three layers rendered by
`components/shared/FoilShimmer`: a **spectrum × light-bars** shine
colour-dodged onto the art (bright ink catches the colour, dark ink stays
dark, which is what makes it read as metal rather than tinted film), an
optional **grain** for finishes with texture, and a **glare** hotspot. Rules:

- **A foil card always reads as foil.** The preview never hides the foil until
  the cursor arrives: it rests at `--foil-rest` (0.45 on the hover preview,
  0.8 on thumbnails and touch) and the cursor lifts it to full. With no cursor
  the glare parks upper-left like a room light (`HOLO_REST`, 32% / 22%).
- **Thumbnails never move in lockstep.** Each one's drift is phase-shifted by
  `--foil-seed`, a stable hash of its id (`foilSeed`). Where the browser has
  scroll-driven animations the thumbnail foil is tied to its scroller
  (`view-timeline`: block for grids, inline for the binder flipbook) and does
  nothing at rest; elsewhere it falls back to the 11s / 7s clock drift.
- **Grain is mid-grey, never white.** Under `color-dodge` a white speck blows
  out any pixel, black ink included (it reads as TV static); a grey one only
  brightens ink that already reflects.
- **One treatment per finish** (`classifyFoil` → `.foil-{style}`): regular,
  etched (silver, not gold), oil slick, gilded, halo/surge, ripple, rainbow,
  textured/confetti/raised, galaxy, fracture. A new finish is a `FoilStyle`, a
  `FOIL_LABEL`, a `--foil-spectrum` (dark stops, since dodge brightens by the
  blend colour) and a `.foil-badge.foil-{style}` chip fill.
- **The list-row foil chip is static.** `.foil-badge` used to drift with the
  card shimmer, which made every chip an infinitely animating layer (200 chips
  = 404 layers) for a motion invisible at 15px.

## Color & spacing

**Caller owns spacing (2026-09-11, #1887).** A shared component — anything in
§ Primitives index, the AI panels (`.deck-ai-strip` / `.deck-ai-review` /
`.deck-stats-panel` / `.ai-sources`), any root that mounts in more than one
host — declares **no outer vertical margin**. The host that renders it lays
its children out with `gap` (a flex column, a grid, or a host-scoped wrapper
rule such as `.deck-size-prompt-ai { margin-bottom }`). One convention, not
two: a component that carries its own margin doubles the gap in every host
that already has one and still lands flush in every host that doesn't — the
refine panel shipped flush against the build report's last pill row because
its Coach-tab home supplied the gap and the sheet supplied nothing. Enforced
by `styles/spacing-ownership.test.ts` (the root list lives there; add a root
when you add a shared component) and, in the browser, by the nightly
journey's touching-siblings check (`scripts/journey.mjs`), which fails a
screen where two stacked blocks touch. Mounting a shared component somewhere
new? The new host declares the gap — that is the whole checklist. Every root
the test lists is now converted (E287 took the last two, `.empty-state-mark`
and `.collection-filter-chips`, via `.empty-state > .empty-state-mark` and
`.card-list > / .container > .collection-filter-chips` host rules), so its
not-yet-converted list is empty and stays empty.

**Material system (restyle T53).** The palette is built from physical binder
materials, not dashboard neutrals — this is the app's differentiation from the
Moxfield/Archidekt dark-slate genre, so hold new surfaces to it:

- **Light guilds are guild-tinted paper** (warm page surfaces, ink-dark text);
  their `--accent` is a deep "binder cover" dye. **Dark guilds are dyed
  leather** (deep guild-hued grounds, aged-paper text); their `--accent` is a
  foil-stamp hue. A new theme joins one of those two material families —
  never a flat neutral gray/slate ramp.
- **Texture is one token:** `--grain` (per `data-scheme` in `themes.css`,
  alpha-only so `--bg` reads through) painted by the single body rule in
  `base-layout.css` — a 5px repeating fleck field (paper tooth on light,
  pebbled leather on dark). Don't add per-surface texture rules or image
  assets; surfaces get their material read from the page ground showing
  through gaps, not from re-texturing every panel.
- **Contrast bar for palette work** (what the re-derivation shipped with, and
  what any future tweak must re-clear): `--text-muted` ≥ 4.5:1 on
  bg/surface/surface-raised (CI: `themes-contrast.test.ts`), plus
  `--text-secondary` ≥ 4.5:1, `--text-primary` ≥ 6.5:1, `--on-accent` vs
  `--accent` ≥ 4.5:1, and `--accent` vs `--surface` ≥ 3:1 (WCAG 1.4.11).
- **Sleeve matte for index tiles.** `.decks-index-card` / `.binders-index-card`
  sit on the page as card sleeves: `--surface-raised` bg + `--shadow-card`,
  keeping their identity-color left border. No gloss overlays — the banner is
  a replaced `<img>` (no pseudo-elements) and the Discover tile stacks
  scrim/stats/hover-zoom contracts a sheen would fight; the material read
  comes from matte + paper, not decoration.
- **Pods tiles join the same sleeve-matte family, without cover art.** Pods
  carry no art/color data by design (a privacy ruling — see `routes/pods.ts`),
  so `.pods-index-card` gets the `--surface-raised` + `--shadow-card` surface
  but stands in the owner's `UserAvatar` (initial-letter fallback) as its
  identity medallion instead of a banner. Pods are ring-2 content — this is
  the deliberately lighter-weight tile treatment, not an oversight.
- **Real tables speak print.** A genuine `<table>` (`.shared-list-table`,
  `.play-records-table`) wears the price-guide voice: `--font-label` caps
  header over a solid `--text-secondary` ink rule, `1px dotted var(--border)`
  row separators, `tabular-nums` cells. Div-based lists (the virtualized
  collection list, movers) are NOT retro-fitted into this voice.

- **Always theme variables**, never hard-coded colors: `--surface`, `--surface-raised`,
  `--text-primary`, `--text-secondary`, `--text-muted`, `--border`, `--border-strong`, `--accent`,
  `--accent-light`, `--on-accent`, etc. This is what makes light/dark themes work.
- **`--on-accent` is the sole token for text/icons on an accent-fill surface.**
  Any element with `background: var(--accent)` sets `color: var(--on-accent)` for
  its filled/active state. Never use literal `#fff`/`white` there — it's
  mechanically the same bug as the dead `--accent-text` token and fails WCAG AA
  on light-accent themes (Gruul, Golgari, Selesnya, Izzet, Orzhov…).
- **Dead T35-migration tokens — never reference these (CSS resolves an undefined
  `var()` to a silent fallback, no build error).** `ghost-tokens.test.ts` fails
  CI on any of them:

  | Dead                                       | → use                                         |
  | ------------------------------------------ | --------------------------------------------- |
  | `--surface1` / `--surface2` / `--surface3` | `--surface` / `--surface-raised`              |
  | `--accent-text`                            | `--on-accent`                                 |
  | `--accent-soft`                            | `--accent-light`                              |
  | `--danger` / `--danger-bg`                 | `--err-text` / `--err-border` / `--err-bg`    |
  | `--warn` (bare)                            | `--warn-text` / `--warn-border` / `--warn-bg` |
  | `--muted`                                  | `--text-muted`                                |
  | `--motion-slow`                            | `--motion-base` / `--motion-gentle`           |

- **Elevation tiers (T157 W5 — one scale, five steps, by role not by pixel
  guess):** `--shadow-raised` (a chip/badge lifted a hair off its surface),
  `--shadow-card` (a resting card-like surface — auth/welcome panels, a
  thumbnail off its grid), `--shadow-tooltip` (a popover/menu/dropdown/flyout),
  `--shadow-sheet` (a bottom sheet or dock rising from a screen edge),
  `--shadow-modal` (a dialog/takeover that suspends the page). Rings
  (`0 0 0 Npx var(...)`), insets and meaningful glows (turn ring, damage
  flash, foil) are never elevation and stay as literals.
  `styles/elevation-ratchet.test.ts` freezes every remaining raw elevation
  box-shadow per file and fails if the count rises.
- **On-art scrims are an intentional non-themed exception:** elements that sit on
  card images (qty/set badges on grid tiles) use `--art-scrim` /
  `--art-scrim-text`, not inline `rgba`. Card art is theme-invariant, so these
  tokens are deliberately not themed; using them anywhere else is a smell.
  **Tone text on a plate uses the scrim tone set (E155), never the themed
  tokens:** `--art-scrim-{success,err,warn,info,muted}` are fixed pale hues —
  the themed status tokens are paper-tuned deep in light guilds and drop to
  ~1.4–3:1 on the always-dark plate — and `--art-scrim-accent` is the guild
  accent mixed 45% toward white, keeping its hue while clearing ≥4.5:1 against
  the worst-case (bright-art) plate. The deck-grid role chips route through
  `--role-ink-scrim` set beside each role hue group so the role→hue map stays
  in one place.
  **One plate (T166).** Everything on card art renders `ArtBadge`, which
  adds `.art-badge`: the scrim, extra-small text at 700 with tabular
  numerals, a pill, `--shadow-raised`, one padding, and a 1.25rem circle when
  icon-only. `data-corner` pins it at one inset, `--space-1-5`, and a corner
  cluster (`.collection-grid-corner`, `.deck-card-grid-badges`) pins at the
  same inset. `tone` picks from the scrim tone set. A family keeps only what
  is its own: a set code's mono uppercase, the owned-of badge's filled
  warn/err status, a size tier that scales with the card. Never an accent
  fill on art. Guard: `styles/art-badge-plate.test.ts`.
  **Identity marks are the one fill (2026-09-28, user ruling).** A deck,
  cube or binder mark on art (`DeckBadge` / `BinderBadge`
  `placement="art"`, the binder pocket's deck mark and its hover preview)
  is the plate's shape filled with the owner's colour under a light glyph
  (`data-identity="one"`). It says whose card this is, and a colour disc
  says it at 12px, on the card's black frame and on a dimmed pocket. A
  coloured glyph on the scrim was specimened and rejected: a purple deck
  vanished. Several owners have no one colour, so they stay on the scrim
  with its light glyph (`data-identity="many"`), and art never carries the
  count (the tooltip and the accessible name do). A cube that only
  **lists** the card holds no copy, so its mark is hollow, not filled: the
  scrim and its light glyph with a dashed ring in the cube's violet
  (`data-identity="listed"`, E503). The glyph stays light, so it reads where a
  purple glyph did not. Rows keep the tinted chip. Guard:
  `styles/identity-mark-plate.test.ts`.
- **Rarity as standalone text uses the ink tokens (E151), never literals or
  the chip palette.** On a themed surface (the card tooltip):
  `--rarity-{mythic,rare,uncommon}-ink` — deep inks on paper, auto-flipped to
  the pale set on leather by `[data-scheme='dark']`. On an always-dark ground
  (the card-preview panel): the fixed `--rarity-*-ink-dark` set directly (a
  light-theme user's panel is still dark — same reasoning as `--art-scrim-*`).
  Common takes `var(--text-secondary)` in both (neutral metadata, mirroring
  the flat `--rarity-common` glyph tint). The near-black `--rarity-*-text`
  chip inks are for text ON the gradient chip fills only, and the canonical
  fills/`-to` endpoints fail AA as text on paper — don't reach for either.
- **Foil/etched finish treatments are tokens, one recipe each (E153):**
  `--foil-chip-bg`/`--foil-chip-text` and `--etched-chip-bg`/`--etched-chip-text`
  for the FOIL/ETCHED label fills (card-editor finish tags, the tooltip and
  card-preview pill), `--foil-tile-wash` for the translucent overlay marking a
  foil copy's art in grids. Theme-invariant like the rarity palette. Don't
  hand-roll a new foil gradient; `holographic.css`'s rainbow sweep is a
  separate interaction effect by design, not a label recipe.
- **Never trust card art for text contrast.** Anywhere theme-colored text can
  overlap an art backdrop (deck-editor hero, any future art-backed header), the
  scrim under the text's reachable zone must **hold a floor** — a gradient that
  fades to fully `transparent` where text can land will fail AA on bright crops.
  Ruling from the deck hero: horizontal fade keeps ≥30% `--bg` at its weakest
  point plus a bottom-up band under the meta line, and small/secondary text over
  art steps up one token (`--text-muted` → `--text-secondary`). If a floor + one
  token step still isn't enough for a surface, use a blur material
  (`backdrop-filter` panel), not a third gradient tune.
- **Game-canonical colors** (counter gold, etc.) live in the `--mtg-*` block
  (`--mtg-counter-gold`) and are not themed — never hard-code a game-surface hex.
- **Number fields are sized by class, never by a global selector.** The
  rule editors' min/max/count boxes use `.rule-number-input` (6rem,
  `binder-rules-editor.css`); the old `search-controls.css`
  `input[type='number'] { width: 80px }` rule is gone because it silently
  sized every numeric field in the app. A new numeric field picks a width
  on its own class.
- **The solo-playtest table stack is named.** `--z-table-chrome` (900, zones
  tab) · `--z-table-panel` (901, zones panel) · `--z-table-banner` (902,
  resistance banner, card pings) sit between `--z-suggest` and `--z-modal`;
  the table's context menu and floating life panel ride `--z-overlay` (±1 for
  its backdrop and the zone menu popover). `playtest.css` carries no bare
  three-digit z-index. **These tokens order things INSIDE the board, and
  nothing else** — see the body-portal rule below, which is why the takeback
  banner and consent prompt no longer use them, and why `--z-table-consent`
  was removed outright. The
  felt's own chrome lives in a small 1–5 band, with two deliberate
  exceptions: `.playtest-left-dock` at 30, and `.playtest-trackers--corner`
  at 31 above it. **A popover is only ever as high as the stacking context
  it is rendered into** — the life popover is a child of that corner, so at
  the corner's old z-index of 3 it opened underneath the mana column and the
  game log whatever `--z-overlay` said on the popover itself.
- **An overlay portaled to `<body>` must clear `--z-overlay`, whatever the
  table tokens say.** The board is `.playtest-page`, `position: fixed` at
  `--z-overlay` (1100). A node portaled to `<body>` is a _sibling_ of that,
  so the 900-series `--z-table-*` tokens cannot order it — below 1100 it is
  painted under the entire board and is simply invisible. This is the exact
  inverse of the popover rule above: there a high z-index was trapped in a
  low stacking context; here a low z-index sits in the right context and
  means nothing. Five overlays shipped this way and reached production
  invisible (#2056, #2058) — TriggerReminder, HoldBanner, TableSignals and
  both takeback prompts — each measured 100% covered on the deployed site,
  against TableMoments at `--z-overlay` as a visible control. Neither
  failure mode is visible to jsdom, which loads no stylesheets, so both are
  guarded by tests that read the CSS:
  `playtest/components/body-portal-stacking.test.ts` for this rule, which
  fails any body-portaled board overlay whose `position: fixed` rule sits
  below `--z-overlay`.
- **Role ink colors are tokens too.** The four card-role hues (ramp, removal,
  wipe, draw) that tint role chips, curve-phase bars and analysis rows are
  `--role-ink-ramp` / `--role-ink-removal` / `--role-ink-wipe` /
  `--role-ink-draw` in `tokens.css` (fixed, like `--mtg-*` — a role reads
  the same on every guild). `deck-builder-card-list.css` and
  `DeckCurvePhases.css` consume them; a new role surface does too.
- **Mana identity palette — one set of WUBRG colors.** Color-identity fills (the
  five colors + multicolor/colorless/land) come from the canonical
  `--mtg-w` / `--mtg-u` / `--mtg-b` / `--mtg-r` / `--mtg-g` /
  `--mtg-multicolor` / `--mtg-colorless` / `--mtg-land` tokens in
  `styles/tokens.css`. These are MTG-canonical and **not** themed (the same hex in
  light and dark — each pip/swatch carries a `--border` outline so the pale/dark
  ends still read on any surface). Used by the deck mana-base chart
  (`DeckColorBalance`) and the cube color-balance bars/legend. Never hardcode a
  WUBRG hex for a new color-distribution chart — point at these so the app shows
  one palette for five colors. (The mana-font glyph pip `ColorPip` is the right
  marker when you want the _symbol_; for a bar **fill** or a legend swatch that
  must match its bar segment exactly, use the token.)
- **No raw `px`/`rem` font sizes** — use the `--text-*` scale (`--text-xs`,
  `--text-sm`, `--text-base`, …). stylelint enforces this on `src/**/*.css`.
- **Spacing scale:** a 4px-base `--space-*` scale (`--space-1` = 0.25rem …
  `--space-8` = 4rem) lives in the `:root` token block of `styles/tokens.css`,
  with three half steps for dense rows, chips and badges: `--space-0-5` (2px),
  `--space-1-5` (6px), `--space-2-5` (10px). New code uses these tokens for
  `margin`/`padding`/`gap` instead of freehand rems. The half steps exist
  because the ~1,900 freehand lengths the 2026-09-27 audit counted clustered at
  6.4, 4.8, 9.6 and 2.4px: the scale had no step where dense UI needs one.
- **Snapping legacy values, one stylesheet at a time (T157).** A stylesheet's
  freehand spacing snaps to the nearest step in one change, then its
  `layout-ratchet.baseline.json` count is lowered so it cannot drift back.
  Snapping by script is fine when every shift is 2px or less; a larger shift
  gets a look on screen first and a line in the PR. Never hardcode a new
  spacing rem that matches a scale step; write `var(--space-N)`.
- **There is no 20px step; chrome pads `--space-5` (T157).** The last ~40
  freehand values were almost all 20px (`1.25rem`), and most were dialog and
  panel chrome at 20 × 24. Checked on screen at 390 and 1280, they now pad
  `--space-5` on every side, the way `.choice-dialog` already did; the modal
  footer stays `--space-4` × `--space-5`. Section gaps, list indents and the
  scrim fade over tile art take `--space-5` too. A 20px step was considered
  and not added: no site needed 20 over 24 once it was seen.
- **A length that clears another element is derived from it, never snapped
  (T157).** Room reserved for a ⋮, a reveal toggle, the Scan button or a
  fixed bar is `calc(<that element's size> + <gap>)`, with the size in one
  custom property both rules read (`--menu-btn`, `--reveal-size`,
  `--scan-fab-size`). The literals these replaced were sized for the mouse
  and let text run 8–16px under the 44px coarse-pointer version of the same
  button. `styles/menu-button-clearance.test.ts` and
  `styles/auth-touch-targets.test.ts` hold the two list and field cases.
- **Something sized by its text is never cleared; it goes in the flow
  (E502).** A label as wide as a username has no size to derive a clearance
  from, so no reserved pad fits it. Lay it out as part of the row, on its
  own line when the row is narrow, instead of positioning it over text. The
  stack panel's text-bar rows are the case: a 4.25rem pad cleared
  "A player" and every real seat name ran over the card name
  (`styles/stack-panel-seat-chip.test.ts`).

## Responsive

### Device tiers (what to build + test against)

There are **two viewport tier boundaries** — **600px** and **1024px** — and the
code is supposed to use only those. It doesn't yet: the 2026-09-24 count (T135)
found 63 media queries in 37 files keyed to other widths (480, 640, 700, 720,
380, …). `styles/layout-ratchet.test.ts` freezes that per file, so no file gains
one, and a file that sheds one must lower its baseline. A component that needs
its own threshold should ask its container (`@container`), which the ratchet
does not count. Everything else is refinement _within_ a tier, not a tier wall. "XL desktop" is **not** a breakpoint: it's where
content hits its `max-width` cap and centers with side gutters (`--analysis-max:
1320px` for deck-analysis boards, `--page-max: 1400px` for page containers).

| Tier           | Viewport range | Test at (px)                    | What defines it                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mobile**     | `≤ 600`        | **320** · 375 · 414 · 480 · 600 | base styles; phone layouts, bottom sheets. **320 = hard no-overflow floor.** 480 = cramped-phone refinement.                                                                                                                                                                                                                                                             |
| **Tablet**     | `601 – 1023`   | 640 · 768 · 820 · 1023          | the gap between the two poles. 640 = deck-bento 2-col **container**-query trigger (not viewport).                                                                                                                                                                                                                                                                        |
| **Desktop**    | `1024 – 1399`  | **1024** · 1101 · 1280          | sticky panels, multi-column, deck card inspector (`≥1024`). 1101 = deck-editor layout shift.                                                                                                                                                                                                                                                                             |
| **XL desktop** | `≥ 1400`       | 1440 · 1920                     | content **stops growing** and centers: deck-analysis caps at `--analysis-max` (1320), pages at `--page-max` (1400), and the card-grid routes (collection hub, decks index, deck editor) at `--page-max-wide` (1920) via the `.app-shell:has(…)` opt-in in base-layout.css. Test for balanced gutters / no dead space, not a reflow; the wide routes also at 1920 · 2560. |

- **The two real breakpoints:** `max-width: 600px` (mobile) and `min-width: 1024px`
  (desktop). Use **600**, not 599 — the codebase tolerates the 1px overlap with
  `min-width: 600px` rules. Tablet is the implied `601–1023` gap.
- **Legacy refinement widths** — **480** (tight phone), **640** (early tablet),
  **700** (Cost/Optimize/Substitution panels), **1101** (deck editor) — are
  existing debt, not a menu. The ratchet counts every viewport width that isn't
  a tier boundary, so a new `@media` at 480 fails the gate the same as one at 517. Snap to 600 / 1024, or gate on the container (640 stays legitimate as a
  **container** threshold for the bento; see below).
- **Container queries ≠ viewport.** The deck bento (`.deck-bento`,
  `container-type: inline-size`) reflows on its **own** width at `640` / `1040`
  container px — independent of viewport tier. This is why a half-width panel on a
  wide tablet can look cramped even though the _viewport_ is "desktop": tune the
  **container** threshold, not a viewport media query.
- **Bento panel CSS gates on `@container`, never viewport width (E61).** A
  panel that can render in a half-width box — a `.deck-stats-pair` cell, the
  compare page's `.deck-compare-col`, the CoachFeed — must gate its compact
  layout on an unnamed `@container (max-width: …)` query; a `@media
(max-width: 600px)` rule never fires in a ~300–500px cell on a tablet. The
  query containers are provided by scaffolding (`.deck-stats-pair > *`,
  `.deck-compare-col`, `.coach-feed` are all `container-type: inline-size`).
  Tiers: **26rem** = pair-cell compact (spacing/rail tightening), **22rem** =
  near the 18rem pair floor (structural collapse, e.g. BracketBreakdown's
  1-col stack), **36rem** = "was 600px viewport" equivalence for full-width
  feeds (NextBestMove). Snap to these before inventing new ones. Device-
  capability queries (`pointer: coarse` 44px targets, `hover`, reduced-motion)
  stay `@media` — they're about the device, not the box. Full-width panels
  (`--wide`, hero cards) may keep viewport gates: their box tracks the
  viewport anyway. Floating UI inside any panel must portal to `<body>`
  (`container-type` traps `position: fixed` — see Popovers).
- **A lone full-width bento child needs `grid-column: 1 / -1`.** The bento's
  2-col template uses **explicit** tracks (`repeat(2, minmax(0,1fr))`), so an
  unspanned single child sits in column 1 at half width beside a dead column
  (this shipped: the Tune tab's CoachFeed). `.deck-stats-pair`'s `auto-fit`
  orphan guard collapses empty tracks; the bento grid itself does not.
- **Every `.deck-bento` mount declares a `bento-host` ancestor container
  (E157/E158).** An element can never match a container query against its own
  `container-type`, so the board-level 640/1040 column rules
  (`deck-builder-analysis.css`) query the **wrapper's** `bento-host` name,
  not the bento's own `bento` name (which stays for the bento's _children_ —
  PowerHero, the identity-card pillars — whose queries measure the board).
  Hosts: `.deck-analysis-view` (Stats/Power/Tune share it),
  `.pods-index-section`, `.trending-rail` (`/home` stopped being a bento
  in T138, [§ Home](style-guide/app-shell.md#home--the-page-reads-as-questions-not-a-board-2026-09-24-t138)). A new surface mounting a
  `.deck-bento` MUST add `container: bento-host / inline-size` on its
  wrapper, or every card renders full-width at every viewport (the E157
  "empty dashboard" bug). Two invariants that keep the deck tabs stable
  under the live 2-col template: every top-level board child on Stats/Power/
  Tune spans `1 / -1` (heroes via their own rule or the revived
  `.deck-analysis-slot` wrapper class, `--wide` panels, `.deck-stats-pair`
  rows) — a NEW non-spanning direct child there will genuinely pair into
  half-width cells, so it must be cell-ready or spanned; and a hero whose
  span rule lives on the component root needs the **grid item** (any wrapper
  div) to carry the span — `grid-column` one level below the grid is inert
  (the DeckIdentityCard cascade-wrapper trap).
- **Width caps:** `--page-max: 1400px` (page containers), `--analysis-max: 1320px`
  (deck-analysis boards) — both `margin-inline: auto`. These define the XL tier.
  Card-grid routes widen to `--page-max-wide: 1920px` by overriding `--page-max`
  on `.app-shell:has(<route root class>)` (base-layout.css). **The header does
  not follow the page**: `.site-header-inner` sits on its own `--header-max`
  (1400px) rail that no route overrides, so the brand, nav and account menu
  are in the same place on every route and at every width — a widened page
  grows past the header's edges, not the other way round (guard:
  `styles/header-fixed-rail.test.ts`). Opt a route in only when its content
  is an auto-fill grid or a width-derived column layout; prose and form
  routes stay at 1400, and nothing goes uncapped — past ~1920 density hurts
  scanning and browser zoom serves the reader better than a wider app.

### Other responsive rules

- **44px touch targets** on coarse pointers for anything tappable. The
  mechanism is an explicit `@media (pointer: coarse) { .my-btn { min-height: 44px } }`
  block, separate from the resting style — a button's desktop-density height
  (~2rem) cannot be assumed to meet the floor. **The shared control classes
  carry the floor themselves:** `.btn` (#1931), `.pill-btn` (#2239),
  `.toolbar-pill`, `.tab` and `.search-pill` declare it in their base
  stylesheet, guarded by `styles/shared-control-floors.test.ts`, so a `Button`
  needs no local block. A bespoke control class still needs its own, scoped to
  the selector that identifies it (don't assume a sibling rule already covers
  it). For a small ✕/clear button inside
  a chip where growing it would distort the chip, expand the hit area with a
  centered `::after` ghost (`position: absolute; width/height: 44px;
transform: translate(-50%, -50%)` on a `position: relative` parent) rather
  than inflating the visible control — reference `.set-filter-chip-x`.
- **⚠️ `min-height` does nothing on `display: inline`** — the trap that made
  this floor silently inert on every `<a class="btn">`. **FIXED AT THE ROOT:
  `.btn` now declares `display: inline-flex` (+ centering) in `tabs.css`**, so
  a floor on an anchor lands like it does on a `<button>`. History, because the
  diagnosis generalises: `.btn` used to set no `display`, so a real `<button>`
  computed `inline-block` (floor worked) while the 34 call sites styling a
  react-router `<Link>` computed `inline` (floor inert). `/trades`' empty-state
  CTA measured **29px** with `min-height: 44px` correctly applied (#1532).
  Worse, it hid at the widths you check first: an ancestor that blockifies the
  element masks it, and `.empty-state` only becomes a flex column below 1024px
  — so the floor "worked" at 320–1024 and was dead above. **When a floor
  doesn't take, read the computed `display`, not just `min-height`** — and note
  that a wrapper is the wrong box too: sizing `.search-pill` left its `input`
  at 31px inside a 44px pill (#1538).
- **Superseded ruling: `.btn` no longer stays desktop-density on touch.** It
  used to measure 32px (≥768px) / 36px (≤600px) on a coarse pointer by
  decision, with only rows that commit a state change taking 44px
  (`.choice-dialog-actions .btn`, `.pods-invited-actions .btn`,
  `.trade-offer-actions .btn`, `.trade-accept-actions .btn`, and
  `.empty-state .btn`). #1931 moved the floor onto `.btn` itself after the
  playtest sweep measured 42 of 43 `.btn` on /you at 41px, and #2239 did the
  same for `.pill-btn`. Every shared control is 44px on a coarse pointer now;
  those per-surface selectors restate the base rule.
- **In a dense list row, NO control may take the 44px on its own box — every
  one of them ghosts.** A row is `display: flex; align-items: center`, so a
  child with `min-height: 44px` sets the **row's** height. One un-ghosted
  control therefore inflates every row in the list: the deck list's `⋮`
  (`.deck-row-menu-trigger`) did exactly this and rendered ~50px rows for a
  single ~20px line of text — 30px of dead space per row, 10 rows visible at
  360px where 15 fit (#1466). Its two row-siblings
  (`.deck-row-select-check`, `.deck-row-drag-handle`) were already ghosted;
  the odd one out is what you're looking for. **Cap the ghost's `height` at
  the row's own coarse `min-height`, not 44px** — once rows are ~36px, two
  vertically adjacent 44px ghosts overlap and the later DOM sibling wins, so
  tapping the top of one row's control fires the **row above's**. Ghost
  `width` can stay 44px (no horizontal neighbour).
- **When the row itself is the tap target, the row carries the floor —
  at 36px, not 44.** `.deck-row` is `role="button"` (opens the card preview),
  so the floor belongs on `.deck-row`, not on whichever child happens to be
  tallest. 36 rather than 44 because the row is full-width: height is the
  axis with slack, and a 100-card decklist is a density surface, not a
  settings menu. Reserve the full 44 for free-standing controls and
  popover/menu rows (`.deck-row-menu-item` keeps 44).
- **`styles/overlay-containment.test.ts` guards a named list of controls that
  must reach 44px on coarse.** When one converts to the ghost pattern, point
  its entry at the pseudo-element (`.deck-row-menu-trigger::after`) — the
  guard's matcher keys on `selector {`, so the base selector's entry goes red.
  The floor stays enforced, just on the ghost.
- **Verifying any of this needs real touch emulation, not just a narrow
  viewport.** A headless shot at 360px still reports `pointer: fine`, so every
  `@media (pointer: coarse)` block is invisible and the shot looks like a
  valid phone check while proving nothing. `.claude/tools/shoot.mjs --touch`
  sets `isMobile`/`hasTouch`; that gap is why #1466 survived earlier passes.
- **No horizontal overflow at 320px** (the hard floor).
- **Both themes on every tier** — light and dark are independent surfaces.

#### Cross-device primitive rulings (guarded — `styles/responsive-primitives.test.ts`)

The E68 overhaul codified these into a CSS guard test (CSS isn't typecheck/CI
gated, so the test is what holds the line — mirror of `radius-tokens.test.ts`):

- **Hover visual rules must be gated `@media (hover: hover) and (pointer: fine)`,
  never bare `(hover: hover)`.** Samsung WebViews report `hover: hover` on touch,
  so a bare-gated `:hover` that changes background/color/shadow/border sticks
  after a tap (reads as permanently active/open). Cursor-only `(hover: hover)`
  blocks (no `:hover` selector) are exempt.
- **No fixed `width` on a bare global `input[type='text']`.** It caps every text
  input app-wide and fights the SearchPill flex layout → truncated placeholder /
  horizontal scroll on Android WebView. Width belongs to the flex/grid context
  or a scoped form-field selector. The SearchPill input keeps `min-width: 0` so
  it shrinks to fit the pill.
- **Filter/control strips wrap, never clip** — `.collection-toolbar-row` (and
  peers) carry `flex-wrap: wrap`; never force `nowrap` on a strip that can
  exceed the viewport (collapse to a `⋮` overflow menu at `≤600px` instead).
- **A `SearchPill` dropped into a `flex-direction: column` parent must be
  pinned `flex: 0 0 auto`** (or kept out of the flex context entirely). Its
  `flex: 1 1 12rem` is a _width_ basis for horizontal toolbars; on a column's
  vertical main axis that 12rem becomes a **height** and the pill inflates into
  a ~192px-tall ellipse. This has bitten four times — the deck builder's
  Scryfall tab, the avatar picker, and the playtest zone viewer. The shared
  sheet header (`.card-picker-header > .search-pill`) now pins it for every
  sheet on that shell; new column hosts outside it still have to.

- **Card rows size off their container, never off `vw`.** A row of N cards
  inside a sheet must compute its card width as a share of the container
  (`calc((100% - (n - 1) * gap) / n)`) — a `vw`-based `clamp()` is measuring
  something the sheet isn't, so at any width where the two disagree the row
  overflows and the cards past the edge are simply gone. `.playtest-opening-cards`
  is the reference implementation; it wraps to rows of 4 below 600px rather than
  shrink seven cards into slivers.

- **Verify a shared control's coarse floor in EVERY density it renders in** (grid
  tile, list row, compact row). `.card-edit-btn` (`CardRowMenu`) measured 20×20 in
  list view while grid view was clean; `.slot-deck-badge` measured 12×12 on binder
  pages. Both now carry ghosts and sit in the `overlay-containment.test.ts` allowlist,
  which proves the convention; `.claude/tools/audit-matrix.mjs` measures the boxes.
- **`.btn`, `.pill-btn` and `.toolbar-pill` are on the floor at their base**
  (above). The bulk-select toolbar's Delete/Move/Mark actions
  (`.card-list-bulk-toolbar .toolbar-pill`) were floored locally in sweep-3,
  before `.toolbar-pill` carried it.

## Accessibility

- **Every interactive element with a `:hover` rule also needs a `:focus-visible`
  ring.** These are independent obligations: the hover-gate
  (`@media (hover: hover) and (pointer: fine)`) makes hover conditional on
  pointer capability; `:focus-visible` is unconditional and serves keyboard and
  switch-access users on any device. Writing the gate and forgetting the ring
  was the single most common accessibility gap across the app — it appeared on
  every one of the 20 views in the UX-cohesion sweep. The minimum:

  ```css
  .your-element:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```

  `focus-visible-rings.test.ts` enforces this (subset-coverage aware, with a
  short justified allowlist for base-class-covered variants). Its keyword
  list gained `card` in the sweep-3 remediation — that one word surfaced 26
  latent keyboard-invisible tiles/rows app-wide, so when naming a new
  interactive class, prefer a keyword the guard already knows. **Known blind
  spot:** the guard pairs rings against `:hover`, so a control with _neither_
  hover nor focus-visible is invisible to it (bit the playtest zones drawer);
  a control with no hover still needs its ring.

- **Icon-only controls carry a hover treatment like their row siblings.** A
  stepper `+`/`−` or remove `×` has no text affordance at rest; one control
  in a row with hover feedback and its sibling without reads as "this one is
  broken". `outline-offset: 2px` is the ring default — a tighter 1px is only
  for a control whose ring would clip a flush neighbour, stated in a comment
  at the declaration.

- **`outline: none` inside a `:focus-visible` block is invalid.** A block that
  sets `outline: none` and relies only on a border-color or background shift
  does not meet WCAG 2.4.11's visible-ring requirement. The `outline` property
  is the mechanism — keep it.
- **On an always-dark surface, use a white ring**
  (`outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px`) rather
  than `--accent`, which can read poorly on a near-black background. This is
  the multiplayer **game board's per-seat `.player-panel`** and everything
  rendered inside its rotated covers (`.seat-menu`, `.pp-counters-cover`,
  `.life-keypad`) plus the seam-anchored `.game-board-menu-btn` /
  `.game-board-undo-btn` — all of these paint a fixed dark gradient/near-black
  fill (`--pp-base`/`--pp-edge` or a literal `rgba(14, 17, 24, …)`)
  independent of the app theme. **It does NOT include the solo Playtest
  board** (`/decks/:id/playtest`) — `.playtest-battlefield` and every sheet
  layered on it (`card-picker-sheet`, the context menu, zone viewer, token
  creator, life-adjust popover) use the normal themed tokens (`--bg`,
  `--surface`, `--surface-raised`) and render light in azorius, dark in
  dimir, same as any other page. A white ring there is invisible-to-poor
  contrast in every light scheme — use the standard accent ring. (This
  correction followed a screenshot check after a sweep had assumed both
  boards were always-dark and shipped 18 white rings across `playtest.css`
  - 3 co-located component stylesheets that were only ever verified in dark
    theme.) The hub's `.board-sheet` sheets (Dice, Players, Settings, History,
    Help, Leave) are also themed, not always-dark, and correctly keep the
    accent ring — don't "fix" them back to white. The ring's keys and dock
    are always-dark board chrome and take the white ring.
- **A zone-viewer tile carries one primary action plus an overflow, never a
  stacked destination list.** `ZoneViewerModal`'s card tiles (library,
  graveyard, exile, command) each get exactly one contextual primary button
  ("To hand", or "Cast" from the command zone) plus an `OverflowMenu` kebab
  for every other destination — not six stacked "→ Zone" buttons under every
  card, which reads as a wall of chrome on a 1-card command zone and doesn't
  say "command zone" at all (no tax, no Cast). Library renders top-first (the
  array's own order — index 0 is the top); graveyard and exile render
  most-recent-first (reversed — the reducer appends, so the array's last
  entry is what's physically on top of the pile) with a "Top" badge on the
  first tile either way.
- **In an auth/onboarding form, every button** — submit, OAuth, dismiss/back —
  needs the ring; a ring on one button does not cover its siblings.
- **Read-only validation indicators use `aria-live`, not `role="checkbox"`.**
  Password/username requirement lists are display-only state mirrors. Use
  `<ul aria-live="polite">` with bare `<li>`s whose `aria-label` encodes the
  state (`"At least 10 characters — met"` / `"— not yet met"`). `role="checkbox"`
  is an interactive-widget pattern that tells screen readers the user can toggle
  it — they can't.
- **Single-select option groups use `<fieldset>` + `<input type="radio">`, not
  `role="listbox"`.** Radio inputs provide selection state, arrow-key navigation,
  and group semantics natively, with no ARIA ownership model to maintain. A
  `role="listbox"` whose options are wrapped in `<li>`s breaks the
  owned-elements chain per the ARIA spec. **This extends to two-plus
  checkboxes made mutually exclusive by hand** — an `onChange` that unchecks
  its sibling(s) IS a single-select, however it's coded; model it as radios,
  not independent checkboxes with imperative uncheck logic. A screen reader
  can't infer exclusivity from checkbox semantics, so the checkbox version
  announces "checkbox, not checked" for options the user can't actually
  co-select. (Settled fixing the game-night create dialog's poll-mode /
  repeat-weekly pair, which was two checkboxes standing in for a 3-way
  fixed/poll/weekly choice.)
- **Every `role="combobox"` wires the full ARIA set**: `aria-expanded` +
  `aria-controls` (pointing at the listbox element's `id`) +
  `aria-activedescendant` (naming the currently-highlighted option's `id`,
  driven by the same highlight-index state that drives arrow-key nav) +
  stable per-option `id`s on the listbox children. `aria-autocomplete="list"`
  alone is not enough — without `aria-activedescendant` a screen-reader user
  gets no announcement of which option arrow keys have highlighted. Reference
  implementations: `SetFilterPicker.tsx` and the game-night dialog's Where
  field (`GameNights.tsx`) — both retrofitted from partial ARIA
  (`role`/`aria-expanded`/`aria-autocomplete` only) to the full set with no
  behavior change for mouse/sighted users.
- **44px touch targets** — see § Responsive for the `@media (pointer: coarse)`
  mechanism.
- **The app shell owns the one `<main>`.** `Layout` renders `<main
className="app-main">`; a page inside it never adds another `<main>` (the
  deck editor once did, which axe reports as a nested duplicate landmark).
  Pages rendered _outside_ the shell (`/auth`, `/auth/choose-username`, the
  OAuth landing, share views, public profiles) must supply their own `<main>`
  so nothing sits outside a landmark.
- **A loading skeleton that carries `aria-label="Loading"` needs
  `role="status"`.** A bare `<div aria-label>` is an ARIA error (the label is
  prohibited on a generic element) and screen readers drop it; `role="status"`
  - `aria-busy="true"` is the pattern every skeleton uses.
- **Route-level axe gate.** `pages/a11y.routes.test.tsx` renders every route
  inside the real shell at phone width (390px, coarse pointer) with stores
  seeded and the network guarded, and fails on any axe violation. Only
  `color-contrast` is off (happy-dom computes no styles — contrast is a
  browser-screenshot check). Add a new route there when you add a page; an
  environment-only false positive goes in that route's `allow` list with its
  reason, never a global rule switch.

**Sweep-3 rulings.** (1) Programmatically focused scroll anchors (`scrollToHeading`
targets, the h1 after a route change) are not controls: their default outline is
suppressed by the shared `.scroll-heading-target` rule with the rationale in a comment,
because the scroll is the sighted cue and the announcement still fires. (2) Route
changes update `document.title` and move focus to the new page's `<h1>` from
`LayoutShell`'s pathname effect; the pattern is shared, never per page. (3) A per-row
destructive-action table embedded in a long page keeps one focusable trigger per row (a
menu), not N buttons × rows (the Admin users table injected 30 destructive tab stops
into `/you`). (4) An unmatched route renders "Page not found" inside the Layout with one
CTA, never a silent redirect. (5) A page reached only via a button from its hub (not
itself a hub tab) gets a `BackLink` to that hub, matching its siblings at the same depth
(`/decks/new`, `/decks/new/brew`, `/decks/compare`, `/decks/cube`; `/decks/new/generate` backs to New deck). (6) Social hub pages
share one content cap, the `.social-page-shell` class in `social-shared.css` (640px;
`--wide` is 760px for the trade give/get layout), so a new page can't ship uncapped
(`/pods` did) or a pixel off its siblings (Pods sat 16px left of Friends when each page
hand-wrote its own cap and padding).

- **`role="status"` goes on a wrapper, never on a list.** A loading row of
  skeleton tiles is a `<ul>`, and ARIA does not allow `status` on a list
  element (axe `aria-allowed-role`; `a11y.routes.test.tsx` caught Home's tile
  rows doing it). Wrap the skeleton list in a `<div role="status"
aria-label="Loading" aria-busy="true">` and mark the list itself
  `aria-hidden="true"`.

## CSS file layout

- **`src/styles/` holds the global (unscoped) stylesheets**, imported once in
  `main.tsx` in cascade order. The former 13k-line `global.css` was split into
  feature files — each is a contiguous slice of the original, so the cascade is
  byte-for-byte unchanged. Find rules by feature name: `tokens.css` (the only
  `:root` token block), `base-layout.css`, `import-upload.css`, `forms-banners.css`,
  `binder-hero.css`, `search-controls.css`, `stats-breakdown.css`, `tabs.css`,
  `tooltip-legend.css`, `feedback-spinner.css`,
  `binder-nav.css`, `modals-dialogs.css`, `binder-rules-editor.css`,
  `footer-card-preview.css`, `responsive-nav.css`,
  `collection.css`, `auth.css`, `settings-sync.css`, `binder-card-management.css`,
  `admin-scanner.css`. Each file's header comment lists what's inside. **Import
  order in `main.tsx` is load-bearing** (last-write-wins on equal specificity) —
  add a new global stylesheet in the position its cascade needs, not alphabetically.
- **The former 8.6k-line `deck-builder.css` was also split** into 26 contiguous,
  feature-named `deck-builder-*.css` files (same byte-identical method as
  `global.css`), imported in `main.tsx` in original cascade order. Find rules by
  feature: `deck-builder-page`, `-commander`, `-settings`, `-display`,
  `-card-list`, `-analysis`, `-decks-index`, `-editor`, `-customizer`, `-export`,
  `-card-search`, `-test-hand`, `-combos`, `-tabs` (the shared `<Tabs>`
  primitive), `-combos-list`, `-row-qty`, `-toast` (the global toast viewport),
  `-binder-slot`, `-responsive` (tail-end `@media` overrides), `-import-dialog`,
  `-deck-extras`, `-binders-index`, `-analysis-panel`, `-commander-profile`,
  `-guided`, `-skeleton`. Each file's header lists its content + original line
  range. **This was a pure mechanical slice. Settled ruling: these feature
  slices are the permanent home — the ~9 single-component blocks among them
  (CommanderSearch, DeckCustomizer, DeckTestHandPanel, DeckCombosPanel, etc.)
  are NOT retroactively migrated into `Component.css`.** The split already made
  them discoverable, and co-locating would change cascade order
  (`deck-builder-responsive.css` `@media` overrides target some of those
  selectors) for no real benefit. Co-located `Component.css` remains the rule
  for _new_ per-component stylesheets only.
- **Page-only families load with their page chunk, not in `main.tsx`** (E265,
  2026-09-09 — render-blocking CSS 99 KB → 76 KB gzipped). The play table's
  eight `play-*.css` sheets are imported by `PlayPage.tsx`; `deck-builder-editor`,
  `-test-hand`, `-row-qty`, `-analysis-panel` by `DeckEditorPage.tsx`;
  `-customizer` and `-commander-profile` by `DeckGeneratePage` + `BrewBuildPage`;
  `-combos-list` by the editor + `CollectionCombosPage`; `-import-dialog` by the
  decks index + new-deck + editor; `admin-scanner.css` by `CardScanner`,
  `AdminPage` and `YouPage`; `binder-grid-slots.css` (the binder card grid:
  sections, pages, slots, foil ring) by `BinderView`/`BinderListView`
  (`BinderPage`) and `SharedBinderView` (the `/s/:token` share view);
  `settings-page.css` (the `/settings` + `/admin` page body — sections, rows,
  theme + typeface grid, danger zone, split out of `settings-sync.css`, which
  keeps the header gear link, avatar trigger, sync-status pill and
  mobile-tab-bar dot — app-shell chrome that renders on every route) by
  `YouPage` and `AdminPage`. A sheet is page-local only when **every** chunk
  that renders one of its classes imports it — `css-chunk-ownership.test.ts`
  fails otherwise — and when nothing that stays global overrides its selectors
  by order (a page chunk's sheet loads _after_ everything in `main.tsx`; that is
  why `deck-builder-settings.css` stayed: `deck-builder-responsive.css` wins its
  `.deck-builder-options` phone stack only by coming later). Rules a shared
  component needs from such a sheet move to a global or co-located sheet
  first (`OverflowMenu.css`, the nav game-dot in `responsive-nav.css`, the
  records table in `social-shared.css`). Verify a move with screenshots
  (`.claude/tools/audit-matrix.mjs` before/after, pixel-diffed), never by
  reading. `frontend/scripts/check-boot-budget.mjs` holds the ratchet.
- **Deck components use co-located CSS:** a component in
  `src/components/deck/*` imports its own `./X.css` (e.g.
  `DeckColorPanel.css`), not the central `deck-builder-*.css` files. Shared
  layout/page styles live in the `deck-builder-*` slices; per-component rules
  belong with the component. Because CSS isn't typecheck/lint-gated, a rule put
  in the wrong file renders silently unstyled while CI stays green — verify
  visually or grep the class name.

## Appendices

The core above holds the rules every screen follows. Rulings that belong
to one surface live in an appendix next to this file, in `style-guide/`.
A `STYLE_GUIDE § Name` citation in code still resolves: find the name
below. A new ruling goes where its surface lives; one that every screen
must follow goes in the core.

- **[Shared components](style-guide/components.md)**: Tabs, toolbars, editors, config surfaces, empty states, hints and tooltips: the pieces most screens compose.
  - [Tabs / view switchers](style-guide/components.md#tabs--view-switchers)
  - [Toolbars & action rows (responsive)](style-guide/components.md#toolbars--action-rows-responsive)
  - [Tag chips (E171)](style-guide/components.md#tag-chips-e171)
  - [Rule & filter editors (#1626–#1630)](style-guide/components.md#rule--filter-editors-16261630)
  - [Config surfaces (T139)](style-guide/components.md#config-surfaces-t139)
  - [Index-page insight strips (UX-334)](style-guide/components.md#index-page-insight-strips-ux-334)
  - [Empty states (E182)](style-guide/components.md#empty-states-e182)
  - [Wedge-feature discovery hints](style-guide/components.md#wedge-feature-discovery-hints)
  - [Info tooltips](style-guide/components.md#info-tooltips)
  - [Invalidating-status cue (cancelled, expired, …)](style-guide/components.md#invalidating-status-cue-cancelled-expired-)
- **[Overlays](style-guide/overlays.md)**: Dialogs, sheets, popovers and every other layer above the page.
  - [Overlays](style-guide/overlays.md#overlays)
- **[Charts & meters](style-guide/data-display.md)**: Line, radar and money charts, bars and meters.
  - [Charts (line / trend)](style-guide/data-display.md#charts-line--trend)
  - [Bars & meters](style-guide/data-display.md#bars--meters)
  - [Money deltas & value sparklines (E76)](style-guide/data-display.md#money-deltas--value-sparklines-e76)
  - [Radar / polar charts](style-guide/data-display.md#radar--polar-charts)
- **[App shell & first run](style-guide/app-shell.md)**: The chrome around every page, the landing and welcome screens, Home, You, guest gates and app-wide moments.
  - [App chrome — leather & divider tabs (T53)](style-guide/app-shell.md#app-chrome--leather--divider-tabs-t53)
  - [Page hero art — phones get the art, not a downgrade](style-guide/app-shell.md#page-hero-art--phones-get-the-art-not-a-downgrade)
  - [Home — the page reads as questions, not a board (2026-09-24, T138)](style-guide/app-shell.md#home--the-page-reads-as-questions-not-a-board-2026-09-24-t138)
  - [Brand mark](style-guide/app-shell.md#brand-mark)
  - [Completion moments (the seal)](style-guide/app-shell.md#completion-moments-the-seal)
  - [Full-viewport centered pages (scroll, don't clip)](style-guide/app-shell.md#full-viewport-centered-pages-scroll-dont-clip)
  - [First-run welcome / landing screen (UX-331, pass 2c "welcome storefront")](style-guide/app-shell.md#first-run-welcome--landing-screen-ux-331-pass-2c-welcome-storefront)
  - [Guest gates — every "Sign in" door carries `returnTo`](style-guide/app-shell.md#guest-gates--every-sign-in-door-carries-returnto)
  - [The You page — one page, one name, precise doors](style-guide/app-shell.md#the-you-page--one-page-one-name-precise-doors)
  - [Command palette (⌘K) — desktop-only by design](style-guide/app-shell.md#command-palette-k--desktop-only-by-design)
  - [Keyboard shortcuts — discoverability pattern (UX-334)](style-guide/app-shell.md#keyboard-shortcuts--discoverability-pattern-ux-334)
- **[Cards, collection & binders](style-guide/cards-collection.md)**: Card rows and tables, the collection hub, binders, import review and card-level terminology.
  - [Sticky chrome stacks (collection hub)](style-guide/cards-collection.md#sticky-chrome-stacks-collection-hub)
  - [The card table — one row, one column vocabulary, four surfaces](style-guide/cards-collection.md#the-card-table--one-row-one-column-vocabulary-four-surfaces)
  - [Collection search hands off to Add cards (T153 decision C, 2026-09-27)](style-guide/cards-collection.md#collection-search-hands-off-to-add-cards-t153-decision-c-2026-09-27)
  - [Card-name chips](style-guide/cards-collection.md#card-name-chips)
  - [Printed names: sort and label by what the card says (2026-09-24)](style-guide/cards-collection.md#printed-names-sort-and-label-by-what-the-card-says-2026-09-24)
  - [Binder pages — a page labels itself; a header never repeats it](style-guide/cards-collection.md#binder-pages--a-page-labels-itself-a-header-never-repeats-it)
  - [Color pip rows — AND/OR match-mode chip](style-guide/cards-collection.md#color-pip-rows--andor-match-mode-chip)
  - [Manual price-override badge (E204)](style-guide/cards-collection.md#manual-price-override-badge-e204)
  - [Symbol key / Legend](style-guide/cards-collection.md#symbol-key--legend)
  - [Import review surface (E130)](style-guide/cards-collection.md#import-review-surface-e130)
  - [Card row information hierarchy](style-guide/cards-collection.md#card-row-information-hierarchy)
  - [Card-stat terminology (mana value / mana cost / price)](style-guide/cards-collection.md#card-stat-terminology-mana-value--mana-cost--price)
  - [Binder flipbook — one page per slide (2026-09-07 ruling)](style-guide/cards-collection.md#binder-flipbook--one-page-per-slide-2026-09-07-ruling)
  - [Checklist grids — owned vs missing (E131)](style-guide/cards-collection.md#checklist-grids--owned-vs-missing-e131)
- **[Decks](style-guide/decks.md)**: The deck view, analysis, bracket, Coach, upgrades, deck lists and AI-written content.
  - [Blend controls — N axes that must always sum to 1 (E234)](style-guide/decks.md#blend-controls--n-axes-that-must-always-sum-to-1-e234)
  - [Build-time coach strip (E169 Half B) — a NAVIGATING insight strip](style-guide/decks.md#build-time-coach-strip-e169-half-b--a-navigating-insight-strip)
  - [Upgrade plan (E458, v2 E467, 2026-09-27)](style-guide/decks.md#upgrade-plan-e458-v2-e467-2026-09-27)
  - [Deck view — one fact, one place (2026-09-08)](style-guide/decks.md#deck-view--one-fact-one-place-2026-09-08)
  - [Deck list on a wide screen (2026-09-19)](style-guide/decks.md#deck-list-on-a-wide-screen-2026-09-19)
  - [Deck diff rows (T22/E173)](style-guide/decks.md#deck-diff-rows-t22e173)
  - [Comparing two of anything (2026-09-15)](style-guide/decks.md#comparing-two-of-anything-2026-09-15)
  - [Verdict badges](style-guide/decks.md#verdict-badges)
  - [Ranked coverage rows (E283)](style-guide/decks.md#ranked-coverage-rows-e283)
  - [Deck analysis tabs — first-impression states](style-guide/decks.md#deck-analysis-tabs--first-impression-states)
  - [One scoring vocabulary (UX-315)](style-guide/decks.md#one-scoring-vocabulary-ux-315)
  - [Bracket: the owner's word, the Estimate is computed (2026-09-24 ruling)](style-guide/decks.md#bracket-the-owners-word-the-estimate-is-computed-2026-09-24-ruling)
  - [Deck-analysis band words](style-guide/decks.md#deck-analysis-band-words)
  - [Suggestion feeds (Coach tab — UX-401)](style-guide/decks.md#suggestion-feeds-coach-tab--ux-401)
  - [AI-written content (T96, extended T102)](style-guide/decks.md#ai-written-content-t96-extended-t102)
- **[Play, playtest & the table](style-guide/play-table.md)**: The playtest table, the online table, Horde and the life-counter play board.
  - [The card back is the real one (2026-09-20 ruling)](style-guide/play-table.md#the-card-back-is-the-real-one-2026-09-20-ruling)
  - [Playtest ↔ online table: one linkage rule (2026-09-20 ruling)](style-guide/play-table.md#playtest--online-table-one-linkage-rule-2026-09-20-ruling)
  - [The table's keyboard map (2026-09-20 ruling)](style-guide/play-table.md#the-tables-keyboard-map-2026-09-20-ruling)
  - [Table signals — ring, point, arrow (2026-09-20 ruling)](style-guide/play-table.md#table-signals--ring-point-arrow-2026-09-20-ruling)
  - [Card corner ribbons — state on the left, identity on the right (2026-09-20 ruling)](style-guide/play-table.md#card-corner-ribbons--state-on-the-left-identity-on-the-right-2026-09-20-ruling)
  - [Horde table (Local Horde, 2026-09-24)](style-guide/play-table.md#horde-table-local-horde-2026-09-24)
  - [Play board — a state mark carries its own control (2026-09-15)](style-guide/play-table.md#play-board--a-state-mark-carries-its-own-control-2026-09-15)
  - [Play board: legible across the table (2026-09-24)](style-guide/play-table.md#play-board-legible-across-the-table-2026-09-24)
  - [Play board: a seat is all number (2026-09-24)](style-guide/play-table.md#play-board-a-seat-is-all-number-2026-09-24)
  - [Play board: 7-10 players, and seat order is clockwise (2026-09-24)](style-guide/play-table.md#play-board-7-10-players-and-seat-order-is-clockwise-2026-09-24)
  - [Play board: the hub ring and its table moments (2026-09-24)](style-guide/play-table.md#play-board-the-hub-ring-and-its-table-moments-2026-09-24)
  - [Play board: the hub ring's keys, dock and sheets (2026-09-26, T155)](style-guide/play-table.md#play-board-the-hub-rings-keys-dock-and-sheets-2026-09-26-t155)
  - [Play board: the table clock is pausable and optional at setup (2026-09-24)](style-guide/play-table.md#play-board-the-table-clock-is-pausable-and-optional-at-setup-2026-09-24)
  - [Play board: the table clock is an edge strip, not a seam satellite (2026-09-24)](style-guide/play-table.md#play-board-the-table-clock-is-an-edge-strip-not-a-seam-satellite-2026-09-24)
  - [Play board: the remaining Lotus settings, and counterclockwise seating (2026-09-24)](style-guide/play-table.md#play-board-the-remaining-lotus-settings-and-counterclockwise-seating-2026-09-24)
  - [Play board: landscape keeps the board still (2026-09-25)](style-guide/play-table.md#play-board-landscape-keeps-the-board-still-2026-09-25)
  - [Play board: the life keypad is a board-level dialog, and the commander-damage focus bar keeps its full copy (2026-09-25)](style-guide/play-table.md#play-board-the-life-keypad-is-a-board-level-dialog-and-the-commander-damage-focus-bar-keeps-its-full-copy-2026-09-25)
  - [Play board: a short seat's drawer is one scrolling row (2026-09-26)](style-guide/play-table.md#play-board-a-short-seats-drawer-is-one-scrolling-row-2026-09-26)
  - [Play board: the board sizes off itself, and every mark fits its seat (2026-09-26)](style-guide/play-table.md#play-board-the-board-sizes-off-itself-and-every-mark-fits-its-seat-2026-09-26)
- **[Sharing & social](style-guide/social.md)**: Public shared views, discovery tiles and trades.
  - [Trade offer rows (T120)](style-guide/social.md#trade-offer-rows-t120)
  - [Public shared views (/s/:token)](style-guide/social.md#public-shared-views-stoken)
  - [Discover deck tiles (art-banner, tile system v2)](style-guide/social.md#discover-deck-tiles-art-banner-tile-system-v2)

---

## Extending this guide

When you and a reviewer settle a recurring visual question ("should X be a pill?",
"which radius?", "where does this overlay live?"), add the ruling here in a
sentence or two. Keep entries short and prescriptive — a rule, the rationale if
it's non-obvious, and the anti-pattern it prevents. This doc is only useful if it
stays current, so prefer editing it over re-deciding.

---
