# Style guide: Overlays

Dialogs, sheets, popovers and every other layer above the page. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, color and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## Overlays

- **Multi-destination exports/shares are one labeled menu trigger**, never
  one button per destination — see [§ Toolbars & action rows](components.md#toolbars--action-rows-responsive) → Card action
  rows for the full rule. It's binding on any surface, not just card footers.
- On-demand panels that shouldn't live inline (Add cards, Test hand) use the
  shared **card-picker** pattern: `.card-picker-root` + `.card-picker-sheet` —
  a **bottom sheet on mobile, centered modal ≥1024px**. Dismiss via backdrop
  tap, a close button, and `Esc`.
- **A sheet's middle is ONE scroll region — header and footer are chrome.**
  When a card-picker sheet stacks several content blocks between its header
  and footer (an AI slot, a ranked list, a reveal-more section), they live in
  a single `flex: 1 1 auto; min-height: 0; overflow-y: auto` body, never as
  sibling flex children with individual caps and scrollbars. Per-child caps
  turn into flex-shrink arithmetic that either guillotines a fixed-height
  child or overruns the sheet with content nothing can scroll to — both
  shipped on `DeckSizePrompt` (the 49px AI strip rendered 37.8px; then an
  expanded verdict + expanded list pushed rows and buttons past the sheet
  edge with no scrollbar anywhere, the "can't scroll down" report,
  2026-08-18). `DeckSizePrompt.css`'s `.deck-size-prompt-body` is the
  reference. Give chrome (`.card-picker-header`/`-footer`) `flex-shrink: 0`.
- **A dense desktop dialog widens past the phone default.** The shell's
  ≥1024px modal is `width: 480px` — right for a short confirm, cramped for a
  working dialog (AI prose + candidate rows). Override per-sheet with a
  two-class rule (`.card-picker-sheet.deck-size-prompt { width: min(42rem,
calc(100vw - 4rem)) }`) — the two-class form outweighs the shell rule
  regardless of import order, same cascade rule as the Home bento overrides.
  Swept fleet-wide 2026-08-19; the current widths, for consistency when
  adding a sibling: Add cards 1180 · Test hand 1180 · CardGroup 960 ·
  NewArrivals / PullList 720 · ConflictPanel 720 · DeckSizePrompt /
  CardFitPanel 42rem ·
  BuildReport / DeckTokens 640 · BuyList / DeckPrimer
  ≈560. A new overlay whose body is rows, a diff, images, or anything you
  _work in_ picks from this table — it does not ship on the 480px default.
  Playtest's sheets are on it too: opening hand 1180 · zone viewer 900 ·
  scry 720 · token creator 640 · stats 600; its three short pickers
  (designations, life adjust, takeback mode) stay on the 480px default
  deliberately — that width IS right for a brief exclusive choice.
- **Add cards is a bottom sheet up to 1024px, then a two-pane workbench
  (T153 phase 4, 2026-09-27).** It moved onto `<Modal>` (was a hand-rolled
  `.modal-backdrop` — exit animation, focus trap and topmost-only Escape now
  come from the shared layer). Below 1024px it is a single-column bottom
  sheet: `add-cards-backdrop` extends the shared sheet treatment past the
  primitive's own 600px ceiling up to the tablet boundary, because a
  floating full-height card read wrong at tablet width and the Search tab's
  per-row "Printing & finish" disclosure is the only printing picker there.
  At and above 1024px the Search tab becomes a two-pane workbench —
  `AddCardSearchPanel` (results, 26rem) beside `AddCardInspector` (the
  active row's art, name, type and the shared `PrintingPicker`) — and the
  disclosure hides, since the inspector replaces it. `CardSearchResults`
  drives the inspector via `onActiveChange`, fired on hover and on the
  existing ↑/↓ keyboard nav; `Enter` still adds the active row's own shown
  printing (decision B), unaffected by whatever the inspector's picker has
  selected. Other tabs (Add from list, Products, Scan) are unchanged and use
  the full width at every tier.
- **Every host with its own query input beside `CardSearchResults` (directly,
  or through `InlineCardSearch`'s forwarded ref) wires the same ↑/↓/Enter nav
  through the shared `lib/search/use-results-keys.ts` hook (T159/E457) — `AddCardSearchPanel`,
  `/search`, the list "Add card" sheet, a list's own Scryfall panel, and the
  import review's per-name repair search all use it.** ↑/↓ moves the active
  row, Enter adds its own shown printing (decision B); both pass through
  untouched during IME composition and until a row has actually gone active,
  so a query too short to search yet, or a panel that isn't open, never
  swallows the keys of whatever the host's input does with them otherwise. A
  new host follows this pattern rather than hand-rolling its own keydown
  handler. A lookup page is the one exception: `/search` passes
  `enterNeedsNav: true`, so Enter right after typing (out of habit, before
  any ↑/↓) passes through instead of silently adding `CardSearchResults`'
  row-0 default to the collection — an add flow (the Add cards workbench,
  the list-add hosts) leaves this off, since a type-then-Enter quick add IS
  the point there. With the gate on, nothing is selected until an arrow, so
  the first ↑/↓ selects the top hit in place (`moveActive(0)`) instead of
  skipping past it to row 1; that is the "no automatic selection" combobox
  model, where the add flows use "automatic selection".
- **`CardPreview` is one layout function with two shapes (E421, 2026-09-25).**
  It replaced the 2026-08-18 ruling ("≥1024px is two panes"), which it keeps
  and extends. Every length comes from the viewport (the backdrop is the one
  `container-type: size` box), never from content, so no card can move
  another. This is the #636 stable-frame rule, now structural.
  - **Stacked** (phones, tablet portrait). A top bar holds the position
    ("3 of 50") and the 44px close rect, so nothing sits on the card. The card
    takes the width it needs (capped at 620px), and the **info sheet takes
    whatever height is left, never less than ~188px**. The sheet has three
    stops, peek / half / full. It moves by `transform` over the card (no
    height animation, no track resize) and replaced the Details toggle. Drag
    its handle or tap it to step through the stops; dragging down from peek
    closes. At peek and half a touch drag moves the sheet. At full the content
    scrolls. Tablet portrait is stacked too: the user ruled against two
    columns there because it shrinks a 768px iPad's card to phone size.
  - **Split** (`≥1024px`, or any short landscape screen:
    `(orientation: landscape) and (max-height: 600px)`). The card sits on a
    stage beside a full-height inspector column **on the right**: card, then
    details, the same order as the phone's top-to-bottom, and the convention
    of Scryfall, Moxfield and Archidekt. The header may wrap here because the
    card no longer depends on the panel's height. A short landscape phone gets
    the split too (stacked, it rendered a 100 × 139 card).
  - **One panel, same sections everywhere.** A header (name + price, then mana
    cost, type and P/T; one line each when stacked), the where-it-lives
    context line, and the action row. Below it the sections. The **lead
    section follows the source**: deck → In this deck (`renderPanelMeta`),
    search → the printing picker (`renderPanelExtra`), collection/binder →
    Your copy, playtest → Rules text with Rulings open. After the lead the
    order is fixed: Rules text, Played in, Printing, Rulings, Legalities.
    **Rules text stays in the panel on purpose.** It is how a screen reader
    reads the card, and it carries current Oracle wording. It just doesn't
    lead. Played in, Rulings and Legalities open by default, and the two that
    fetch wait for the card to settle first.
  - **Played in** (`components/card/PlayedInSection.tsx`, E519) lists the
    commanders EDHREC sees the card played under: the card's own rate across
    decks that can play it, the Top commanders (five, then Show all) and New
    commanders, each row reading "In N% of its Nk decks" over a `MeterBar`
    with an Owned marker for the viewer's own collection. A row opens that
    commander in a preview of its own, stacked on this one, whose Build a
    deck action leaves for the generator. It renders nothing when EDHREC has
    no page for the card or the device is offline, a Retry line when the
    fetch fails, and never in the playtest inspector. It ends with View on
    EDHREC (see STYLE_GUIDE § Third-party numbers name their source).
  - **A preview can open a preview.** The one stacked above answers keys and
    Back first (it is the topmost overlay layer), and a `role="presentation"`
    wrapper stops its touch and click events before they reach the sheet
    below, the rule the keyword popover already follows.
  - **Actions are labeled rects on the panel**, never pills floating over the
    scrim. Owner/management actions (`overflow: true`, e.g. Remove from deck)
    go in the row's ⋮. Flip / Turn act on the image, so they sit **on the
    card's art**, which reserves no space on a single-faced card.
  - **The card is inert.** Tapping it never closes the preview: that is the
    gesture a reader makes most, and pinch-zoom starts with it. Empty space
    closes (the backdrop, the stage, the gaps between slides, the top bar), a
    neighbor centers, and on touch a tap on the card lowers a raised sheet.
  - **Neighbors recede under a dark wash only: never opacity, never a
    transform.** A see-through neighbor let the page behind read through it.
    A slide is a scroll-snap target, and `scrollIntoView` and the snap both
    center its transformed box, so the `scale(.94)` #2259 shipped left every
    arrow-key or neighbor-click page turn 17.5px off center (guarded in
    `binder-page-sizing.test.ts` and the journey's centring check). The binder
    page viewer uses the same wash. The backdrop is 90% (the old 60% left a
    field of cards competing with the one being read). In the split the stage
    fades into both edges, so the inspector never slices a neighbor.
- **`CardPreview`'s action row holds one line** (#2252, carried into the
  E421 header row). Callers add their own buttons (binder "Set cover", search
  Add + Printings, a feedback view's Suggest cut), so on a 360px phone the
  labeled row can outgrow the sheet. `CardPreview` measures the fully
  labeled width; when it won't fit it sets `.is-compact`: the universal-glyph
  buttons (Share, Edit, marked `data-compactable`) drop their word, a caller
  action with a `shortLabel` ("Cover") swaps to it, and the gap tightens. Every
  other caller action keeps its words, since an ambiguous glyph never goes
  icon-only. The full label stays the button's `aria-label` and `title`.
  Wrapping is the safety net only.
- **The deck editor's workbench rail is RETIRED (2026-08-19) — don't
  re-add it.** The ≥1280px `.deck-add-rail` docked "Add cards" beside the
  decklist as a 400px sticky column; the user ruled the narrow column made
  the search panel cramped and reverted it. "Add cards" is the card-picker
  sheet/modal at every width, sized as a workspace on desktop
  (`.deck-add-sheet` at `min(92vw, 900px) × 80vh`). Deck-view review
  dialogs follow the dense-dialog ruling above rather than the 480–520px
  phone default: `NewArrivalsSheet` 720px, `BuildReportSheet` 640px.
- **Every card-picker sheet dims the page behind it — by construction.** The
  scrim lives on the shell itself: `:where(.card-picker-root) { background:
var(--overlay-sheet) }` in `binder-card-management.css`. A new sheet on this
  shell needs **no scrim code at all**; `.card-picker-backdrop` (the
  click-to-close child some sheets render) carries no background of its own, so
  nothing double-stacks. To dim **harder** than the default, set the stronger
  token on your scoped root class (`.pull-list-root`, `.deck-tokens-root` →
  `var(--overlay)`) — the shell rule is zero-specificity via `:where()`, so any
  scoped rule wins regardless of import order. (History: the old ruling put the
  scrim on each sheet's scoped root class, and that per-sheet obligation shipped
  missing on E95 #1048, again on E99, a third time on WelcomeDigest #1113, and
  audit of the pattern then found **eight more** latent unscrimmed sheets — so
  #1114 moved the scrim to the shell where it can't be forgotten.
  `src/lib/no-unscrimmed-sheet-roots.test.ts` pins the shell rule and the
  backdrop's background-free invariant.)
- **Destructive confirmations go through the shared `<Modal>`, never
  `window.confirm()`.** The browser dialog can't be themed, freezes the event
  loop, loses focus on dismiss, and renders inconsistently across browsers.
  Use a two-step `<Modal dismissable={!busy}>` with a red confirm
  (reference: `ConfirmDialog.tsx`). Hand-rolled `.modal-backdrop` dialogs are
  also discouraged — route through `<Modal>` so the exit animation, focus-trap,
  and Escape handling come for free (see [§ Motion](../STYLE_GUIDE.md#motion)).
- **An overlay root portals to `<body>`.** A sheet, drawer or dialog root is
  `position: fixed` with a z-index, and both only hold where it renders.
  Inline, it inherits every ancestor's stacking context: "View card tags"
  from a collection grid card opened inside `.collection-grid-cell`
  (`z-index: 0`), so every later card painted over the sheet. The component
  that renders `.card-picker-root`, `.modal-backdrop`, `.stats-drawer-root`,
  the binder page viewer, the deck context menu or the hover peek returns
  `createPortal(…, document.body)`, as `<Modal>` does. The play table and the
  playtest board are exempt: their overlays mount at the top of a
  full-viewport fixed surface, and the board sheets must stay in the rotated
  seat. `src/test/overlay-roots-portal-to-body.test.ts` fails an inline root.
- **An overlay that can't portal still answers Escape.**
  The game board's in-panel covers (seat menu, counters, life keypad), its
  hub sheets and the custom layout editor render in place —
  the seat menu inherits its panel's rotation, the menu rises from the
  board's own edge — so they can't be a `<Modal>`. They use
  `lib/overlays/use-overlay-dismiss.ts` (`useOverlayDismiss(onClose, panelRef)`):
  the same shared layer stack, topmost-only Escape, Tab trap and focus
  restoration, no exit animation. A new in-place overlay
  takes this hook; it never hand-rolls a keydown listener again.
- **A sheet's Escape is `useSheetExit`'s.** The hook closes the sheet on
  Escape through `beginClose`, only while it is the topmost layer and only if
  nothing already `preventDefault`ed the key, so Escape in a menu, picker or
  confirm dialog opened over a sheet closes just that (T147; every sheet used
  to add its own ungated `document` listener, and one press closed both
  layers). A sheet never adds its own Escape listener
  (`use-sheet-exit.escape.test.tsx` fails if it does). Options instead:
  `instantAt` for a layout with no exit keyframe (the card-picker panel's
  desktop `animation: none`), `escape: false` for a sheet that must be
  answered or whose menu layer owns the key. An inner control that handles
  Escape first, like a search field that clears its query, calls
  `preventDefault`.
- **Document key listeners subscribe once; the latest callback lives in a
  ref.** `Modal`, `useSheetExit`, `useEscapeKey`, `useOverlayDismiss` and
  `useMenuKeyboard` all keep `onClose` in a ref and register their
  `keydown` listeners for the component's lifetime. Putting an
  inline callback in the effect deps re-subscribes on every render, and a
  listener swapped out mid-dispatch never fires: the browser runs a
  microtask checkpoint between the listeners of a trusted key event, React
  flushes there, and any earlier Escape listener that re-renders the page
  (the deck editor's resync hint strip) silently ate the Modal's Escape —
  the export dialog and pull list needed two presses (2026-09). Any new
  hook that listens on `document`/`window` follows the ref pattern.
- **Every scroller inside an overlay declares `overscroll-behavior: contain`.**
  `useLockBodyScroll` is not the mechanism it looks like: `body` is _already_
  permanently `overflow: hidden` (`base-layout.css`), so locking it changes
  nothing. `.app-main` is the app's only real scroll region, and its own
  `contain` only stops chaining **out** of it — not delta arriving from a
  descendant. So an overlay list scrolled to its edge hands the leftover swipe
  straight to the page behind the still-open sheet, which reads as "the modal
  doesn't lock the background." Fix it at the scroller, not the body: the
  shared carriers are `.modal-body`, `.card-picker-list`, `.add-card-sheet-body`
  and `.cle`. A new overlay that introduces its own scrolling region declares
  it too. `src/styles/overlay-containment.test.ts` pins the four shared ones.
- **A scroll strip states both axes.** Per the CSS Overflow spec, setting one
  axis to a non-`visible` value computes the _other_ to `auto` — so
  `overflow-x: auto` alone silently creates a two-axis scroller. On
  `.collection-hub-tabs` that combined with the active tab's
  `margin-bottom: -1px` to leave a 1px block-axis scroll range for touch
  momentum to rubber-band against. Write `overflow-y: hidden` explicitly.
- **Back closes the topmost overlay first (E481, 2026-09-28).** Only when
  nothing is open does Back navigate the page — a phone's edge swipe or the
  browser Back button must not leave an open `CardPreview`/sheet/dialog and
  land the user several screens back. **Exactly one press closes an overlay,
  and the very next press genuinely leaves — never a spare press that looks
  like nothing happened either way.** Back goes through the SAME shared
  overlay stack Escape does, never a second mechanism: `useOverlayLayer`'s
  optional second argument (`dismiss`) opts a layer in and reports back
  whether the close was ACCEPTED (a Modal's `dismissable={false}` refuses, so
  it returns `false`; everything else always accepts). `lib/overlays/overlay-history.ts`
  owns the history mechanics — one history entry, same URL, marking the
  CURRENT entry while any opted-in layer is open (a nested open reuses the
  same marked entry rather than pushing another). A Back press first closes
  the topmost layer through its own `dismiss`, and only RE-marks the entry
  if something will still be open afterward — the close was refused, or more
  than one layer was registered (nested). If it was the sole layer and it
  accepted, nothing is re-marked: the entry underneath is a real, unmarked
  page, so the next Back genuinely leaves. Re-marking on refusal specifically
  is what keeps a stuck `dismissable={false}` Modal from silently leaking one
  real navigation step per Back press while it sits there unclosed.
  **Consumption is deliberately lazy — closing any other way (✕, backdrop,
  Escape, an action) never touches `window.history` at all.** An eager
  `history.back()` there raced a same-tick or later-microtask/timeout
  `navigate()` the same action might also trigger (a menu item, a
  delete-then-redirect): the queued traversal could land after the new
  `pushState` and silently undo it. So the marked entry is simply left as the
  current one. Two situations follow, and a naive implementation of either
  one costs an extra press that reads as "nothing happened" — both are made
  transparent instead: (1) the user later backs INTO that entry from
  somewhere else (having navigated away without ever pressing Back, or
  across a full page reload) — `onPopState` recognizes the entry it just
  LANDED on is flagged and skips it forward with one more `history.back()`;
  (2) the user instead backs OFF that entry, landing on the very page it was
  cloned from, which — since marking spreads react-router's own `idx` onto
  the clone — is otherwise indistinguishable from a no-op press. A
  remembered `staleMarkerIdx` (cleared the moment it's consumed, skipped, or
  superseded by a fresh mark, so Forward-then-Back into an unrelated later
  visit to that idx can never misfire) is what makes THAT press also cascade
  one more `history.back()`. `Modal`, `useSheetExit`, `useOverlayDismiss` and
  `CardScanner` wire it, so every Modal dialog, sheet and `CardPreview`
  (built on `useSheetExit`) gets it for free — no per-component history code.
  A narrow, accepted edge case: a Back press that arrives while an overlay's
  own non-Back close is still mid-exit-animation (not yet unregistered) is
  read as a fresh dismiss attempt on that same layer rather than "nothing
  open" — harmless (the guard against double-firing `onClose` still holds),
  but it can occasionally cost one avoidable extra press; fast enough
  double-actions to trigger it are rare.
  **Popover menus (`useMenuKeyboard` — `OverflowMenu`, `SelectMenu`,
  `ToolbarPopover`, `CtxMenuShell`) deliberately do NOT participate.** They
  open and close constantly and their items routinely navigate; a history
  entry per dropdown open isn't worth it, and Escape already closes them the
  same way it always has. Pinned by `src/lib/overlays/overlay-history.test.ts`'s
  numbered "acceptance sequences" (the mechanics, against fake hooks,
  counting presses through all eight of: close-then-leave, ✕-then-leave,
  ✕-then-navigate-then-land-then-leave, two nested closing in order then
  leaving, the non-dismissable re-arm, the close-then-navigate race in both
  same-tick and later-microtask/timeout orderings, a marker surviving a
  reload, and Forward/Back never re-triggering a stale one),
  `src/lib/overlays/overlay-layer.test.tsx`'s "Back-button integration" block (the
  real wiring, incl. nested layers, a StrictMode double-invoke, and the
  non-dismissable case), and `src/components/card/CardPreview.test.tsx`'s
  "Back-button integration" block (a real `BrowserRouter`, proving
  react-router never sees a route change, that a context pill's
  close-and-navigate never triggers a stray back, and the coordinator's
  close→Back→Back and ✕→Back sequences against a real previous page).

**Sweep-3 rulings.** (1) A whole-table, session-ending overlay (the win recap) renders
screen-relative and unrotated, like the ticker's public surfaces, even though it shows
one seat's name and color; per-seat rotation is for ongoing play only. (2) An in-panel
cover whose content can exceed the smallest realistically-full panel (`SeatMenu` in a
2-player game, not only the 6-player seat) carries a scroll-edge fade or a visible
scrollbar; `overflow-y: auto` with `justify-content: center` hides both ends silently.
(3) A `right: 0`-anchored popover clamps so its computed left edge never goes negative;
verify at 320–360px (the deck kebab rendered at `left: -20px`). (4) Shortcut entries
with more than one key state `join: 'alt'` (rendered " / ") or `join: 'chord'`
(rendered "+"); "then" is reserved for a true multi-step sequence, and none exist.
(5) A page resolving an entity by id from a persisted store gates its not-found branch
on the store's `hydrated` flag AND on the sync driver's first pull (`getSyncState() ===
'syncing'`): a fresh device hydrates an empty IndexedDB first and the deck only arrives
with the pull (the deck editor showed "That deck no longer exists" for ~16s).

### Play setup — desktop composes config beside the table

The Local and Online-host setup forms are two-panel at ≥1024px
(`.play-setup-form-grid`): Game + Rules on the left, the Players roster on
the right behind a print hairline, the Start/Create CTA (accent fill +
`Swords`) bottom-right at a content width — never a full-card slab. Below
1024px the stacked phone flow is untouched. Join stays a single focused
column (`.play-setup-form-join`, 36rem) with a large mono code input. Seat
rows show the picked deck's color identity as WUBRG-ordered `ColorPip`s
(`.play-seat-ci`, ≥600px — game information, not decoration). The lobby's
join-code banner is the table ticket: brass edge + `--brand-seal-gold` code

- a Copy button (white focus ring — fixed dark ground). The online seat
  panel (`.ogv-you`) grids at ≥1024px: life numeral display-size left, tools
  rowed right. The Play-tab in-progress dot (`.play-tab-dot`) is a raised
  superscript badge, spaced off the label.

### Game-board panel covers — gestures are panel-local, never screen-local

The multiplayer board rotates each `.player-panel` to face its seat (0 / 90 /
180 / 270), so **screen "up" is not the player's "up."** Any gesture on a seat
panel or on a cover rendered inside it (`.pp-counters-cover`, `.seat-menu`)
resolves direction against that panel's rotation — `useTapAndHold` takes a
`rotation` prop and inverts for 180° seats. A gesture that reads raw `clientY`
works for the bottom seat and is backwards for the top one.

- **A swipe is an accelerator, never the only way in.** Every panel cover keeps
  a visible tap/keyboard affordance — the corner `.pp-counter-chip` opens the
  counters cover for mouse, keyboard, and anyone who never discovers the
  gesture. Swipe-up opens, swipe-down dismisses; `Esc` and a `✕` also dismiss.
- **A swipe-dismissable cover shows a grab handle** (`.pp-counters-grab`) — the
  conventional tell that the surface moves. It is `aria-hidden`; the `✕` beside
  it is the accessible control.
- **Threshold lives in `useTapAndHold`** (40px travel, 1.5:1 vertical dominance)
  and is shared with the tap-cancel path, so a swipe can never also register as
  a life tap. Don't add a second, competing threshold.
- **Anything that identifies another player is tinted in that player's own
  panel color**, resolved the same three ways the panel is: explicit override →
  color identity (`pp-color-*`) → `paletteForSeat` inline vars. Use the
  `seatColorKey` helper rather than re-deriving the override/identity
  precedence.

### Finished tables and lobbies

- **The win recap is the end of the session.** Its actions are **Done**
  (primary: leaves the table — clears a local one, leaves an online one) and
  **Rematch** (re-seats the same players). The result is already in History
  by then, so leaving a finished table never asks for confirmation; only an
  in-progress game's Discard does. Tapping outside the recap still dismisses
  to the final board for anyone who wants to keep looking; the hub dock's
  exit there is "Clear the table", never "Close" (a sheet's ✕ owns that
  name). The recap's dismissal is remembered per game id
  so it doesn't replay on every return to /play.
- **A lobby names what it is waiting for.** Online games start on an
  explicit host action (`start` is host-only server-side): the host sees a
  **Start game** button in the header, everyone else sees "Waiting for
  {host} to start". A bare "Waiting to start" beside a life counter that
  already syncs read as stale state.

### Lobby: sidebar + seat grid

The seated pre-start table (`OnlineLobby`, `.lobby-*`) is its own surface, not
the live board with a Start button in its header. Two regions at >=1024px
(`grid-template-columns: 22rem minmax(0, 1fr)`):

- **Rail** (left): the join-code ticket at the top, then `GAME SETTINGS`, then
  `CHAT`. Small-caps section labels. Every settings row is a real field of
  `GameState` the reducer honors (format, starting life, mulligan, starting
  player, seat order, commander damage, poison, turn timer) — host-editable,
  read-only values for everyone else. **A setting the engine can't honor is
  still not drawn**: a toggle that changes nothing is worse than no toggle.
  That is why there is no sideboard row — nothing in play models one. The
  mulligan rule and the turn timer earned their rows by being wired end to
  end first (`mulliganType` decides the bottom-N count the opening-hand
  takeover asks for; `turnTimerEnabled` drives the readout under the board's
  TURN chip).
- **The join-code ticket has no dismiss control.** It is the one thing a
  host needs to get people seated, so it stays on screen for the life of
  the lobby rather than being collapsible or closeable — a host stranded
  without their own code was a real complaint, not a hypothetical one.
  Keep its help text to one short clause; it does not need to spell out the
  whole join flow.
- **A rule toggle (commander damage, poison, turn timer) is a
  `.lobby-setting` row, not a `SwitchRow`.** The local setup form's own rule
  toggles (`PlayPage`'s Rules section, `HordeSetupFields`' Bosses/Safe zone)
  are `SwitchRow`s with their hint visible, same as every other config
  surface on the kit. The lobby is the one place that shape doesn't fit: its
  own `RuleToggle` matches the plain settings rows above it (Format, Starting
  life, ...) and puts the hint sentence on the control's `title` instead,
  since a full-width row per rule would read as heavier cards next to the
  hint-less rows beside them, not part of the same list.
- **Start puts you at the table.** The board is the online surface; this tab
  is the lobby before a game and the record after one. On the first render
  after a game goes active, a seat that has a deck is sent to
  `/decks/:id/playtest` — once per game, marked in `sessionStorage` so coming
  back to Play does not yank them away again, and skipped entirely when
  storage is blocked (no mark means it would fire on every mount, which is
  worse than never). A seat with no deck stays put, because the prompt it
  needs is here. Landing on a life counter that then offered to "open your
  board" made Start feel like it had not started anything, and put a second
  set of life / commander-damage / monarch controls in front of the ones the
  board already carries.
- **A comparison needs someone to compare with.** The board-door's "N of M
  boards open" and its seat chips are hidden at a one-seat table, where they
  read as a count of yourself.
- **The lobby is where the table's rules are set, and the only place.** The
  pre-create Host form asks for the format and nothing else: the format
  implies the rest, the pod isn't assembled yet, and every rule belongs
  somewhere all of them can see and argue about it. Asking twice — once in a
  form nobody else can read, once in the rail — was the old shape.
- **"Random" is the absence of a choice, not a hidden one.** The starting
  player select holds Random until the host starts, and the roll happens on
  the host's device at that moment, dispatched as an ordinary settings
  change. The reducer stays pure and every seat sees the same first player.
  Same split for shuffling seats: the client rolls the order, `reseat` only
  applies the permutation it is handed.
- **Main** (right): the table name as a centered heading, a 2-up seat grid
  (one column below 1024) capped at `54rem` and centered, and the bracket hint.
  The grid is capped rather than stretched: a seat card is an object with a
  proportion, and two of them filling a 1600px column grow taller than a
  laptop viewport can hold alongside the footer.
- **Stacked, the seats come first.** Below 1024 the rail is `order: 2`: the
  settings block is tall, and putting it above the grid buries the one thing
  a player opened the lobby to look at.
- **The bottom bar is a sticky footer at every tier** (`position: sticky;
bottom: 0`), carrying the deck picker, the board link, Ready, Start and
  Leave. It is a sibling of the two-column body, not a cell inside it: a
  sticky element is constrained by its containing block, and a grid cell is
  only as tall as its own row, so a bar nested in the grid cannot follow the
  scroll. At >=1024 a `margin-left` of the rail's track puts it back under the
  seats. Opaque, never translucent, because seat art scrolls under it.

A **seat card** is the seat's commander art (`useCardThumb(name,
'art_crop')`, never a new fetch path) under the always-dark
`--art-scrim` gradient, with the name (crown for the host), the deck, a
status chip, the color-identity pips and the bracket italic at the right.
Your own seat carries the accent ring (`.is-me`). An empty seat is a dashed
card with a gray avatar and "Open seat"; the grid always draws a full pod,
so a table of two shows two open seats.

- **A status chip says its state in words** ("Ready", "Not ready", "Choosing a
  deck"), never in color alone.
- **A bracket is shown only where one exists.** Your own seat resolves it
  through `effectiveBracket(deck)`; the game state carries no bracket for
  anyone else's deck, so those cards omit the line rather than estimate one
  the table would then argue about.
- **Readiness never blocks Start.** `set-ready` is advisory: the host's button
  stays live and carries a count ("1 of 3 ready") until everyone is in. The
  host decides when a game starts; the lobby only reports.

### Board modes — per-player data belongs on that player's seat

When a surface answers "what has each _other_ player done to me?"
(commander damage is the case in hand), it is a **board-level mode**, not a
list inside one panel. Every seat keeps its position and color and changes
what its number _means_; the physical table does the identifying, so nobody
has to re-find "Nathan" in a popup. `.game-board.is-cmd-focus` is the
reference.

- **The anchor panel keeps its normal reading.** The player who opened the
  mode still sees their own life total, undimmed (`.is-cmd-self`), so the
  consequence of each tick is visible in place. Don't stage the effect to
  apply on close — the underlying action already moves life live.
- **Every other panel is visibly re-skinned so its number can't be misread as
  life.** Required, not decorative: dim + desaturate (`.is-cmd-source`), a
  caption naming the direction (`⚔ dealt to <name>`), and the panel's own now-
  demoted value kept as a small readout (`.pp-life-chip`) so board state isn't
  lost. A bare swapped numeral is a bug, not a minimal implementation.
- **Seat rotation is fixed — a mode NEVER re-orients the board.** Each panel
  keeps facing its own seat, always. Turning every panel toward whoever opened
  the mode was tried and reverted: it reads as the seats themselves moving, so
  the board looks broken at the moment the user most needs to trust it. A mode
  changes what a panel _says_, never where it sits or which way it faces.
- **Three ways out, always:** an explicit labeled button
  (`.pp-cmd-focus-done`), a swipe back down on any panel, and `Esc`. The
  title and the button live on the anchor panel, which is already rotated
  correctly and is where the user is looking.
- **Seat admin is suppressed** (the `⋯` button and the counter chips) — the
  panel's controls now mean something else, and leaving stale affordances
  around is how a tap edits the wrong player.
- **One panel, one number — unless the rules say otherwise, and then split it.**
  A seat with two commanders (Partner / Friends Forever / Doctor's Companion)
  gets `.is-cmd-split`: two `.pp-cmd-half` counters, each with its own name,
  numeral, progress fill, and ± zones. This is a correctness requirement, not a
  layout preference — rule 903.10a counts to 21 per _commander_, so two tallies
  that could be read as halves of one total would invite exactly the wrong
  arithmetic. When a panel splits, **suppress the panel-wide tap zones**: a
  zone spanning both halves swallows every tap and credits it to the primary.

### Playtest board — density, type rows, hover preview, card menus

The solo/online card table (`/decks/:id/playtest`) follows five rulings
(2026-09-10, after a side-by-side against Moxfield, Archidekt, EDHPlay and
Untap):

- **Card density scales with the board.** `--pt-card-w` on
  `body:has(.playtest-page)` is `clamp(90px, min(7vw, (100vh - 340px) / 4.6),
140px)` — 7% of the viewport, capped by what three type rows fit in the
  height left after the chrome, never below the old 90px. Both card vars are
  **registered `@property`s** so `getComputedStyle` hands the drop math a
  resolved length, not the `clamp()` text. Hand cards are the same size as
  battlefield cards (`.playtest-card--sm` reads the same vars); the hand strip
  is one card tall plus padding, never a fixed height. The ≤1023px and
  short-landscape tiers keep their own fixed sizes.
- **The battlefield is inset by `--pt-edge`** (half a tapped card's overhang)
  inside `.playtest-battlefield-wrap`, which paints the playmat and clips. A
  tapped card at x = 0 or x = 1 is therefore never cut off. PlaytestBoard's
  `getBattlefieldGeometry` subtracts the same inset — the two move together.
- **Type rows, whole cards first.** `auto-place.ts` lays permanents /
  creatures / lands in three rows and fills each with whole cards side by
  side; only a full row shingles down by 35% of a card so every title stays
  readable. It never overlaps cards while the row has room (the old 30%
  cascade hid names from the second card on). A face-down play lands in the
  creature row — it is a 2/2 whatever it was printed as.
- **A card the player placed never moves under the cursor, and the board's two
  rings are fixed colors.** Hover on the battlefield is a cyan ring
  (`0 0 0 2px var(--pt-ring-hover)`) plus `--shadow-card`, never a lift; a
  selected card wears a gold one (`var(--pt-ring-selected)`, inset). That is
  EDHPlay's pair, and both are fixed rather than themed because they are drawn
  on card art rather than on themed chrome, and because "under the cursor" and
  "in the selection" have to stay two readable states in every theme — which a
  single `--accent` for hover cannot promise once the selection ring exists
  beside it. A neutral border token is worse still: `--border-strong` is a dark
  navy on a dark theme, invisible over art. The hand fan may lift, because
  there the strip is a fan and nothing is read against where a card sits; on
  the battlefield position is information the player put there, cards are read
  against the row or stack they were placed in, and tokens / attachments / taps
  ride on top, so displacing one on hover breaks the alignment being read. The
  hover ring sits outside the card, where the selection's is inset, and a
  selected card is left out of the hover rule entirely. Guarded by
  `styles/battlefield-hover-static.test.ts`.
- **A counter on the felt is its own control, drawn the way EDHPlay draws it
  (2026-09-24).** `CardCounters`: a counter a card prints (+1/+1, charge,
  flying, ward…, the list is `playtest/lib/counter-kinds.ts`) is its mana-font
  glyph on a black disc with the count in a red bubble, in a column just off
  the card's top-right corner; a counter the player named is a colored disc
  with the count on it, stacked oldest-on-top up the card's bottom-left. Click
  adds one, right-click or a long press takes one off, − / ↓ on a focused
  counter does too, hovering names it ("Charge (4)"), and a "+1" floats up so
  a click on a 22px disc visibly landed. Fixed ink, never theme colors: the
  discs sit on art, the P/T plates' ruling. They are the card's SIBLING in its
  slot, never inside it (a control can't nest in the card's `role="button"`),
  so every way the card moves without its slot has a rule: hidden during the
  drag, and on a tapped card the layer takes the turned card's box. A card
  drawn with nothing around it (another seat's board, the drag copy, the hover
  preview) draws them read-only and inset. Guarded by
  `styles/card-counters.test.ts`.
- **Hover / focus preview on fine pointers lands in ONE slot.** `CardHoverPreview`
  shows the full face for any card carrying `data-preview-id` (set by
  `PlaytestCardFace`; absent when face-down, the URL resolves from React state,
  never from the DOM) the instant the pointer lands or focus arrives, with no
  delay and no fade (2026-09-23: the old 220ms rest plus a 120ms fade read as
  a slow table), hidden while dragging or while any modal sheet is open (the
  docked log is not a sheet). A two-faced card shows both faces side by side.
  The face is a fixed pane, `min(22rem, 24vw)` wide, vertically centered
  at the table's right edge; it flips to the left edge only when the hovered
  card itself would sit under it (a permanent parked at the far right, a zone
  pile). A tooltip that floats beside the card was tried first and covers the
  neighbors you are comparing against; a fixed slot never covers what it
  describes and the eye learns where to look. Touch gets no hover: a TAP on a
  hand card pins it in the same slot (#2282), and a long-press opens the menu.
  Under a tapped card, one line says so ("Hold a card for its menu."), until a
  card menu has been opened once on the device: the tap is the gesture that
  used to open it, so the hold is the one left to find. The line sits under the
  face, never on it (the face is shown for its rules text). On an upright
  phone a quarter of the width is barely bigger than the card tapped, so the
  pane is 72% of the width, centered in the felt between the corner clusters
  and the hand (`previewSlot`'s upright branch).
- **Every card surface has a menu, and it says what it will do.** Battlefield
  permanents and hand cards both open a menu (right-click, long-press, the
  Context Menu key or Shift+Enter — on every pointer type, desktop included)
  built on `CtxMenuShell` (floating popover ≥1024px, bottom sheet below). A
  hand card's menu is its whole vocabulary: Play / Play tapped / Play face
  down, Discard, Exile, top / bottom of library, Command zone. Labels name
  the change, never a toggle: "Tap" / "Untap", "Turn face down" / "Turn face
  up". A long-press that opened a sheet cancels the touch's default so the
  release click can't land on the sheet's items (`useLongPress`). Permanent
  counters, face flips and transforms are logged (`card-counter` / `face`
  kinds, public on the ticker); a face-down play is logged without the name.
- **Drag-to-attach is gated by type, never by geometry.** Every battlefield
  permanent is a host droppable, but `attach-drop.ts`'s collision detection
  reports a host only while the dragged card is an Aura / Equipment /
  Fortification (`isPlaytestAttachment`), and the host under the POINTER wins
  over the battlefield; any other drag never sees a host, so a permanent
  nudged over a neighbor in a full row is a reposition, not an attachment.
  The host lights with the same gold as the attached ring. An attachment
  dragged straight from hand enters the battlefield and attaches in one
  gesture (cast an Aura onto a creature). Anything else still attaches
  through the card menu's picker.
- **A selection acts as one.** The selection pill offers Tap / Untap (`T`:
  any untapped → tap all, else untap all), Graveyard, Exile and Hand
  alongside Copy / Paste / Clear. Each card is its own reducer step — the
  takeback trail counts them honestly.
- **Opponent entries badge unseen changes.** `use-unseen-changes.ts` counts
  arrivals in a seat's public zones since the viewer last opened that board
  ("2 new", in the entry's accessible name too); opening the inspector clears
  it and keeps it at zero while open; a pending seat's first board seeds the
  baseline. It is never hidden in presence density — a change you missed is
  exactly what a crowded strip must still tell you.
- **Life and mana share one row** (`.playtest-trackers`) **on the narrow
  tier** — two bordered chrome rows above the board were 45px of battlefield,
  and below 1024px they wrap to two rows again. At ≥1024px they are not a row
  at all: see the next subsection.

### The card menu drills down; the card carries its own body (2026-09-20)

Settled against EDHPlay's card menu, which the user asked for by name ("much
cleaner with the sub menus"). Three rulings, all on the battlefield:

- **A card menu is a short list of actions plus submenus, never one
  scrolling panel.** `CardContextMenu` opens on EDHPlay's rows in EDHPlay's
  groups — Tap / Counters ▸, Power / toughness ▸ / Move to ▸ / Flip (two-faced
  only), Turn face down / Make a token copy, Draw an arrow (online), Add to the
  stack / View information / More ▸ — and every stepper, picker and text field
  lives one submenu down. The root order and its groups are a test
  (`CardContextMenu.test.tsx`, `rootShape`), not a habit: a menu grows one row
  at a time and that is how it became a scrolling panel the first time.
- **Submenus fly out beside the menu with a pointer, and drill down in the
  sheet (2026-09-23).** Every table menu (felt, piles, battlefield, hand,
  command zone) is one engine, `TableContextMenu`: with a pointer a `▸` row
  opens its submenu beside the root on a 150ms hover, a click or →, and ← or
  resting on a sibling backs out, so the path stays in view (EDHPlay's
  behavior). In the bottom sheet there is no room beside anything, so the
  same tree goes a page at a time behind a back row. Groups are separated by a
  hairline (`SEPARATOR`), never by headings, and the engine drops a line that
  would land first, last or doubled. A row that does nothing right now (a card
  with no counters, an empty pile) stays in place and reads as off
  (`.playtest-ctx-action:disabled`) so the menu keeps one shape.
- **Every menu row prints its live key.** Rows take the binding from
  `keyFor(id)` (the board's resolved shortcut map), so a rebind moves the key
  on the row too. The menu is the discoverable face of the keyboard map —
  never a second set of behavior, and never a hard-coded `<kbd>`.
- **Controls that ride a card are SIBLINGS of it, inside a card-sized slot.**
  A battlefield card is itself a `role="button"` (it is the drag handle and
  the tap target), so a control nested inside it is invalid and unreachable —
  the same ruling as "the ✕ is a SIBLING of the open-button". `Battlefield`
  therefore renders one `.playtest-card-slot` per permanent, which owns the
  0..1 x/y placement, and puts the card and its `CardPtBadges` in it side by
  side. The badges stay upright when the card rotates 90°, and anything else
  that needs to sit on a card goes in the same slot.
- **Power and toughness are edited on the card.** Click a number, type the
  total you want, Enter (arrow keys step the draft, Escape leaves it alone).
  What is stored is still a modifier over the printed body (`ADJUST_PT`), so
  the card is never rewritten; a side whose printed value is not a number
  (`*`, `1+*`) has no total to type and stays read-only, stepped from the
  menu's Power / toughness page instead.
- **With a mouse, a click on a permanent selects it — it does not tap it.**
  Tapping is deliberate: `T`, or Tap in the card menu (EDHPlay's rule; a stray
  click tapping a creature was the misfire). A finger has neither a key nor a
  right-click, so on a coarse pointer a tap still taps — the board branches on
  `(hover: hover) and (pointer: fine)`, and both halves are pinned by tests.
- **Nothing on a hand card plays it by itself (2026-09-23).** A mouse click on
  a hand card does nothing (EDHPlay's rule: drag it, press A, or Move to ▸
  Battlefield). A finger or a keyboard has no drag and no hover key, so a tap
  or Enter opens the card's menu, where playing it is one more tap. A stray
  click putting a card onto the table was the misfire; `PlaytestBoard.test.tsx`
  ("never plays a hand card on a click or a tap") pins it.

### Table settings holds preferences, never game state (2026-09-24)

The sheet is for what you set once and forget: card size, felt, snap to grid,
the turn alert, the takeback rule, Resistance. Anything that **changes
mid-game because a card resolved** is game state and lives where you reach
during play: Designations (Monarch, Initiative, City's Blessing) is a game-menu
row and a felt-menu row, not a settings row. EDHPlay's Preferences draws the
same line.

- **An on/off preference is a full-width `role="switch"` row**: the link row's
  shape, the label, and `On` / `Off` where a link row shows its value, in the
  accent when on. Not a segmented Off | On pair: two buttons for one bit cost
  twice the width and read as a choice between equals.
- **A switch gets a line under its label only when the label doesn't already
  say what On does** (voice rule 20, 2026-09-29). "Turn tracker" could mean a
  timer or a log, "Minimalist mode" names nothing, and "Low life warning"
  hides its threshold, so each keeps one line (`aria-describedby`). "Game
  timer", "Full screen" and "Haptic feedback" say it themselves and carry
  none. Rows of mixed height are fine: the switch and its value still line up
  on the right. A line under every switch taught the eye to skip them all,
  including the ones that mattered. `BoardSheets.test.tsx` lists which
  switches carry a line, so a new one has to pick a side.
- **Changes apply as you make them.** No Save button: the sheet sits over the
  table so you can watch the change land.
- **An option that only means something online appears only online.** The turn
  alert is absent in solo playtest, where nobody passes the turn to you.

### Resistance arms an opponent, so it commits on Save (2026-09-29, E533)

The Resistance sheet opens from a Table settings row but doesn't follow that
sheet's apply-as-you-go rule. Picking a level arms a fresh opponent and writes
a log line. That's a game event, not a look you watch land, so the sheet is a
draft with Cancel and Save, the same as "Fight a horde". Trying three levels
before settling must not leave three announcements in the log.

- **The level is the main job and is always open** (`ChoiceList`, one line
  under each level). The level that fits the deck's bracket carries a "Fits
  bracket N" label chip: 1 and 2 → Casual, 3 → Standard, 4 and 5 → Ruthless.
  With no bracket known, the chip falls back to "Last used". It never picks
  a level for you. Off stays Off until you choose.
- **Timing and Answers are `Disclosure` rows that state their value** ("From
  turn 3", "All 6 · Game Changers"), shown only while a level other than Off
  is picked. Most people keep the defaults.
- **Game Changers follows the deck, not the device.** It defaults on from
  bracket 3 up, the line the bracket rules draw, and is set again each new
  game. Timing and answers are device preferences.
- **Every answer off is a warning with its fix** ("Turn all on"), not a
  silently idle opponent.
- **A resumed game keeps the rules it started under.** A snapshot saved before
  E533 has no options and resumes on `LEGACY_RESISTANCE_OPTIONS` (answers from
  turn 1, no attacks or discard). Never backfill it with the new defaults.

### The table's look is per-device, never table-wide (2026-09-20, E347)

The felt color and the sleeves are **preferences on this device**, the same
class as card size and the takeback rule — not `GameState` like the mulligan
rule or the turn timer. The test is who has to agree: opponents see the board
you publish, never your CSS, so there is nothing for a pod to settle. They live
in the Table settings sheet next to Card size, in `localStorage`, and the sheet
says so in one line ("Your table only").

- **Set on `<body>`, not on the board element.** `data-felt` / `data-sleeve`
  (see `playtest/lib/table-skin.ts`), because a face-down card also appears in
  surfaces that portal out of the board tree. The board applies them while it
  is mounted and hands back the undo, so leaving the table restores whatever
  was there.
- **A default writes no attribute and stores nothing.** The plain rules ARE the
  default look, so a device that never opened this carries no storage and no
  markup, and "Theme" means the felt keeps following the app's theme.
- **A sleeve is the one card back in another color, never a second image.**
  `background-blend-mode: luminosity` over a solid `--sleeve-color` keeps the
  printed back's light and shade and takes the hue from underneath. #2010
  collapsed the library pile, face-down permanents and the opponent rail's mini
  card onto one rule over one asset; a per-sleeve image would undo that and put
  an image request behind a preference.
- **The picker is native radios in a `fieldset`** (`no-aria-only-radiogroups`),
  one `useId()` group name per row — two rows sharing a name would be one group
  and picking a felt would clear the sleeve.

### Table chrome at ≥1024px: corners, not rows

Settled 2026-09-18 against EDHPlay. At the table tier the board is **one
full-bleed felt and nothing else** — every row of chrome is gone and what it
carried floats in the corners. Below 1024px, and in the short-landscape phone
tier, nothing changed: those tiers keep the header, the action bar, the
tracker rows, the flat hand strip and `MobileZonesPanel` exactly as they were.
(Superseded for phones on 2026-09-24: see "A phone is one tier, whichever
way up it is held" at the end of this section. There is no flat hand strip
or name strip any more; the hand is the fan.)
The split is made in JS (`useNarrowViewport`), so most of the table's CSS
lives on classes only the wide tier's markup carries and needs no media query;
only shared elements (the felt itself, the density cap) are gated on
`@media (min-width: 1024px)`.

- **No rows.** The page has no header row at any width: the way back is the
  game menu's "Back to …" row, and the deck's name is in that label (E450
  deleted a header that CSS hid at every width it rendered). `ActionBar` +
  `.playtest-trackers` render only when narrow (`PlaytestBoard`). Nothing the bar offered may become unreachable: every one
  of its actions is in the top-right game menu, the table menu, or a corner
  button, and each is one shared handler behind all three.
- **Four corners, anchored to the felt.** The clusters are `position:
absolute` inside `.playtest-battlefield-wrap`, not inside `.playtest-board`,
  so an opponent rail (a flex sibling of the wrap) is never underneath one.
  Top-left: **− 40 + on one line, with a chevron under it, and nothing else.**
  That is the whole resting panel. It sits over the felt every second of
  every game to show one number, so it earns its space by being small: a
  `--text-lg` numeral between two 22px ±1 steppers (`usePressRepeat`, so a
  ten-point swing is one hold), which take a **ghosted 44px hit box** on
  coarse pointers rather than growing. Badges are the one exception, and only
  when non-zero: a poison count or the Monarch must not need a panel to
  notice. Everything else is behind the chevron, which carries no "Details"
  label and no count. The popover under it is **one list, in the order a
  table reads them**: the opponent seats (name + life + ±1; the name opens
  that opponent's own panel, where life moves in ±5s), then one
  commander-damage row per commander, then the five player counters modern
  Magic actually uses (poison, energy, experience, rad, tickets) as icon
  rows, listed even at zero. Commander damage sits **above** the counters
  because it is the other way a game ends. No life row on the wide tier (the
  steppers are already on the panel; the narrow strip's sheet keeps it, since
  the chip has none), and the by-name counter field folds behind "Another
  counter". Solo's virtual opponents are in that list because they have no
  board of their own; **online leaves it out** — those seats are real
  quadrants on the felt, and a second place to read the same life total is a
  second place for it to be wrong. This is `LifeStrip`'s `variant="table"`;
  the narrow tier keeps the strip untouched.
- **The life change shows itself while you make it.** A transient `+5` /
  `−6` badge beside the total, accumulating every step within 1.4s of the
  last and then clearing (`useLifeDelta`). The numeral alone cannot answer
  the question you actually have — you are on 34, but was that six off a
  Blightning or one off a fetch. It is `aria-hidden`: the total's own button
  already announces the value, and a live delta would make a screen reader
  read every step of a press-and-hold. Render the loss with a real minus
  sign; a raw negative number gives an ASCII hyphen next to the stepper's
  `−`.
- **Bottom-left is one dock column, stacked by the browser.** Floating mana
  over the game log, both inside `.playtest-left-dock` — mana is read
  alongside your lands and your hand, not folded into your life total. They
  stack with **flexbox, never arithmetic**: the log's height is
  content-driven, capped at a max it rarely reaches, and it is unmounted
  when closed, so any offset computed from that max is wrong in both
  directions (one put the mana column 117px above the top of the viewport).
  The column caps its height in `vh` — a percentage resolves to `none`
  against the board, silently doing nothing — leaving the life panel's
  corner clear, and the log shrinks and scrolls rather than shoving mana up
  into it. The pool is nothing at all while empty and closed, a "Mana · 3"
  chip while mana is floating, and a vertical column of pips once opened by
  the chip or `M`.
  Top-right: the `☰` game menu (44×44, an `OverflowMenu`
  so the keyboard nav is the shared one), the TURN chip (carrying the turn
  clock when the table turned one on), the primary turn action, then the
  online-only phase/reaction/hold controls. **Nothing else earns a permanent
  button over the felt.** Take back and Select were there and are not any
  more: both are in the table menu and on their own keys, and neither is
  reached often enough to hold the corner. Each keeps a transient presence
  for exactly as long as it is live — a pending takeback says it is waiting
  on the table, and Select shows a "Done" button with its count while a
  selection is open. Bottom-right: the zone piles as a horizontal row, each
  labeled `Library (92)` with the count in the label, a click on the tile
  itself doing that zone's one obvious action (the library draws; everything
  else opens its viewer), and a kebab opening the zone's menu.
- **The zone shelf is tucked, and opens on intent.** A pile shows its label,
  its count and the top 60% of its top card (`object-position: top`, so the
  slice you keep is the name and art, not the rules box). Hovering it, tabbing
  into it or dragging a card onto it grows the stack to the full card — all
  three, or the keyboard and drop paths quietly keep the peek. The shelf is a
  reference you glance at between spells, not a fifth row of cards, and the
  corner it used to fill belongs to the battlefield. An **empty** zone is an
  empty well (`.is-empty`), never one of the tinted card backs: those are the
  look of a pile with something in it, and a graveyard at 0 painted as a solid
  brown card reads as a card. Bottom-centre: the hand fan, each non-land card badged with its
  real mana cost as mana-font pips (`ManaCost`, off the new optional
  `PlaytestCard.manaCost`; a pre-badge snapshot falls back to the bare mana
  value, and lands and tokens carry no badge at all). Bottom-left: the log
  dock.
- **The game menu is actions; anything you set once lives in Table
  settings.** The menu had grown to sixteen rows by absorbing every
  preference. It is now Back, Stats, Log, Keyboard shortcuts, Table
  settings, Fullscreen, Reset and the online-only Concede/Leave. Card size,
  Takeback rule, Resistance and Designations moved into
  `TableSettingsSheet`, which renders the card-size slider in full (you drag
  it while watching the table, so it cannot be a separate sheet) and states
  the rest as rows that open the pickers already owning them. Library
  actions moved onto the library pile. Mulligan was dropped: the
  opening-hand takeover offers it, which is the only moment it makes sense.
  **The test of a new row is which of those two it is** — an action, or a
  setting.
- **The table menu is what you reach for with the pointer already on the
  felt.** Right-click gives Pass/Next turn, Untap all, Mana pool, Create
  token, Roll dice, Select cards, Take back, and Reactions online. Draw,
  Log and Keyboard shortcuts were dropped from it: each is one tap away
  somewhere the eye is already going (the library pile, the game menu).
- **A counter you read at a glance is one control, not a boxed stepper.**
  The floating-mana row is six bare pips, each with its count beside it:
  click adds, right-click or a touch long-press removes, and arrow keys (plus
  `+`/`-`) do both from the keyboard. The retired version wrapped every color
  in a bordered chip with its own ± pair — eighteen targets for a number you
  check between spells, and a row too loud to skim. A pip at 0 recedes to
  0.45 opacity rather than disappearing: the six colors hold their positions
  so the one you want is always in the same place. Any control that steals
  right-click this way must `preventDefault` the context menu and set
  `user-select: none` / `-webkit-touch-callout: none`, or the OS menu and a
  touch text-selection eat the gesture.
- **Banners float, they never displace.** `ResistanceBanner`, the session
  summary and the takeback pending banner stack top-center in
  `.playtest-banners` (max 36rem), under the corner clusters' z-index.
- **Fan geometry.** Each card sits in a `.playtest-hand__slot` whose inline
  transform is `rotate(i × 2deg)` plus a squared translateY arc, with
  `transform-origin: bottom center` and a negative `margin-left` after the
  first. **The overlap is adaptive, never a constant** (`lib/fan-layout.ts`):
  it spreads the hand into the width between the log dock's reserved band and
  the pile row, capped at 52vw, and clamped to 0.12–0.6, so seven cards read
  as seven cards and fifteen still fit. A fixed 0.45 made a normal hand
  unreadable on a wide table. **A big hand flattens and shrinks, never
  overflows** (`fanTilt`, `fanCardWidth`): the outermost card turns at most
  6° and drops at most 12px however many cards there are (a fixed 2° step
  curled a 22-card hand 21° off the table edge), and once the tightest overlap
  no longer fits, the hand's cards draw smaller, down to half the table size,
  the way EDHPlay's do. Up to seven cards neither cap binds. The
  **lift is on the card, never the
  slot** — the slot owns the fan rotation, so lifting the card leaves every
  neighbor still. Hover and `:focus-visible` both lift. dnd-kit composes by
  construction: the source card is never transformed (the moving copy is the
  top-level `<DragOverlay>`).
- **An upright phone gives the hand a row of its own.** Beside the two piles a
  seven-card fan had 198px of a 390px screen and shrank to 58px, under a felt
  two-thirds empty. Upright (`UPRIGHT_PHONE_QUERY`, a portrait block nested
  in the phone block), the fan spans the full width at a size of its own,
  `clamp(64px, 22vw, 96px)` (a fifth of the width, as the sideways hand is a
  fifth of the height), whole cards standing on the zone shelf. The shelf
  keeps the table edge with the Hand button back in its row.
  `--pt-fan-row: own` tells `Hand.tsx` no row shares the fan's, and there
  the 52vw cap does not apply; only the end cards' 6° swing comes off the
  width.
- **`⌄ Hand (n)` is a menu button, never a collapse.** It opens the hand's
  menu, EDHPlay's rows in EDHPlay's order: Reveal hand ▸ Everyone, Play with
  hand revealed ▸ Everyone (both online only, like the library's reveals),
  Discard at random, Move all to ▸, View all. It is the first thing in the
  pile row, beside the library, at a fixed `--pt-hand-btn-w` that every fan
  reservation adds in. In a narrow landscape window that row has no room for
  it, so it stands above the library's label instead; upright and sideways
  phones keep it in the row. A menu opened from a button at the
  bottom of the screen passes `origin="bottom-end"`: it opens up and to the
  left, its corner on the button's top-right, rather than dropping down over
  the button the way a pointer's menu would. The hand is never hidden: the
  collapse it replaced hid the cards the button was named for.
- **The table has a menu.** Right-click on bare felt (or the Context Menu key
  / Shift+F10, or a long-press on a touch tablet) opens `TableContextMenu` on
  the shared `CtxMenuShell`, each item naming its key: Draw `D`, Next turn `N`
  or Pass turn `Space`, Untap all `U`, Top cards, Create token `K`, Roll dice,
  Select, Reactions (online), Log `L`. This menu is where the board's
  shortcuts are discovered, so an item without its key is a bug.
- **The felt says whose turn it is.** `.playtest-battlefield-wrap` carries the
  theme's two accent glows plus a 40px `repeating-linear-gradient` grid, and a
  2px inset `--brand-seal-gold` ring **only** while `activeSeat === mySeat` at
  an online table. Solo play has no turn order to signal and never rings.
- **Density follows the fan, not the vanished rows.** `--pt-card-w` is
  `clamp(90px, min(7vw, (100vh - 40px) / 7.6), 140px)`: three type rows (3.0
  card heights) plus the fan's reserved bottom (1.3) plus the life panel's
  reserved top (1.1) is 5.4 card heights = 7.56 card widths, and the 40px is
  the fan's own padding and toggle. Both reservations are real inputs to
  `auto-place.ts` (`reservedBottom` / `reservedTop`, fractions, never pixels),
  so nothing auto-played lands under the fan, the piles, or the life panel.
- **A phone is one tier, whichever way up it is held** (revised 2026-09-24,
  against EDHPlay's landscape phone). `PHONE_QUERY` (`use-narrow-viewport.ts`)
  is `(max-width: 767px), (max-height: 500px) and (orientation: landscape)`,
  and playtest.css's phone block uses the same string (pinned by
  `styles/playtest-phone-query.test.ts`).
  - A phone on its side is 800 to 930px wide, so the width test alone gave
    it the tablet table: four piles clipped along the bottom edge and no
    tab. It now gets the phone split: library and graveyard on the felt,
    exile and the command zone behind the edge tab.
  - On its side, the Hand button stays in the pile row beside the library
    (upright it stands above the library's label), and the tab is anchored
    just above the piles instead of centered, where it rose into the menu
    and TURN stack.
  - **The hand is the tucked fan at every size.** The short-landscape tier
    used to swap it for `HandDrawer`, a 44px strip of card NAMES under the
    table (E264, from before the corner overlays). That strip is deleted:
    the fan shows the cards, costs the table no height, and is the same
    object everywhere else. Don't bring a name strip back.
  - Pinned by the "a phone on its side" block in `PlaytestBoard.test.tsx`,
    which evaluates the board's real queries for an 832×360 touch screen.

### Opening hand — a takeover at 1024px and up, a sheet below

Keeping or mulliganing is the one decision in a game where nothing else on
screen matters, so from 1024px up the opening hand stops being a sheet docked
over the board and becomes the screen (`OpeningHandSheet`,
`OpeningHandSheet.css`, the `is-takeover` class). Below 1024px the bottom
sheet is unchanged — a phone has no room for the fan.

- **The table dims, it does not disappear.** The scrim is
  `color-mix(in oklab, var(--bg) 82%, transparent)` with a 6px backdrop blur:
  the battlefield stays faintly readable behind, so the takeover reads as a
  layer over your game rather than a different screen.
- **The hand is a fan, and the fan is geometry, not art.** Each card sits in
  a `.playtest-opening-slot`: the slot carries the fan transform (rotation
  `(i - (n - 1) / 2) * 4deg`, a squared-falloff `--oh-lift` arc computed in
  JS because CSS `abs()` isn't safe to rely on yet, `z-index: var(--oh-i)`,
  35% overlap), the card inside carries dnd-kit's drag transform. One
  transform per element is the rule — a drag must never fight the fan. The
  slot is `display: contents` in the sheet tier, so the phone layout is
  exactly what it was before slots existed. Hover or keyboard focus lifts a
  card out of the fan 24px, scales it 1.06 and brings it fully to the front,
  **keeping its angle** (`--oh-rot`, the one place the rotation is spelled, so
  the rest state and the lifted state cannot disagree). It used to straighten
  too, and that was one movement too many: the hand reads as a held fan, and a
  card snapping square breaks that read at the moment the player is looking
  hardest. Rotation comes first in the transform, so the lift runs along the
  card's own axis and it rises the way a card pulled from a real fan does.
  Cards deal in on mount and after every mulligan, 16ms apart, under 300ms
  total, and not at all under `prefers-reduced-motion`.
- **The fan is bounded by the height budget, not just the width.**
  `clamp(150px, min(16vw, (100vh - 380px) / 1.4), 300px)` — 16vw is the share
  of the screen the cards want, `(100vh - 380px) / 1.4` is what is left once
  heading, hint, actions, status and toggles have been paid for (1.4 is the
  5/7 card aspect). A layout that can push the actions off a short slab is a
  bug, not a trade: the actions carry their own `z-index` so the arc's outer
  cards tuck behind them rather than over them.
- **You arrange the hand you play with, not the one you are deciding on.**
  (Revised 2026-09-20, E348 — the takeover used to be the only place a hand
  could be rearranged, which is the inverse of useful, and in the
  mulligan-bottom step a drag competed with the tap that selects a card for
  the bottom.) The takeover now shows the hand exactly as it was dealt and has
  no drag at all; arranging lives in `Hand`, where each card
  registers a hand-slot droppable **on its own node** (the same shape as the
  battlefield's host droppable) and a drop dispatches `REORDER_HAND`. Two
  rulings survive the move and still hold:
  - **The card under the POINTER wins, not the nearest center.** The fan
    overlaps by two thirds, so box-vs-box collision is a guess;
    `makePlaytestCollision` answers a hand drag with `pointerWithin` over the
    hand slots, and filters those slots out of every other drag so a card
    coming back from the battlefield still lands in the hand as a whole.
  - **Never wrap a card to make it a drop target.** A wrapper is either
    `display: contents` (no box for dnd-kit to measure) or a box that changes
    the fan's geometry — the reason the parent-clamping modifier existed in
    the first place. Put the droppable on the card's node.
  - A drag is still invisible to unit tests: the collision function and the
    reducer action are covered, but prove an actual reorder in a real browser
    with stepped `mouse.move` after touching any of this. The keyboard and
    screen-reader path is not the drag at all — it is "Move it left / right"
    in the hand card's menu, which must keep working on its own.
- **Three actions, one row, in rising commitment:** View battlefield (ghost),
  Mulligan (warn tone), Keep hand (primary, and where focus lands on open).
  "View battlefield" is a _peek_: the whole takeover goes
  `visibility: hidden` behind a transparent scrim with one "Back to hand"
  pill top-center, and Esc returns. Esc does nothing else — the opening hand
  is non-dismissable, you leave it by keeping, mulliganing or exiting.
- **On a phone on its side the whole hand is readable, and nothing covers a
  card.** Under `(max-height: 500px) and (orientation: landscape)` (the same
  "phone on its side" as `RotatePrompt`):
  - The card width is bounded by the screen's height as well as its width
    (`(var(--vh-safe) - 176px) / 1.4`), so the fan always ends above the
    actions.
  - The seven sit side by side with an 8px gap and a 1.5° arc, not the 35%
    shingle.
  - The actions are sized to their labels (9rem minimum, the 44px touch
    floor) instead of the desk's 15rem × 3.5rem.
  - The stats line and the two toggles share one row.
  - "Tap a card to enlarge" goes, but the mulligan-bottom instruction
    (`.is-instruction`) stays.
  - Pinned by `styles/opening-hand-short-landscape.test.ts`.
- **Online, keeping does not start the game.** The takeover stays up as a
  smaller "Waiting for Bo and Cy" curtain (`is-waiting`: cards shrink, the
  actions go) until every seat's published board carries `keptHand`, then
  counts the table in — "Game starts in 3s", 2, 1, "Game has started" for
  800ms — and lifts. The countdown line is `aria-live="polite"`. A seat with
  no board yet, or one published by a client predating the field, reads as
  still choosing: absent is never "ready". Seated alone, the curtain says
  "Waiting for players to join" and never counts down — `every()` over no
  opponents is `true`, so the count is checked first.
- **A phone is walked to the table's best shape, sideways and fullscreen,
  once per visit.** `RotatePrompt` covers the whole board (opening hand
  included). It is an **overlay, not a dialog**: a `Modal` for the focus trap
  and Esc, but with no panel. Its contents sit straight on the opening-hand
  takeover's scrim (`--bg` at 82% plus a 6px blur), so it is themed like the
  board.
  - **Upright** (`(orientation: portrait) and (max-width: 767px) and
(pointer: coarse)`): icon, "Turn your phone sideways", one compact
    "Go fullscreen" primary and a quiet "Skip" text link.
  - **On its side** (`(orientation: landscape) and (max-height: 500px) and
(pointer: coarse)`, where 500 clears the tallest phone and stays under
    every tablet): turning does **not** end it. Only "Go fullscreen" and
    "Skip" stay, because the browser's bars still take a big share of a
    ~390px screen. Fullscreen ends it on its own.
  - "Skip", Esc or the backdrop dismisses it for the session
    (`sessionStorage`), in both orientations. It is a suggestion, not a wall.
  - "Go fullscreen" is drawn only where `document.fullscreenEnabled` (never
    on iPhone Safari), so a sideways iPhone has nothing to be offered, and
    sees nothing.
  - **"Go fullscreen" only goes fullscreen. It never locks the orientation.**
    It briefly called `screen.orientation.lock('landscape')` too, which on
    Android forced the screen sideways while the phone was held upright and
    kept it there until fullscreen ended (corrected 2026-09-24). Turning the
    phone is the player's call. Upright and fullscreen, the prompt keeps
    asking for the turn without the button.

- **The log can leave the table.** The docked log's pop-out opens
  `/decks/:id/playtest/log` as a named popup window; that page renders the same
  `LogDock` in its `page` variant from the deck's saved session and re-reads it
  on every `storage` event for that key, so it follows the game on a second
  screen with no channel of its own. The table never depends on the window
  being open, and the page has no pop-out of its own.
- **A resumed session shows the same cost badges as a fresh deal.**
  `backfillManaCost` (session-snapshot.ts) fills `PlaytestCard.manaCost` by
  name from the deck on hydrate; a saved session from before the badge shipped
  is not a different experience.

### Opponent rail — never hide a seat

The opponent presence rail (`playtest/components/OpponentRail.tsx`) is the
"who else is at the table" strip for online multiplayer. It answers a
different question than the board-modes panel above ("what does everyone
else's board look like right now," not "what have they done to me"), so it's
a separate, always-visible strip rather than a per-panel mode.

**No opponent may ever be off-screen, scrolled out of the rail, or hidden
behind a `⋮` overflow menu — full stop.** The usual "collapse a crowded strip
to an overflow menu at ≤600px" answer ([§ Toolbars & action rows](components.md#toolbars--action-rows-responsive)) is correct
for filters and controls and **wrong here**: a hidden opponent is a gameplay
failure (you can't tell someone assembled lethal), not a layout compromise
the way a hidden secondary button is. When a table is crowded, every entry
**shrinks** instead — down to a color dot + life total with the name
truncated to nothing — and only as an absolute last resort does the strip
wrap to a second line. It never scrolls and never drops a seat.

**Two densities, chosen by which axis has slack, not by taste:**

- **Presence** (portrait — the rail is a top strip): color, name, life, and a
  permanent count. Genuinely readable at ~130×44 per opponent, not a
  squeezed-down "glance."
- **Glance** (landscape — the rail is a side column): life, name, and a real
  miniature battlefield (~40–56px card tiles) at ~300–360px per opponent.
  Shape, tapped state, and count read at that size; text does not — reading
  an opponent's actual cards is a future "promotion" interaction, not this
  strip's job.

**The rail follows the long axis** (portrait → top strip, landscape → side
rail) because vertical is the scarce axis at every tier: a solo playtest
board already spends its height budget on the header/actionbar/hand/zones
chrome before the battlefield gets what's left, so three more boards at
glance size would leave an unusable sliver. The rail eats from whichever axis
currently has room.

**Density is gated on `(orientation: landscape) and (min-width: 900px)` — a
legitimate viewport read for a full-width/full-height chrome band (§
Responsive's "Full-width panels may keep viewport gates" carve-out), never
assumed from the entry's rendered width.** ⚠️ **Orientation alone is NOT the
signal.** A phone held sideways (844×390) is landscape but has no slack, and
the long-axis rule is premised on the long axis _having_ slack — gating on
orientation alone puts a side rail and N mounted miniature battlefields on a
screen that cannot spare the width. The 900px floor separates
tablet-landscape (~1024–1180, gets glance) from every phone landscape
(568 / 736 / 844, stays on presence). But the **shrink ladder within presence density** — dropping the
permanent count, then the name, as N opponents divide a narrowing top strip —
is gated on `@container` on each `.opponent-entry` itself (`container-type:
inline-size`), not on a viewport breakpoint (E61): a crowded rail can get
narrow on any viewport, and a `@media (max-width: 600px)` rule would simply
never fire for a cramped entry on a wide screen. The glance density's mini
battlefield is mounted only when that density is actually active (not
CSS-hidden while mounted) — its card art resolves through the shared
`useCardThumb` CDN cache per entry, and gating the mount avoids firing that
resolution for opponents a phone-portrait viewer will never see tiles for.

### Desktop table with opponents: 2x2, not a rail

Settled 2026-09-18 against EDHPlay, and it **reverses the rule above for one
tier only**. From **1024px** up — the same "table chrome" floor every other
tier in this file already draws (`isNarrow`, the corner-chrome rules) — an
online table seating one to three opponents has `.playtest-main` stop being
"your board plus a rail" and become a **grid of equal boards, one per seat** —
yours bottom-left, the others filling the row above (`PlaytestBoard`'s
`gridMode`, `OpponentQuadrant.tsx`). Two seats are two columns in one row;
three seats are a 2x2 with a quiet "Open seat" placeholder; four seats fill
it. Below 1024px, on phones, and at a five-seat pod the rail is still the
answer, untouched — its presence and glance densities are exactly what they
were.

**Revised 2026-09-21 (E372): the gate used to sit at 1440px, which lost every
opponent's board on an ordinary unmaximized laptop window, not just a phone —
an opponent's battlefield is the point of the table, and a rail (even
glance's mini-thumbnails) is the last resort, not the default the moment a
window is a little narrower than full-screen.** 1024 was chosen over
inventing a third breakpoint: below it the whole layout already switches to
the mobile shell (row hand, sheet drawers, floating chrome gone), so a seat
grid has nowhere to sit regardless of width — 1024 is the floor, not a guess.
Verified in a real browser before shipping: at 1024/1100/1280px with a
three-opponent (four-seat) table, each quadrant is ~450–550px square and the
container-driven card size (`OpponentQuadrant.css`) sits at its designed
36px floor — the same floor the old 1440px gate was already brushing against
at typical laptop heights, so the lower gate asks nothing new of the
quadrant. Life panel, name pill and hand fan stay fully legible at that size;
nothing was cropped or overlapping in the verification captures.

**Why equal boards are right here and wrong everywhere else.** The rail ruling
says an opponent's actual cards are unreadable at glance size and that reading
them is a future promotion interaction. That held while the only way to read a
card was to make it big _in place_. The **fixed hover slot** (§ Playtest board)
is that promotion, and it costs no layout: rest on any card in any quadrant and
its full face lands in the one pane at the table's edge. So a quadrant only has
to carry **shape, position, tapped state, counters and count** — which it does
down to its 36px card floor — and legibility is handed back on demand. Below
1024 there is no quadrant at all (the mobile shell takes over), which is why
the reversal is scoped to one gate and not argued as a general improvement.

- **Your quadrant is the real board, not a bigger tile.** It is the same
  `.playtest-battlefield-wrap` with the same corner chrome. What anchors where
  is decided by whose it is: the **life panel, hand fan, zone piles and log
  dock stay inside your quadrant** (they are yours), while the **turn/menu
  stack and the floating banners go `position: fixed` at the viewport's
  corners** (they are the table's). Nothing between the wrap and the viewport
  establishes a containing block, which is what makes that `fixed` legal —
  never put `container-type` on the wrap.
- **An opponent quadrant is a live board, and the inspector is still the deep
  dive.** Name pill top-center with the seat's color dot, life top-left with
  designations and the "N new" chip, the battlefield laid out from the same
  0..1 fractions with tapped rotation and counters, `handCount` face-down backs
  fanned bottom-center, the four zone piles bottom-right. The pill and every
  pile open `OpponentBoardModal` — the quadrant is the glance, the modal is
  still where a pile gets browsed.
- **Density is container-driven, never viewport-driven.** The quadrant is a
  `container-type: inline-size` container and its inner surface sizes
  `--pt-card-w` off `cqi`: the same 1920px viewport holds a half-width quadrant
  at two seats and a quarter-width one at four, so a width media query is the
  wrong signal by construction. Your own quadrant gets the same treatment by
  arithmetic (half the viewport term), because 7vw is 7% of a full-bleed table
  and 14% of a half-width one — at the original density the fan landed under
  your own pile row. **Whenever `--pt-card-w` is redeclared, redeclare
  `--pt-card-h` and `--pt-edge` with it**: they are inheriting registered
  properties, so a lone width redeclaration inherits the ancestor's already
  computed height and every card comes out the wrong shape.
- **The fan spreads into its container, not the window.** `Hand` measures the
  battlefield wrap with a `ResizeObserver` (it used `window.innerWidth`, which
  was the same number until a quadrant stopped being the whole table). In the
  grid it is re-centered in the space left of the pile row, and the log dock is
  lifted one extra rem clear of its top edge.
- **Chrome never covers a seat it had somewhere else to go.** The play ticker
  loses the rail column it lived in, and lands at the top-right of **your own**
  quadrant rather than the viewport's — parked in the screen corner it would
  sit over an opponent's board. The turn/menu stack is the one exception, and
  it is the exception the benchmark makes too.
- **The active seat wears the same gold ring your own felt wears**, and the
  turn-pass sweep the rail used to flash fires on the quadrant instead
  (`useTurnSweep`, shared by both surfaces so they can't drift). A point at a
  seat (`useTablePointer`) lights the quadrant.
- **Each quadrant is a `section` whose `aria-label` says what the rail entry
  said** — name, life, turn, permanents, hand, library, designations, points
  and unseen changes. A bigger screen never buys less information.

### Play ticker — narrative is public-only, ambient, and never displaces the board (E242)

The play ticker (`playtest/components/TableTicker.tsx`) projects each seat's
game-log lines to the table ("Maya played Sol Ring") so opponents get
narrative instead of board-diffing. Three rulings:

- **Public information only, decided at projection time, never at render
  time.** The lines a board publishes are filtered by
  `projection.ts:toPublicTicker` before they leave the device — a
  kind-whitelist plus the zone-endpoint check (a `zone-move` whose card never
  touched a public zone, e.g. a tutor `library → hand`, is dropped entirely
  rather than rephrased). UI code must never receive a private line and be
  trusted to hide it. The feed shows your own lines through the same filter,
  so what you see under "You" is exactly what the table sees.
- **The ticker follows the rail's density, on the rail's own gate
  (`GLANCE_QUERY`), and never displaces gameplay.** Glance (side rail):
  a persistent scrolling feed under the opponent list — the column has
  vertical slack. Presence (top strip): a **transient one-line flash**,
  portaled and `pointer-events: none` like `.table-moment`, auto-dismissing
  on a timer whose CSS lifecycle animation matches it exactly — a phone has
  no axis to spend on a persistent feed, and a reserved-but-usually-empty
  line would displace the battlefield (§ "insight surfaces never displace
  content"). Own-seat lines never flash — you just did the thing.
- **A transient surface needs a reviewable twin.** The presence flash is
  glanceable, not a history; the reviewable feed lives in the Log sheet's
  "You / Table" tab strip (a real view switcher → `Tabs` `fitted`, per
  [§ Tabs](components.md#tabs--view-switchers)). Don't add a second bespoke history surface.

### Store-driven global overlays (E170)

A non-component caller (a background sync push, or anything else that fires
outside the render tree and can't know which page is currently mounted) that
needs to put something in front of the user **pushes structured data into a
small Zustand store, not a plain string**. Reference: `store/conflicts.ts`
(the deck-conflict panel) —
mirrors `store/toasts.ts`'s own shape (a `queue`/`toasts` array + `push`/
`dismiss`/`clear` actions, plus an imperative `{ push }`-style helper object
for callers that aren't components) — the store is the only channel such a
caller has.

A **root-mounted viewport component** (mounted once in `Layout.tsx`,
alongside `ToastViewport`) subscribes to that store and renders whatever's
queued — `ConflictPanel.tsx` is the reference. It always mounts and renders
`null` when the queue is empty; there's no separate "is this open" flag to
drift out of sync with the queue's contents.

**Toast vs. panel — which one to push into:** a passive notice ("saved",
"price refreshed") is still a toast. Reach for this pattern instead when the
event needs a **decision** the toast's fire-and-forget affordances can't
carry — more than a single dismiss/undo action, content too rich for one
line, or (as with a sync conflict) data the user would otherwise have no way
to recover. In that case route through the shared `<Modal>` (portaled to
`document.body` via `createPortal`, same as `CardPreview`/`AvatarPickerSheet`
— a global overlay must not depend on where in the tree it happens to mount
to escape scroll/transform containment) instead of the toast stack.

**Multiple queued items:** show one at a time with a small "N more waiting"
indicator in the dialog, not one panel with N stacked sections. A per-item
diff can already run long on its own; stacking several buries the decision
that needs a choice under scroll. Dismissing (or resolving) the current item
advances to the next — `ConflictPanel` keys the `Modal` on the current item's
id so it remounts (fresh entrance animation, fresh focus) between items
rather than mutating in place.

**Focus:** `Modal` autofocuses the first focusable _control_, never a
heading — put `autoFocus` on the primary action button (mirrors
`ConfirmDialog.tsx`'s confirm button) rather than assuming the heading gets
focus for free.

**Conflict severity tiers (E174):** the sync layer has two distinct
sync-conflict events, and they deliberately get different treatment because
they're different severities, not the same event from two call sites:

- **Push rejected as stale** (`applyPushResult`) — the user's own edit was
  just discarded; recovering it needs a decision, so it's the `ConflictPanel`
  modal above (or the plain toast when there's nothing diffable, e.g. the
  deck was deleted on the other device).
- **Foreign revision arrives via pull** (`applyServerRows`, gated to a
  strictly-higher incoming rev — see the rev-comparison note in `sync.ts`) —
  the user's current deck state is untouched; only that deck's ephemeral
  undo/redo stack was reset, because replaying stale snapshots over a remote
  edit would clobber it under LWW. Nothing is lost that a decision could
  recover, so this is a plain informational toast, gated to fire only for a
  deck that actually had undo/redo history to lose (`deckHistory.hasHistory`)
  — a deck the user never opened this session has nothing to tell them about.

Don't promote the pull-side case to a panel "for consistency" — that would
alarm the user over an event that cost them nothing. Don't demote the
push-side case to a toast either — that's the one that needs a recoverable
decision. If a third conflict-shaped event shows up, classify it the same
way: does the user's current state differ from what they last saw (→ needs a
decision, panel-tier), or is it just bookkeeping about history/metadata
(→ informational, toast-tier)?

### Card art peek — hover + touch long-press (E129)

Any `[data-peek-name]` row (deck list rows, the Coach feed's `DeckCardRow`,
per-printing sub-rows) gets a transient floating card-art preview through
**one shared component and CSS file** (`DeckHoverPeek.tsx`/`.css`) with two
input gestures:

- **Desktop hover** (`useDeckHoverPeek`) — capability-gated to
  `(hover: hover) and (pointer: fine)`, cursor- or row-anchored. Unchanged by
  this section; documented above under [§ Info tooltips](components.md#info-tooltips)' "reveal model" note.
- **Touch long-press** (`useTouchPeek`, `frontend/src/lib/overlays/use-touch-peek.ts`)
  — 500ms stationary hold (the same `useLongPress` primitive the playtest
  opening hand uses for its own preview gesture) opens the same box; release,
  a second touch, or ~6px of movement (scroll intent) dismisses it. **Tap
  still opens the full `CardPreview`** — long-press is a glance, not a
  replacement, and the two never combine into a double-action: a fired
  long-press swallows the tap that would otherwise follow release.

Both hooks are **delegated on the same list/feed container** (spread
`listHandlers` — `hoverPeek.listHandlers` and `touchPeek.listHandlers`
side by side, no per-row hook instance), so one wiring covers every nested
`[data-peek-name]` row including ones several components down (e.g.
`SubstituteOptions` inside `CoachFeed`).

Rulings settled while building this:

- **The touch variant never gates on viewport width.** Desktop's row-anchor
  hover mode needs `minViewport` (a phone has no gutter to float beside), but
  touch has nowhere else to go on a narrow screen either — `computePeekPlacement`
  already clamps the box into whatever room exists, so it's fine for the peek
  to overlap the row on a phone. It's a transient glance, not a layout.
- **Touch anchors off the pressed element's rect, never the finger position.**
  A card centered under the touch point would sit under the thumb that
  triggered it; row-anchor placement (same math as desktop's `anchor: 'row'`)
  keeps it visible.
- **The touch variant shows a loading shimmer, then a "no art" glyph** —
  never nothing. A long-press is a deliberate hold, so it earns feedback
  immediately, unlike a fleeting mouse-over (hover mode still renders nothing
  until the art is in hand). `useCardThumb`/Row image fields don't distinguish
  "still resolving" from "genuine miss", so this is a ~1.5s grace window, not
  a real settled signal.
- **Don't trust `(hover: hover)` alone to gate a touch feature.** Samsung
  devices report `hover: hover` on a touch-only screen, so the CSS
  belt-and-suspenders rule that hides the hover box on coarse pointers
  explicitly exempts the touch variant's class rather than relying on the
  inverse media query to select it in.
- **Row/thumbnail controls with their own tap semantics** (qty-edit, kebab
  menu, remove, the printings-toggle) are excluded from arming the gesture at
  all — `useTouchPeek` checks `closest('button, a, input, [role="menu"],
[role="menuitem"]')` before starting the timer, so they're completely
  unaffected rather than merely "usually fine".
- **`-webkit-touch-callout: none` + `user-select: none` scoped to
  `[data-peek-name]`** (not global) suppress the browser's image-save /
  text-select long-press callout on the elements this gesture actually
  touches, without taking selection away from the rest of the page.
- **A fired long-press `preventDefault`s its terminating touchend**, so a
  hybrid pointer+touch device's synthetic compat mouse events can't chain
  into the desktop hover-peek right as the touch one closes (no double-peek).

### Zoom is the platform's job — don't build one

Ruling from the card preview, which shipped a hand-rolled pinch-to-zoom layer
(#1479/#1480) and had it deleted two builds later. **Do not implement zoom.**
Every platform we ship on already has pinch-to-zoom plus a pointer/keyboard
equivalent, tuned by people with the whole gesture stack to test against. A
custom one is a second, worse zoom that fights the real one: ours overshot,
clamped pan wrong, froze if you lifted one finger out of the pinch, needed its
own exit affordance and its own button, and stacked a fourth gesture owner onto
a sheet that already had three.

What it costs instead is configuration — invisible, and easy to break:

- **Keep `pinch-zoom` in every restricted `touch-action`.** The property
  **intersects down the ancestor chain**, so one bare `touch-action: pan-x`
  between the card and the viewport disables native zoom for that whole subtree
  — silently, with the carousel still swiping perfectly. Write
  `touch-action: pan-x pinch-zoom`, never bare `pan-x`. CI-guarded by
  `styles/card-preview-touch-contract.test.ts`.
- **Leave the viewport meta zoomable** — no `user-scalable=no`, no
  `maximum-scale`. Accessibility floor, not a preference.
- **No zoom button.** The gesture is universal on touch and pointer/keyboard
  users have browser zoom; a button is a redundant control competing for space
  in the action row.

Still true, and cheap to get wrong when adding _any_ overlay animation:

- **Never put an element that already declares `transition` into a blanket
  `transition: <prop>` rule.** `transition` is a shorthand: a later rule at
  equal specificity **replaces** the earlier declaration instead of adding to
  it. Doing this silently killed the panel's `height` animation (the Details
  expand/collapse) and the close button's press feel. Fold the new property
  into the element's own declaration; keep blanket rules for elements with no
  transition of their own. Same CI guard as above.
- **Touches aimed at a control are never swallowed.** A capture-phase gesture
  listener on a sheet must bail on `closest('button, a, input, select,
textarea')` — the same guard the long-press peek uses above.
