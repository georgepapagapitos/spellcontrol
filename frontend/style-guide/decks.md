# Style guide: Decks

The deck view, analysis, bracket, Coach, upgrades, deck lists and AI-written content. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, colour and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## Blend controls — N axes that must always sum to 1 (E234)

First instance: the deck-gen customizer's mana-philosophy wheel
(`ManaPhilosophyGroup` in `DeckCustomizer.tsx`) — four weights
(reliable/greedy/spelllands/budget) normalized with a per-axis floor so no
axis ever reaches 0 (see `manaPhilosophy.ts`'s `WEIGHT_FLOOR`). Any future
control shaped like this (a handful of weights that get normalized before
use, never fewer than ~3-4 axes) follows the same rulings:

- **Presets vs. continuous blend is an empirical question, not a taste
  call — simulate the scoring function at the corners and at a few
  two-axis blends before choosing.** A blend is only justified if a
  plausible two-axis combination produces a materially different result
  (a different rank order, a different pick) than either single-axis
  preset alone. For the mana-philosophy wheel, a 50/50 greedy+budget blend
  re-ranked candidate lands in an order neither the pure-greedy nor
  pure-budget preset reached — a real "useful, but not pricey" intent —
  so it shipped as four sliders. If the corners and center already cover
  every intent a user would reach for, ship presets instead; a blend
  control is more interaction cost than four buttons and isn't owed by
  default.
- **Reuse plain independent range inputs — don't build a sum-preserving
  drag algorithm.** Each axis is its own `<input type="range">` storing
  its own raw weight (the existing `.deck-customizer-slider` /
  `.deck-customizer-range` pattern, unmodified). The _displayed_ share for
  every axis is computed by calling the same normalize function the engine
  calls (never a re-implementation), on every render, from all four raw
  values at once. Moving one slider changes the sum, which changes every
  other axis's _displayed_ share live — that live readout is what makes
  the redistribution legible, not the other sliders' thumbs physically
  moving. Don't invent a proportional-redistribution drag model to make
  the thumbs move each other; the shared-denominator readout already
  proves the redistribution honestly, with far less code, and doesn't
  fight a user's own slider position with movement they didn't request.
- **A floor that keeps "no axis reaches zero" true in the engine must also
  stay visibly non-zero in the UI's own rounding.** If the display rounds
  to fewer decimals than the floor produces at the raw scale's extreme
  (e.g. a 0-100 raw slider against a 0.05 floor renders the idle axes as a
  misleading "0.0%"), either show enough precision to keep it truthful or
  — simpler — cap the raw slider's own max so the floored share never
  rounds down to the "zero" you're trying to prove isn't possible. Pick
  the cap by computing the floor share at the slider's own max and
  checking it survives your display's rounding.
- **Off and "every axis weighted equally" are different, both real,
  settings — never conflate them.** Off is the field itself being
  `undefined` (generation skips the pass entirely, byte-identical). A
  freshly engaged control should seed the true equal-floor state (every
  raw weight at its rest value, which normalizes to an even split) — not
  copy the off state's absence. The engage/disengage affordance is a
  single checkbox: checking it writes the equal-floor object, unchecking
  it writes `undefined` back. Don't add a second "reset" control next to
  it — for a binary on/off, the checkbox already is the explicit way back
  to unset.
- **Give the toggle checkbox its own `aria-label` when its row also
  carries a description.** The `collection-group-row` pattern (checkbox +
  title + sub-description in sibling `<span>`s, first shipped by
  `CollectionGroup`) computes its checkbox's _implicit_ accessible name
  from the label's entire text content — title **and** the description
  below it concatenated into one run-on string. That's harmless when nobody
  queries the control by name, but it's still the wrong accessible name: a
  screen reader announces the whole blob as the control's name instead of a
  concise label with the description as separate supporting content. Set
  `aria-label` on the `<input>` to the title text alone; explicit
  `aria-label` wins over the implicit `<label>` association, so the visible
  description stays in the DOM (still readable) without polluting the
  control's name.

## Build-time coach strip (E169 Half B) — a NAVIGATING insight strip

A **second** insight-strip variant, distinct from UX-334 above: the moment a
card lands in a deck's mainboard from the add-cards sheet, the deck editor can
surface one nudge — "this card just completed a combo", "this card just gave
the deck a win condition", "the bracket estimate just moved" — as a one-row
strip inside that same sheet (`components/deck/BuildTimeCoachStrip.tsx` +
`lib/coach/use-build-time-nudge.ts`). It follows every UX-334 ground rule (one row,
full-width, `min-height: 44px` on coarse pointers, **zero visible signal →
render nothing**, never a permanent fixture, never displaces the card list
below it) but differs on the one point that matters most:

- **UX-334's strip's tap opens a sheet** layered on the same page — nothing
  underneath is disturbed, so the whole row can be a single `<button>`.
- **This strip's tap NAVIGATES** — the detail lives in the Power tab's
  existing Combos / Win-conditions / Bracket panels one screen over, not in a
  new local sheet (reusing that detail view, rather than building a second one
  that duplicates it, is the point). But the strip itself lives _inside_ the
  add-cards overlay, and that overlay owns real, easy-to-lose state (the
  `CardSearchPanel`'s in-progress query + scroll position) that a bare
  `openView('power')` would blow away by unmounting it. So a navigating strip
  may **never** be a single tap-anywhere button the way UX-334's is — it needs
  two distinct affordances: a **"View →" action that explicitly closes the
  add-cards sheet before navigating** (the sheet's own `dismiss()`, called by
  the strip's click handler, not a side effect of routing) so the state loss
  is a deliberate, telegraphed consequence of a labeled button rather than an
  accidental one; and a separate **"×" dismiss** that clears just the nudge
  and keeps the sheet — and the user's in-progress search — open. Any future
  insight strip whose detail lives on another view/tab (not a local sheet)
  should follow this two-affordance, explicit-dismiss shape instead of
  UX-334's whole-row button.
- **Threshold discipline, not just presence/absence.** A signal engine that
  fires on every add teaches the user to ignore the strip — "a coach that
  cries wolf early teaches the user to ignore it permanently." Combo
  completion and "first win condition" are discrete facts (true the instant
  their pieces exist, false otherwise), so they get no minimum deck size —
  useful at card #2 as much as card #90. Bracket-estimate movement is a
  statistical estimate that swings on nearly every add while the deck is
  still mostly empty slots, so it stays quiet below 40% of the format's
  mainboard target (~40 cards for a 99-card Commander deck) — meaningless at
  ~5 cards, borderline-useful at ~40, squarely actionable at ~95. At most one
  nudge shows at a time (combo beats win-condition beats bracket — rarest and
  least ambiguous event wins).
- **Guard against a store write that isn't the user's own edit.** Any insight
  surface that reacts to live-recomputed deck fields (bracketEstimation,
  winConditions, …) across an async gap — a debounce, a network round-trip —
  must NOT gate on `isApplyingServer()`/`isApplyingAnalysis()` read inside a
  `useEffect`; both flags are a synchronous-window-only signal (see the
  comment on `touch()` in `store/decks.ts`) and have already reverted to
  `false` by the time an effect reads them, regardless of the write's origin.
  Use the deck's local-mutation token (`useLocalMutationToken`/
  `getLocalMutationToken`, E177) instead: snapshot it when arming, trust a
  settle only once it has advanced since baseline. `use-build-time-nudge.ts`
  is the reference implementation.

## Upgrade plan (E458, v2 E467, 2026-09-27)

A budget and a goal in, the best swaps that fit out, for any Commander deck
(imported, hand-built, generated). `components/deck/UpgradePlanSheet.tsx` over
the pure `lib/coach/upgrade-plan.ts`.

- **It spends over the Coach feed's own list** (`buildCoachChanges` →
  `rankCoachMoves`), so the plan and the feed never disagree about what a
  deck could use. No AI call, no new data source.
- **Value for money decides, ownership breaks ties.** A swap's value is the
  Coach tier plus its gain over the card it replaces (play-rate over the cut, a
  land's fixing score, a completed combo, a short role filled), divided by its
  price (`PRICE_SCALE`: $10 halves it), so a $27 fetch land has to be far
  better than a $0.30 staple to go first. Below the minimum gain it's a
  sidegrade and isn't proposed, owned or not. An owned card costs nothing but
  still earns its slot: a plan of free sidegrades that left the budget
  untouched is the failure this rules out.
- **Basics are protected:** a fetch land never replaces a basic, and basics
  stay at or above the fetch lands that need them.
- **Entry is one 48px row at the top of Coach** (`.upgrade-plan-entry`), never a
  panel above the feed ([§ Index-page insight strips](components.md#index-page-insight-strips-ux-334)). A precon added to the
  collection offers "Plan upgrades" beside "Open deck", which lands on
  `?view=tune&plan=1`.
- **The Add cards shell:** a fixed-height bottom sheet below 1024px, two panes
  above: settings and the answer left, the plan right, actions in the footer.
  On a phone the settings fold into one `Disclosure` that states all three
  values, and Copy shopping list and Apply to a copy move into ⋮.
- **Settings use the kit:** Budget is a `SegmentedControl` of amounts plus
  Custom (no per-preset swap count: it could fall as the budget rose). Goal is
  a `ChoiceList` (Stay at Bracket N, Move up to Bracket N+1 disabled with its
  reason at the top bracket, Any bracket). "Use cards I own" is a
  `SwitchRow` whose hint says they're free and don't use the budget. All
  three are remembered per deck on this device.
- **Rows are `DeckCardRow`**, read-only, behind a checkbox (picking items from a
  list, so a checkbox, not a switch). Every row names its cut as "Replaces X: …"
  and shows the swap art. **Both thumbnails open the one card preview** (a
  carousel over the whole plan, cuts included), with the desktop hover peek and
  the touch long-press on the plan's own layer above the sheet. Under each row,
  "Keep {card}" protects the cut: the plan finds another slot, the note names
  it, and kept cards sit in a "Kept in the deck" group that gives them back. A free owned copy shows the Available badge and no
  price. Unticking re-plans; the note names what left and what took its place,
  and the newcomer is marked once. Unticked rows stay in a "Left out by you"
  group so they can come back.
- **Honest money:** the summary splits "To buy · $X of $Y · N cards" from "From
  your collection · N cards · free, no budget used". Money left over always
  says why ("Nothing else worth buying fits the $12 left. Next: …"). A copy
  committed to another deck is priced (counting it free would strip that
  deck); a card with no price is left out, never free.
- **Left out is a list, not a sentence.** Every card the plan skipped sits in
  one `<details>` with its own reason: "Game Changer. Moves the deck past
  Bracket 2.", "Tutor…", "Pushes the deck's power past Bracket 3.", "Next pick.
  $9.90 over what's left.", "No price today." Its art opens the preview. When
  the re-estimate overshoots, the card dropped is the one whose removal lowers
  it most, never the latest pick, so a bystander is never blamed.
- **Bracket words follow § Bracket:** "Stay at Bracket N" holds the stated
  bracket, or the Estimate when the list already reads higher (adding cards
  can't promise a 2 to a deck that estimates 4). The summary reports the
  Estimate ("Stays Bracket 2 · Core" or "Bracket 2 · Core → Bracket 3 ·
  Upgraded"), and the plan waits for the combo check before it shows one.
  Holding offers "Plan for Bracket N+1" under the left-out list as the fix;
  from Bracket 4 up nothing is pre-filtered, and the re-estimate alone stops a
  move to 5.
- **Apply in place is the primary action** (one store write, one Undo, a toast
  with Undo). Apply to a copy saves "<name> (upgraded)" and leaves the list as
  it was.

## Adding from Scryfall: drop or paste a card link (2026-09-29)

- **A card dragged off scryfall.com onto the deck editor is an add**, the same
  add as the Add cards panel's +: into the zone the "Add cards to" toggle
  names, the exact printing dropped (the image's printing id beats the page's
  set/number), owned-copy claiming for that printing, one undoable edit, the
  "Added X" toast, the copy-limit refusal, the off-color note, and the
  replace-when-full prompt on a full deck (whose ways out keep the printing).
- **The drop target is the whole window** (`lib/import-export/use-link-drop.ts`), shown by a
  `.deck-link-drop` veil naming the zone: "Drop to add to Mainboard". It is
  aria-hidden and pointer-events: none (the toast is the announcement), has no
  entry animation (so it appears and leaves instantly), and says "Finding the
  card on Scryfall…" while the lookup runs. Drags that start inside the page
  and bare desktop files (the import dialog's business) never show it.
- **Any link shows the veil**: during a drag only the data types can be read.
  The drop decides; a link that isn't a card toasts "That link isn't a
  Scryfall card." and changes nothing.
- **A phone can't drag between apps, so a pasted link does the same job**: a
  Scryfall card link typed or pasted into Add cards jumps to the Scryfall tab
  and shows exactly that printing as the one result. A Scryfall link that
  isn't a card reads "No matches. That link isn't a Scryfall card."

## Deck view — one fact, one place (2026-09-08)

The deck editor is three tabs (Deck · Power · Coach) under one hero; Stats
is no longer a tab (see the 2026-09-23 ruling below).
A 2026-09-08 audit of a real generated deck found the same fact printed up to
three times on one screen, so these rulings now hold:

- **The hero owns the deck's identity numbers** — format, commander, card
  count, value, bracket — on every tab and at every width (`.deck-hero-totals`
  is no longer hidden on phones). The Deck tab's `.deck-stat-strip` carries only
  what the hero does _not_ say: avg mana value, archetype, missing, new
  arrivals. Never re-print a hero number in a strip, panel title or badge below
  it. (Tab health badges are exempt — they are verdicts, not the number.)
- **The top of the Deck tab puts the first cards on a phone's first screen
  (2026-09-25, E415).** Under 600px the glance strip is one line: its cells
  spread across the width, long labels swap for short ones ("avg MV"), and
  the missing cards' price drops (the buy list the stat opens states it);
  more than four stats scroll with the edge fade. Sort and View pack left
  under the search with Edit ▾ (a shared deck's `⋮`) on the right edge. The role chips are one
  scrolling line at every width. The archetype's label is "plays as", the
  stats band's word for it.
- **A panel's eyebrow is its only title.** `Panel title="Mana curve"` means the
  child renders no `<h4>Mana curve</h4>` of its own; sub-headings inside a panel
  (Color → Distribution / Mana base) are fine because they name _parts_. The
  compare page names its sections itself, so `DeckCurvePhases` /
  `DeckTypeBreakdown` carry no heading anywhere.
- **The Power hero states the verdict; the panels show the working.** The
  Bracket panel does not repeat "Bracket N · Label" (the hero already does).
  The stated-vs-estimate `BracketVerdictStrip` renders only when a bracket is
  stated: on Auto the headline IS the estimate, and the strip read "Bracket
  Auto · Estimate B4 · Auto · No bracket set" (2026-09-25, E415).
- **The Bracket panel shows its evidence, sized to fit (2026-09-25, E415).**
  - Hard floors are hairline rows, `tag | body`: "Bracket 4" in a narrow
    serif-caps column, then the reason, its detail, and the cards that set
    it as art tiles (the deck copy's `art_crop` through `scryfallArtCrop`,
    name under it, the whole tile the preview button, a plain plate when no
    art is on hand). Never a bordered table or an accent-barred box for what
    is usually one reason. Under a 26rem container the tag stacks over the
    body.
  - The power signal is a `MeterBar` on its real 0–100 scale with the next
    threshold the estimator can cross as the tick (66 for the bump under
    floor 4, 80 for cEDH), the ends and the tick's number printed under it,
    and one sentence under that: how many points to the line and which
    bracket it lands on, or why no points get there (cEDH needs the Game
    Changers). No tick when no threshold is left. A bare "51/100" never said
    what 51 meant.
  - The component table and the floor-plus-signal arithmetic sit behind one
    `<details>` titled "How the points add up", with a turning chevron. The
    score is already stated above it, so the summary doesn't repeat it.
- **The Combos panel opens on the tab with something in it (2026-09-25).**
  The tab is derived: the owner's pick once they tap one, else "One card
  away" when nothing in the 99 is complete and something is one away, else
  "In deck". An empty "In deck" that the owner picked points at the next tab.
- **A role has one number on the page (2026-09-24).** The role chips above
  the list, the Power tab's Roles panel, the deck checks, the Coach and Next
  best move all read one live count: the mainboard, each card once under its
  main role (`countedRoleOf`), lands and the commander excluded, the same
  count the generator and the AI's `check_bracket` use. A chip lights exactly
  the rows it counts, and it leaves "Not in the deck" alone. A generation-time
  `roleCounts` snapshot only stands in until the tagger loads. There used to
  be three counts (overlapping chips over the sideboard and lands, an
  overlapping density line, the frozen snapshot), and one Sram deck showed
  Removal as 11, 10 and 6. Never add a second tally beside it; if a card's
  other roles matter, they belong on that card (the inspector lists them).
- **The deck is the commander and the mainboard (2026-09-25).** Every stat,
  verdict, score and count on the deck page (the stats, Power, Coach) reads
  the commander zone and the mainboard, never the sideboard or Considering.
  In Commander that includes legality: a banned card or a second copy parked
  in the sideboard doesn't fail the checks, print Power's "can't be played"
  note, badge a mainboard row, inflate the flagged count or block the seal
  (`validateDeckZones`; sideboard rows still get their own badge). In a
  60-card format the sideboard is registered, so legality counts it there.
  The Combos panel's counts and its one-away list read the 99 too. Other
  piles only ever EXCLUDE: nothing already in one is re-offered.
- **"Plays as" follows the deck's engine (2026-09-24).** On Auto the
  archetype is the owner's theme from generation if they chose one, else the
  deck's own engine when one clearly leads (`resolveAutoArchetype`), else the
  generator's EDHREC read. The strip and the stats can no longer say
  Goodstuff while Power says Equipment / Voltron. The generator's read stays
  in the build report, as a record of how the deck was built.
- **Wedge hint strips are scoped to the tab they act on.** The resync strip
  acts on the list, so it renders on the Deck tab only — a strip above
  Power/Coach that cannot act on what is below it is noise.
- **New arrivals are one stat, and they are tailored.** The per-column
  "✦ N new" chips are gone; the Deck-tab strip shows "N new arrivals" (accent,
  next to "missing") and opens the single all-category `NewArrivalsSheet`. The
  rows are narrowed at `DeckEditorPage` to cards the coach already recommends
  for this deck or that finish a one-away combo — "in colour identity and
  bought recently" is not a recommendation.
- **List is the default deck view** (reversing E127's card-forward grid). The
  list is the editing surface — editable count, kebab, reorder, price, mana cost,
  hover-peek; the grid is a gallery that fits ~8 cards per row on desktop and
  2 on a phone. An explicit persisted choice still wins either way.
- **A "will it fit" affordance says what it does.** The row button is
  `Fit & cut` (aria: "Will X fit this deck, and what would it replace?"), not
  `Fit?` — on a full deck every suggestion is really a swap, and the cut is
  the half the user is looking for.
- **A placeholder is never the tallest thing in the stats.** `Table record`
  on a never-played deck is one line and a secondary "Track a game", sized
  to its row beside Salt ([§ Empty states](components.md#empty-states-e182): a sub-panel placeholder is a
  single concise line). It used to be a display-face tagline plus a primary
  button, taller than any real panel on the page.
- **The list view is a command zone plus packed columns, not CSS multi-column
  flow.** The Commander section (one or two rows — a partner is just a second
  row with its existing "Partner" tag) is a full-width strip ABOVE the type
  columns, rendered by the same `CategorySection`/`DeckMainboardRow` as every
  other card so its kebab, hover-peek, tags and allocation colour are identical;
  its rows sit on the same column grid as the sections below (`--deck-cols`),
  so one commander row is exactly a column wide and a partner pair reads as two
  aligned cells. The remaining sections are placed by `packSections`
  (`deck-display-rows.ts` → `packInOrder`): balanced contiguous runs, so
  reading down each column in turn is exactly the type order. See "One reading
  order" under § Deck list on a wide screen.
  Unbreakable section cards in `column-width` flow could only follow document
  order, which left a 30-row hole under a 1-row Commander card and a
  Sorcery-above-a-gap when Land could not fit. Under 1100px the flat single
  panel stays one column (DeckDisplay reads that breakpoint via
  `useMediaQuery`). Never give the commander a bespoke card widget; never
  re-introduce `break-inside: avoid` masonry for sections of wildly unequal
  height.

### Deck stats sit under the list (2026-09-23)

Moxfield and Archidekt both lay a deck out as one scroll: the list, then the
stats. We had the same stats one tab away, so editing the list and reading
what it did to the curve meant switching tabs every time.

- **Stats is a section of the Deck view, not a tab.** `DeckDisplay` renders a
  "Deck stats" section (`.deck-stats-below`) after the list and its "Not in
  the deck" zone: identity card, Mana curve, Color + Types, Saltiest, Build
  report, Table record, in that order. The owner's page and the shared/public
  page get it from the same component.
- **Power and Coach stay tabs.** They are verdicts and actions, they load
  async with skeleton and error states, and they are long. Stacking them under
  the list would make one endless page with spinners in the middle.
- **The checks verdict leads the stat strip** ("2 to fix" / "1 to tune" /
  "All clear", coloured by tone, label "deck checks"). It replaces the old Stats
  tab badge and is a button that jumps to the stats: on a phone the list is
  one long column, and this is the way down.
- **Old links still land.** `?view=stats` (and the older `overview` / `mana`)
  resolve to the Deck tab and scroll to the section once the deck has loaded.
  The param is left in the URL on purpose: rewriting it is a navigation, and
  `Layout`'s scroll reset on navigation cancels the scroll. In-app jumps go
  through `scrollToDeckStats` (built on `lib/util/scroll-to-heading.ts`).
- **The identity card repeats nothing the hero says.** It has no art band,
  commander or deck name, format, bracket, brand mark, or curve sparkline
  (the Mana curve panel sits right below it).
- **The stats open on a glance band that shows the working (2026-09-24,
  E415).** The card answers "what is this deck?" before any panel: a "Plays
  as" headline (the archetype in the display face, the pacing beside it, the
  archetype picker as an "Auto" / "Your pick" chip), one sentence on the
  engine built from the same read the radar draws (so every number in it is
  on the radar), and the playstyle radar itself, always mounted at full size.
  It was collapsed behind a "Playstyle" expander and drew ~180px wide in a
  1,100px box, which is what made the section read as lazy. Below that sit
  the workings of the two verdicts: **every** deck check as a hairline row
  (glyph, label, number; a failing tunable one carries "Fix in Coach"), and
  build health as four sub-score meters with the 70 line ticked. The verdict
  WORDS are not here: "All clear" / "N to tune" belong to the strip, the
  bracket to the hero. The band and the sentence under the meters are built
  from the stored score (`bandFor` / `headlineFor(overall)`), never from the
  stored headline, so they can't disagree; a "Needs work" over "Your deck is
  solid" came from exactly that.
- **Under the list the board spans the list's width** (`--analysis-max: none`
  inside `.deck-stats-below`). The 1320px cap centred a board on its own tab;
  beside a full-width list it read as a ragged inset.
- **Panels are sized to what they hold (2026-09-24, E415).** After the glance
  band, the stats sit on two `.deck-stats-row`s: Mana curve (two shares)
  beside Types, then Color (two shares) beside Saltiest cards and Table
  record. A row is a flex line, so an absent panel closes it up; under ~900px
  of board it stacks. Every panel used to span the full board, which put a
  two-row salt list's scores 1,000px from their names and drew eight curve
  bars 140px wide. Never make a stats panel full-width to "use the space".
- **The curve reads without a key it doesn't have.** Each count rides on its
  bar (or on the target mark, when that sits higher); the pacing targets are
  a dashed notch with a "Target for this pacing" legend; the phases are rules
  under the columns they roll up (Early under 0–2, Mid 3–4, Late 5+), in the
  bars' own 8-column grid, not three boxed tiles. Off target is a caution
  tone (the tip says it can be what the deck wants), never error red. The
  average is two decimals, the strip's figure.
- **Color answers "can I cast my spells?", not "what share is blue?"**
  (2026-09-25, E415). The panel opens on the deck's colors in words beside
  the pips ("Mono-white", "White, blue and black"; guild names mean nothing
  to a newer player) with the non-land count, then one hairline row per
  color: its cards against its sources on one shared scale, a thin color
  flagged "▾ short" in words, and each count opening the list it counts. The
  share-of-deck donut (an unlabelled 67 in the middle, "57% white" beside it)
  and the boxed Demand/Sources cards inside the panel are gone.
- **Types files the command zone as its own row**, "Commander" first, the way
  the list does, so the Creature count here is the list's Creature section.
  Count only: on a 100-card deck a percentage beside it just repeated it.
- **Salt leads with the deck's own band word** ("Table-friendly", deck avg
  beside it), then the saltiest cards on a name · band · score grid.
- **Build report is one resting row** naming the archetype whose targets the
  generator used ("Generated with Goodstuff targets": worded as targets, so it
  doesn't read as contradicting "Plays as", which reads the cards); it opens
  in place (`<details>`), and every "+ Add" inside still works.
  It is a record of the build, not a stat, so it never takes a panel's room
  until asked. A disclosure, not a sheet, because the public shared deck
  renders the same stats and has no sheet.
- **A lone tab is not a choice.** A deck with no Power/Coach (any non-Commander
  format, or a shared deck with no analysis) shows no view-tab bar at all, and
  `DeckDisplay` drops its tabpanel role (`tabbed={false}`).

## Deck page menus — each named for what it acts on (2026-10-08)

The deck page had a `⋮` in the header and a `⋯` at the end of the toolbar,
both unlabelled, with no rule between them: Export and Test hand sat in the
toolbar's, Paste cards, Bulk edit, Resync and the printing fixes in the
header's. Finding Export meant opening both. Now every menu on the page is a
named button, and each holds exactly one kind of thing:

| Menu | Where | Holds |
| --- | --- | --- |
| **Deck ▾** | header actions | the deck as a whole: Play (Playtest on a phone, Test hand), At the table (Pull list, Tokens to prep, Print proxies), Share (Export, Primer, Get feedback), This deck (Duplicate, Build report, Regenerate), then Delete |
| **Edit ▾** | toolbar | changes to the card list: Select cards, Paste cards, Bulk edit, Resync from a list, Match my copies, Cheapest printings for missing |
| **View** | toolbar, last | the display only: whatever layout/group/size control the row folded, row details, the role key and the symbol key. Never an action. |

- **Add cards stays the header's primary.** It is the page's main action on
  every tab, and the toolbar only exists on the Deck tab.
- **Select leads Edit ▾.** While selecting, Done sits on the row, so leaving
  the mode never means opening a menu.
- **Deck ▾ is two columns from 600px** (Play + At the table, Share + This
  deck) so the whole menu shows without a scroll; one column on a phone, in
  the same order.
- **A shared deck** has no Deck ▾ and no edits: its Test hand and Export keep
  a kebab in the toolbar, after View. With no header menu on that page there
  is no second kebab to mistake it for.
- Guard: `DeckDisplay.toolbar-fold.test.tsx` (the owner's toolbar has Edit and
  View and no kebab, at both widths) and `DeckEditorPage.delete.test.tsx`
  (Export and Test hand in Deck ▾ at every width, list edits never).

## Deck list on a wide screen (2026-09-19)

A 100-card Commander deck on a ~2000px display used to render as six 280px
columns — one section each, five of them mostly empty below the fold — while
every card name was ellipsised to ~90px behind a role code, a combo chip, a
foil glyph, four mana pips, a price and a kebab. Compared against Moxfield's
text view (`qty · name · ✓ · ⌄`, everything else opt-in or in a pinned
preview) and Archidekt's static-card panel, these rulings now hold:

- **Columns come from the row count, not just the width.** `listColumnCount`
  (`deck-display-rows.ts`) takes as many columns as fit at a 320px floor,
  capped at `ceil(rows / 30)`. A Commander deck stops at four; the leftover
  width goes to the names. A 400-card cube still fans out. Never raise the
  cap to "use the space" — empty columns are the failure this replaced.
- **A deck row reads as a table.** Mana cost and price sit in fixed,
  right-aligned slots at the trailing edge (`.deck-row .mana-cost-row`,
  `.deck-row-price`) so the eye runs down a column of names and a column of
  costs. Pips that float at a different x per row are what "crammed icons"
  actually means.
- **At rest, a row is qty · name · mana · price.** Roles default off in
  `DEFAULT_SHOW_PREFS` (the Category lens's heading already says "Removal";
  the tap-to-reveal badge, the Key and Show → Roles all remain, and a stored
  preference wins). Foil and combo chips join the allocation/synergy/EDHREC
  hints in `.deck-row-hovermeta` — hover-revealed on a fine pointer, inline
  on touch. The ⋮ kebab keeps its slot but rests at `opacity: 0` on a fine
  pointer and shows on row hover/focus. Add a new always-on glyph to the row
  only by trading one out.
- **Hover chips drop by the name cell's width, never the name (2026-09-29).**
  `.deck-row-name` is a size container; the chip cluster is one right-aligned
  group against the mana column with a single gap (no per-chip margins, one
  chip height). As the cell narrows it drops EDHREC % (below 22.5rem), then
  synergy and the provenance tip (20rem), then ownership (17rem; the qty
  already turns red), and last combo and foil (10rem). A 100-card deck's four
  desktop columns leave ~160px, which holds the name and the combo badge. The
  card inspector lists the combo count and EDHREC share, so nothing a narrow
  row drops is lost. Add a new row chip by giving it a tier, not a margin.
- **A deck row's count is a button, never a −/+ stepper (2026-09-28).** Tap
  or click the number to type a new one (Enter commits, Escape cancels, 0
  removes the card and hands focus to the next row's count); the ⋮ menu
  carries Add another copy / Remove one copy / Remove all. The stepper used
  to appear only where a second copy was legal, so a Commander list showed it
  on the basics and on "any number" cards like Sphinx's Approach, and it read
  as a bug. One control on every row, in every format and zone.
- **Wide + fine pointer gets a card inspector, and it earns its width.**
  Superseded the day-old pinned rail (see the amendment below). `DeckCardInspector`
  (co-located CSS) is a sticky LEFT column beside the deck body at
  `(min-width: 1024px) and (hover: hover) and (pointer: fine)`, mounted by the
  shared `.deck-body-layout` wrapper in **every view mode** — list, grid and
  stacks — showing the last card the pointer rested on, the commander until
  then. It carries art, name, mana, type line, **oracle text**, the ownership
  sentence (`allocationSummary` + `BinderBadge`), role and synergy chips, price,
  and three row actions; clicking the art opens the preview. A pin toggle freezes
  the panel so the pointer crossing another row can't interrupt a read. The deck
  page has **no floating hover-peek**; the touch long-press peek is untouched
  (see the 2026-09-25 amendment). The inspector never owns hover state — it
  remembers `useDeckHoverPeek`'s last non-null answer, so it doesn't blink back
  to the commander between rows.
- **The group lens is a labelled dropdown.** "Group · Type ▾" (`SelectMenu`,
  same as the collection toolbar's Group by), not three unlabelled icons.
  A display control whose options can't be told apart at a glance gets a
  word, not a tooltip.
- **Three lenses, and every one of them partitions.** Type, Roles and Tags.
  Each files a card under exactly one heading, so section counts always sum
  to the deck and a reader can trust any total on the page. Settled
  2026-09-21, when a fourth lens was retired: there were briefly TWO lenses
  over `DeckCard.tags`, one partitioning and one overlapping, and the
  overlapping one shipped a banner explaining why its counts did not add up.
  A feature that has to apologise for its own numbers is the wrong feature.
  "Show me everything tagged Combo" is a **filter**, not a grouping, and it
  lives in the toolbar search (which matches a card's name OR any of its
  tags) so it works under every lens and in all three layouts.
- **One word, one meaning: "Stacks" is a LAYOUT.** It names the overlapped-
  card geometry below, and nothing else. The grouping over a user's tags is
  called "Tags" because that is what the chips, the manager and the card
  menu already call it. The derived lens is called "Roles" (not "Category")
  because its buckets ARE `ROLE_TITLES` — the same four words the role
  badges and the role filter chips use. Before this, "stack" meant three
  things and "Category" competed with the user's own vocabulary.
- **Stacks is the third view, and it is the grid's tile in another
  geometry.** `DeckCardGrid layout="stacks"` renders each group as one column
  of overlapped tiles (`.deck-card-stack`, `--stack-peek` ≈ 11% of the card
  height so the name strip reads), the hovered/focused tile opening to full
  size while the rest of the column slides down to clear it — the tile itself
  never moves, so the cursor stays on the card it opened, and the cards under
  it keep their strips within reach (Archidekt's behaviour; z-order alone
  buried them). The slide is `--motion-gentle` `--ease-drawer`: it is a full
  card of travel, so it takes the drawer pair, not the 120ms hover one. Card width is the zoom
  ladder × 1.4 (`stackWidth`), driven by the same −/+ control as the grid.
  Toggle order is grid → stacks → list. Never fork the tile for stacks: every
  pip, badge and allocation cue must stay shared with the grid.

### Amendment: what a stack opening should look like (2026-09-21)

Three passes at the slide read as the card _popping in_ rather than the stack
moving off it. The rulings, guarded by `styles/stack-hover-reachable.test.ts`:

- **The stack moves; the card does not.** The open card stays exactly where it
  lives in the column, and every card BELOW it carries the same
  `transform: translateY(--stack-open)` — `~`, not `+`, so each one travels
  from its own place and the tail arrives as one block of cards. The cursor is
  on the open card's name strip throughout.
- **Never lift the open card by `z-index`.** Painted over its neighbours it
  appears whole on the first frame and the tail slides out from under it, which
  is the pop. In DOM order the tail slides ACROSS its face and uncovers it top
  to bottom. That uncovering IS the animation.
- **The overlap is layout and never animates.** `margin-top` puts each card in
  the stack; transitioning it re-lays-out the deck every frame and moves the
  tail by reflowing the card in front of it. Room for the slide is reserved on
  the column, and only when the open card HAS a tail — a one-card stack, and
  the last card of any stack, move nothing, so they reserve nothing. The
  reservation rides the same duration and curve as the cards, so the column's
  floor tracks the tail: released in one step it either holds an empty
  half-column of surface after the cards are home (delayed) or lets the
  returning cards spill out of the panel (immediate). Animating the box is not
  the reflow-per-frame mistake above — that one animated `margin-top` on a
  CARD, moving the cards themselves by layout; here the cards are on transforms
  throughout and only their container animates.
- **A tap opens the card in the stack; a second tap opens the carousel**
  (2026-09-25). Touch has no hover, so a tap used to go straight to the
  carousel and the phone stack could only be read one modal at a time. Now the
  first touch tap sets `.is-open`, which slides the tail exactly as hover does.
  A tap on the open card, or on a card that already shows whole (the last card
  of a stack, a one-card stack), opens the carousel. A tap outside the cards
  closes it; a scroll does not, since a stack runs taller than the screen and
  you may be scrolling to read the card you opened. Only a touch pays the extra
  step: the mouse opens by hover and the keyboard by focus, and both go straight
  to the carousel on activation. Stacks never open on load; the strips are the
  index.
- **A tapped card scrolls into view by the least distance, never centred.**
  The card opens downward from the strip, so a strip low on the screen used to
  open most of its card below the fold. The tap now scrolls the cell with
  `block: 'nearest'`: a card that already fits does not move the page, so the
  strip stays under the finger, and one that does not fit moves just enough to
  show whole. `scroll-margin-top` clears the sticky Deck / Power / Coach tabs.
  Centring was ruled out because it moves the tapped strip away from the finger
  on every tap and makes walking down a stack jump.
- **Stacks pack, they do not wrap.** `packStacks` balances the columns, so
  a 28-card Creature stack never holds a screen-high hole beside a 1-card
  Commander. On a phone there is exactly ONE stack, as wide as the screen: a
  stack is a name strip you have to be able to read, and the −/+ stepper hides
  there because the screen sets the size.
- **One reading order: every view, and the carousel (2026-09-24).** The deck
  has ONE order: the lens's group order (Commander first), then the sort
  inside each group. List, grid and stacks all show it, reading down each
  column in turn, and the preview carousel opened from any of them steps
  through it. Balance never buys reordering: `packSections` and `packStacks`
  both split with `packInOrder` (contiguous runs, the tallest column as short
  as any split allows, then the most even). The largest-first / shortest-column
  packing both used before put Sorcery ahead of Enchantment and Instant in the
  list, interleaved the stacks differently again, and sent the carousel to a
  card in another column. `deck-display-rows.pack.test.ts` and
  `DeckDisplay.stacks.test.tsx` assert that flattening the columns gives back
  the input order.
- **The grid packs small groups into shared rows (2026-09-24, T135).** Every
  group used to start its own row, so a one-card Commander stranded a row of
  empty slots and so did a four-card Planeswalker group. The grid is now one
  set of columns for the whole deck (`--grid-cols`, the zoom step's column
  count at the grid's measured width) and each group spans only its own cards
  (`gridSectionSpan`), so Commander + Planeswalker and Instant + Sorcery share
  rows while a group bigger than a row takes the full width and wraps inside
  it. The order holds, left to right then down, and `grid-auto-flow: dense` is
  banned in that CSS (a test pins it). Each group spans two rows as a row
  subgrid, so a header that wraps moves its row's cards down together. A group
  under three columns wide drops its price from the header; a collapsed or
  empty group takes the full width. On a shared grid the tiles are the chrome,
  so grid-view groups lose their framed box ([§ Layout system](../STYLE_GUIDE.md#layout-system-t135--one-build-of-each-pattern-every-screen), one frame per
  surface). On a phone (three columns) Commander still stands alone when the
  next group does not fit beside it, which is fine: the commander is special.
- **Each out-zone pile is ONE stack.** Sideboard and Considering are each a
  single column under an ordinary stack header, side by side when the width
  allows, not a stack per type (see "Sideboard and Considering are deck
  sections" above).
- **A stack header is words.** No collapse chevron (the column is already its
  own collapse, one card open at a time) and no type glyph (the column below it
  is a wall of card art). Name, count, price.

### Amendment: the card inspector (2026-09-20)

The rail above lasted one day. It showed name, mana, type line and price — three
of which the row already carried — so it spent a permanent 232px column and paid
back a smaller, further-away copy of the floating peek it replaced. On a 2000px
display with four list columns, hovering column one put the card ~1400px away.
The rulings that came out of it:

- **A persistent panel earns its width only by showing what the row cannot.**
  Oracle text is the load-bearing one: before this, a card in the deck view
  could not be read without opening the full-screen preview. Ownership (which
  binder, how many copies allocated) is the second, and it is the thing neither
  Moxfield nor Archidekt can show.
- **Hover previews, a pin holds.** Hover is for glancing and must stay cheap;
  reading rules text is sustained, and a pointer crossing another row must not
  end it. Row click still opens the preview carousel — repurposing the app's
  most-used click to mean "pin" was rejected.
- **One surface for every view mode.** A list-only rail plus a grid-only
  floating peek is two answers to one question. `.deck-body-layout` wraps the
  whole deck body and the grid/stacks tiles carry `data-peek-name`, so the same
  delegated handlers feed the inspector everywhere.
- **Left is fine when the panel is permanent, and only then.** The toolbar and
  filter-chip bands stay full width above the body, so only the deck body
  insets and the page keeps its gutter alignment (Moxfield's arrangement). A
  panel that appeared and disappeared would have to sit on the right: mounting
  it on the left would shove every row sideways mid-read.

### Amendment: the inspector from 1024px (2026-09-25)

The inspector first mounted at 1440px, and between 1024 and 1439 the floating
hover-peek stood in. In that band the deck list spans the page, so the peek had
no gutter on either side: its placement clamped it to the viewport's left edge,
straight over the card names, including the one under the pointer. The ruling:

- **A hover preview never covers what it previews.** If there is no empty space
  for a floating card, don't float one. Make room for a panel instead.
- **The inspector owns desktop preview from 1024px.** The list measures its own
  width, so beside the 300px panel it just drops to fewer columns. Below 1024 (or
  on a coarse pointer) the row thumbnail, click→carousel and touch long-press peek
  carry it. `deck-inspector-gate.test.ts` pins the JS query, the CSS hide rule
  and the hover hook's gate to one breakpoint, and fails if a floating hover
  peek comes back to the deck page.
- **Don't ship a layout picker.** Archidekt's four-layout carousel is a
  confession that no default was chosen. Choose the default.

## Deck diff rows (T22/E173)

Any surface that shows "what changed" between two card lists — the compare
page and the deck resync review — renders through **one shared component**,
`components/deck/DiffCardRow.tsx` (`DiffCardRow` + `DiffGroup`), not a
per-surface reimplementation. First shipped on `/decks/compare`
(`DeckComparePage.tsx`); E173's paste-and-diff resync (`BulkEditDeckDialog`'s
`mode="resync"`) reuses it verbatim for its review step rather than
re-deriving diff markup a second time.

- **Icon + word, never color-only** — each row is a glyph (`+`/`−`/`~`) and a
  group heading word ("Added"/"Removed"/"Changed"); the tone color is
  additive on top of that, never the only signal.
- **Group by tone, not by row.** `DiffGroup` collapses past 8 rows with a
  "Show N more" toggle — a diff of a 100-card deck must not dump 100 rows
  inline.
- A new diff surface reuses `DiffGroup`/`DiffCardRow` against whatever
  `CardDelta[]`/`CardListDiff` it computes (`lib/deck/deck-diff.ts`'s
  `diffDeckCards` for a deck-vs-deck compare; `lib/deck/deck-bulk-edit.ts`'s
  `buildResyncCardDiff` for a deck-vs-pasted-list resync, which — unlike
  `diffDeckCards` — counts every zone, not just commander + mainboard, since
  a resync's paste can silently drop a sideboard/considering card). Only the
  counting differs per surface; the rendering never does.

**Paste-and-diff flows skip a source picker when the parser already
auto-detects the layout.** E173's resync considered a Moxfield/Archidekt/
Other picker before pasting, styled on `.settings-theme-grid`'s wrap
pattern (the price-currency toggle of the time didn't reach 44px and clipped
at 320px, so it wasn't eligible either way). It was dropped: the bulk-edit parser
(`parseBulkEditText`) already auto-detects both sites' export layout
(section headers, Moxfield's `*F*`/`*E*` finish tags) with no format
selection needed, and neither site's identity is otherwise actionable — the
app can't fetch from either, so a "which site" answer has nothing to do
with. Don't add a picker for information the UI can't use; the hint copy
names both sites as examples of where to paste from instead ("Moxfield,
Archidekt, anywhere").

## Comparing two of anything (2026-09-15)

`/decks/compare` shipped as two deck-detail panels stacked side by side, which
left the reader doing the comparison. The rules that replaced it apply to any
A-vs-B surface:

- **A value never appears without the name of the side it belongs to.** The
  compare table's `thead` carries the two deck names over the two value
  columns; a bare `19 → 16` is unreadable. Where a `A → B` row shape survives
  (the changed-copies diff group), a small caption under the heading names the
  direction (`DiffGroup`'s `caption` prop).
- **The app computes the difference; the reader doesn't.** Every paired number
  gets a third "Difference" column, and paired charts draw both sides in one
  chart (the compare page's mana curve is one histogram with two bars per mana
  value, keyed by color to the deck names) rather than two charts to eyeball
  against each other.
- **A delta is computed from the DISPLAYED values, not the raw ones.** Avg mana
  value rounded to `3.2 → 3.1` but subtracted raw printed `−0.0`, which is
  nothing. Round first, subtract second; a zero delta reads as the word
  `same` ([§ Money deltas](data-display.md#money-deltas--value-sparklines-e76)' "zero reads as a word", generalized).
- **"Added" / "Removed" is version language.** Two sibling decks are not a
  revision of each other — the compare page titles its diff groups
  `Only in <deck name>`; `DiffGroup`'s default tone words stay for the resync
  surface, where one list genuinely IS a revision of the other.
- **Don't render a row that is zero on both sides.** The old two-up mana
  panels showed `White · Demand 0 · Sources 5` on a Golgari deck. Filter to
  the colors/types/roles at least one side actually has.
- **A missing value says what to do about it**, not `—`: "Not estimated yet —
  open the deck to analyze it."

## Verdict badges

The Tune-board panels each recommend a card action ("add this", "cut that",
"swap for the owned one"). They speak **one vocabulary** via the shared
`components/deck/VerdictBadge.tsx` chip — a `999px` pill (per the Pills rule)
plus an optional plain-English reason. Don't hand-roll a panel-specific decision
chip; reuse this so the boards read as one system, not five badge styles.

The vocabulary is a fixed **verdict → word → tone** map (tones are the status
tokens from `styles/tokens.css` — reuse them, never new hues):

| Verdict      | Word       | Tone    | Token          | Means                           |
| ------------ | ---------- | ------- | -------------- | ------------------------------- |
| `add`        | Add        | green   | `--success`    | safe gain (Engine/Optimize/gap) |
| `cut`        | Cut        | red     | `--err-text`   | remove it (Optimize removals)   |
| `substitute` | Substitute | blue    | `--info`       | lateral owned swap              |
| `budget`     | Budget     | gold    | `--warn-text`  | a real tradeoff / power loss    |
| `owned`      | Owned      | accent  | `--accent`     | already in your collection      |
| `hold`       | Hold       | neutral | `--text-muted` | flagged but intentionally kept  |

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

**Inclusion-% tint: never red (E88).** The inclusion percentage on suggestion
rows (`inclusionColor` in `DeckCardRow.tsx`) is hue-tinted amber→yellow→green
across 1–100% and **never renders red at any percentage** — a 1–9% real
inclusion is a "deep cut" pick (spicy, not broken), not an error, and red stays
reserved exclusively for the Cut verdict tone. 1–50% reads amber→yellow
(neutral/caution); ≥50% ramps yellow→green. (Superseded ruling: an earlier
version of this scale used red below 10% — that collided with the "0%/missing
reads as a bug" problem E88 fixed, so it's gone.) A real percentage is only
ever passed to `inclusionColor` for a genuine ≥1% signal — see the "No-signal
inclusion" ruling below for 0/undefined.

**No-signal inclusion is "Off-meta", never a bare 0% (E88).** EDHREC
inclusion is a popularity signal, not a quality verdict — a card can
legitimately sit at 0% or have no EDHREC data at all because it's a combo
piece, a Scryfall role-fill, a collection substitution, or an off-meta synergy
pick, not because "the generator glitched." Every surface that shows an
inclusion % (`DeckCardRow`, `DeckDisplay`, `DeckCardPreviewMeta`,
`EnginePanel`, `CoachFeed`, `DeckAnalysisPanel`, `CardSearchPanel`) routes
through the shared `classifyInclusion` (`lib/deck-analysis/inclusion-label.ts`), which
treats `0`, `undefined`, and `null` as the exact same "no play-rate evidence"
state: **never** render "0%"/"In 0% of decks", and never go silently blank
where a percentage would otherwise appear (blank reads as forgotten data;
"Off-meta" reads as intentional) — reuse the existing muted+italic
`is-offmeta` treatment, never a red/error tint. On a surface with no
"why"-pipeline (`DeckDisplay`, `DeckCardPreviewMeta`), the Off-meta chip
carries `OFFMETA_TOOLTIP` as its `title` so the verdict doesn't read as an
unexplained gap; rows that already show `WhyBreakdown`/a reason line don't
need it — the reason already carries the explanation. One exception: basic
lands are excluded entirely (never shown as a percentage or "Off-meta") since
the generator never scores them for EDHREC inclusion in the first place —
that's "not applicable", not "no signal".

## Commander finder (T168)

Every commander picker is one component, `CommanderSearch`: the generator,
Brew, the editor's "Choose a commander" sheet and both import dialogs. It
replaced three tabs (By name, By playstyle, My collection) that each answered
one question and made you pick which. Rulings:

- **One result list, filters that combine, one sort.** A search box, a color
  row, a playstyle row and an **All commanders / In my collection** switch.
  "Golgari aristocrats I own" is one query, never a tab choice.
- **Plain words search the name, type line and rules text; Scryfall syntax
  passes through.** A tile matched on its type or rules text quotes the line
  with the match highlighted ("Rules text: … Sacrifice …"). That line is how a
  player learns the box reads rules text; the syntax hint appears only once
  they type.
- **A playstyle is one rules-text pattern shared by both engines.** Each entry
  in `lib/deck/commander-playstyle-index.ts` carries an `oracle` regex source that
  Scryfall runs as `o:/…/` and the local classifier runs as a JS RegExp, so a
  commander Scryfall returns for a playstyle is always classified under it
  locally too. Typal has no pattern and uses `otag:typal` plus a local "names
  its own creature type" check. EDHREC's crowd list for the tag (about 24
  commanders) ranks first; the pattern supplies the long tail.
- **Several playstyles are OR, ranked by overlap.** AND nearly always comes
  back empty; commanders matching every chosen playstyle rank first. A chosen
  playstyle's one-line meaning shows under the toolbar, which is how "Wheels"
  or "Aristocrats" gets explained on touch.
- **In my collection is local, instant and offline**, over the rules text and
  type line every owned row already carries, through the same engine as the
  add-cards panel (`lib/search/deck-add-search.ts`). It never asks for a color first.
- **One coverage number.** "How much of this deck do you own" is readiness
  (top EDHREC staples owned): a "You own N%" fact on every tile, and under the
  **Most of the deck owned** sort a `MeterBar` with "You own 52 of its 90
  staples". Coverage and readiness used to show side by side as two numbers
  for one question; the second one is gone. It needs `MIN_COLLECTION_SIZE`
  cards to say anything and never runs for Pauper Commander.
- **Scoring a whole list re-sorts in steps.** Under the coverage sort every
  result is scored four at a time; the order refreshes every 12 scores and on
  completion, never per score, so tiles don't jump under the pointer.
  Unscored commanders sort last. Progress is in the one `role="status"` line.
- **Picking under In my collection + Most of the deck owned builds from your
  cards only** (E283), and the finder says so under the toolbar while it
  applies: "Picking from here builds with only your cards."
- **Worth buying the commander for.** Under that same sort, popular commanders
  you don't own whose decks your collection covers, with the price, in their
  own labelled section below the results.
- **An empty result names the filter to drop** as buttons ("Search all
  commanders", "Within white", "Remove Reanimator"), never "No commanders
  found". A failed fetch is its own state with Retry, never an empty list.
- **On a phone the filter rows fold into a Filters button** with a count, and
  the active filters show as removable chips (`FilterChipsRow`). The All / Mine
  switch stays out: it is the finder's main choice, not a filter.
- **Tile facts, in order:** In collection, You own N%, the playstyles (the
  ones you filtered by lead), EDHREC deck count. The pips carry the
  combination's name in words ("Golgari"), because a pip names itself only on
  hover.

## Deck analysis tabs — first-impression states

**Skeleton while analysis is pending (UX-310).** The Tune and Power tabs render
a skeleton placeholder while the async commander-deck analysis (`useCommanderBracketAnalysis`)
hasn't yet produced its first result. The skeleton uses the shared
`skeleton-shimmer` keyframe from `styles/footer-card-preview.css` — do NOT redeclare it (the
`motion-tokens.test.ts` guard enforces a single declaration). The CSS class
family is `deck-analysis-skeleton` / `deck-analysis-skeleton-bar` / etc., in
`styles/deck-builder-skeleton.css`. The skeleton disappears as soon as any lane content
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

| Tier           | Where it lives                                     | Examples                                                          |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| **Band words** | Cross-panel: heroes, lane headers, stat-strip, NBM | "Dialed in", "Needs work", "Optimized", "Exhibition"              |
| **Numbers**    | Inside their own panel only                        | `78/100` in BracketBreakdown's Power signal table; sub-score bars |
| **Bracket**    | A number but also a named tier — use "Bracket N"   | "Bracket 3 · Upgraded" in the hero; never just "3"                |

**One grading system.** A letter grade (`A`, `B+`) is a third dialect — it has been removed from the stat-strip. Don't re-introduce letter grades in cross-panel summaries. The `deckGrade` prop exists for backwards compatibility but is not rendered. This applies by name to **Deck Compare** (the bracket columns show bracket number + `BracketVerdictStrip` only — not `gradeLetter`) and to **SharedDeckView**'s subtitle (the most public surface — no ` · B+`). Both regressed and were re-fixed; don't let the letter creep back into either.

**Renamed terms (settled UX-315):**

| Old label  | New label    | Surface                               | Rationale                                                                             |
| ---------- | ------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| Soft score | Power signal | BracketBreakdown panel heading + aria | "Soft score" collided with Build health vocabulary; "Power signal" is self-explaining |

**Anti-patterns this rule kills:**

- Showing a raw 0–100 number in the stat-strip or a lane header (panel-internal; use the band label)
- A third grading scale (letter grades) appearing next to band words and bracket numbers
- "Soft score" being confused with Build health's subscore bands

## Bracket: the owner's word, the Estimate is computed (2026-09-24 ruling)

A deck's **Bracket** is what its owner states it plays at — what they'd say
at the table. The **Estimate** is the app's computed read on the same deck.
They are two different facts and the copy never blurs them into one:

- The stated bracket is never called "target" or "manual" anywhere in the
  UI. "Target" implied a goal the deck was aiming for and hadn't reached;
  it's the opposite — it's the owner's own claim about what the deck already
  is. "Manual" read as a caveat on the number, as if the computed one were
  more legitimate. Both readings are wrong: a stated bracket is the primary
  fact, the Estimate is supporting evidence.
- Show both only when they differ. On Auto (no stated bracket), the
  headline **is** the Estimate — there's nothing to disambiguate, so no
  second line. Once a bracket is stated, the headline reads "Bracket 3 ·
  Upgraded" (the STATED value, formatted per the "Bracket: A number but also
  a named tier" rule above) and, only when the Estimate disagrees, a second
  line reads "Estimate: Bracket 4 · Optimized" beneath it.
- The estimate's hard-floor reasons ("because: …") always show, whether or
  not a bracket is stated — they explain the Estimate, not the headline.
  They sit directly under whichever line shows the Estimate, so a plain
  "because: …" reads as belonging to it; don't prefix "estimate" (the line
  above already says it, and "Estimate … estimate because" stutters).
- **Bracket 1 (Exhibition) is never "above target."** The estimator never
  returns 1 — Exhibition is a theme-first build intent the estimator can't
  confirm from card content, so it floors at Core (2) (`CORE_BASELINE` in
  `@spellcontrol/deck-metrics`). A deck stated at Bracket 1 whose Estimate
  reads Core reads as "Exhibition" (neutral tone, `EXHIBITION_BRACKET_NOTE`)
  — not "plays above" — because there is no lower floor to trim toward. Only
  once the Estimate clears Core (3+) does the verdict read "Plays above,"
  and even then the coaching language says cuts bring it to the Core floor,
  never to Bracket 1 itself.
- **Source + borderline.** `bracketSource(est)` (`@spellcontrol/deck-metrics`)
  names where the Estimate comes from — `'contents'` (a hard floor set it),
  `'power'` (the power signal lifted it past its floor, bump or cEDH alike),
  or `'baseline'` (neither fired; it sits at Core by default) — and the
  Bracket panel says so in one plain sentence next to the verdict strip. The
  sentence always names the Estimate ("The estimate comes from what's in the
  list."): under a strip that shows a stated B2, "Set by what's in the list"
  read as if the list had set the owner's number.
  `bracketBorderline(est)` flags when the power signal sits within
  `SOFT_SCORE.borderlineWithin` of the threshold that could move the deck;
  render it as a compact neutral "Borderline N/M" pill (the Tag chips plate:
  `--surface-raised` / `--text-secondary` / `--border`, never `--accent` —
  it's a hint, not a verdict) next to whichever line shows the Estimate.
- **A stated bracket shown to someone other than the owner carries the
  Estimate too (2026-09-24 amendment).** The rule above covers the owner's
  own deck page. Everywhere else that reads a bracket for a LIST or for
  someone else to see — a Discover tile, `DeckLibrary` (a stranger's or
  friend's shelf), the online lobby's seat card, the deck picker, someone
  else's public deck header — used to show only the effective bracket
  (`stated ?? estimate`), so a deck stated at Bracket 2 that estimates
  Bracket 4 read as a plain "Core" everywhere but its own Power tab. Without
  the Estimate riding along, a stated number can hide what the list actually
  estimates. Same "only when they differ" rule as the owner's page: on Auto
  there's nothing to disambiguate. Two compact forms, one shared formatter
  each (`frontend/src/lib/deck-analysis/format-bracket-label.ts`):
  - **Badge form** (`bracketBadgeWithEstimate`) — bare tier words, no
    "Bracket N" prefix, matching the existing `deck-format-badge`/
    `deck-bracket-badge` convention: "Core · est. Optimized". Tight tile
    badges at phone width have no room for two "Bracket N" numbers side by
    side (phone chrome density — control rows and badge rows fit by width,
    not by dropping content).
  - **Text-line form** (`bracketTextWithEstimate`) — for a surface that
    already spells out "Bracket N" as running text: "Bracket 2 · est. 4"
    (the owner's deck hero, a public deck header, a lobby seat, the deck
    picker).
  - **Accessible name** (`bracketAriaWithEstimate`) — spells both out in
    plain words for the element's aria-label/aria description: "Bracket 2
    stated, estimate 4". A badge never carries its own separate aria-label;
    it rides in the tile's/row's existing accessible name.

### The Bracket panel: Settled, then the Judgment (2026-09-25)

Four calculators read the same list and split 2–2 on one question (is a
Ruthless-rated two-card combo "early" in a list with two tutors?), each taking
a side without saying so. Players trust what the rules settle and distrust
the rest, so the panel labels which is which:

- **Settled** heads the floors ("Settled · At least Bracket 3"): what the
  rules fix. "At least" whenever the estimate sits above it or could.
- **Judgment** appears only when the estimate is borderline
  (`bracketBorderline`), and argues the call both ways: "Reads as 4" and
  "Reads as 3", one line of evidence each, ours marked "Our call" in words.
  Two sources: a Bracket 4 that rests on Spellbook's Ruthless rating alone
  (`ratingOnlyComboFloor`: its combo is shown as Settled at 3, and the
  question is whether it's early), or a power signal near a line. A bracket
  the rules settle gets no Judgment block, whatever the deck.
- The sides are hairline columns under a rule (outlines belong to controls);
  ours takes a 2px `--accent` rule. The Settled/Judgment labels are pills;
  Judgment wears the warn plate, the words carry the meaning.
- **Spellbook's words get a gloss every time.** "Ruthless, its rating for
  combos that belong at Bracket 4 and up." A player can't be expected to
  know Spellbook's scale.
- **The Judgment ends with the owner's answer** ("Which does your table play
  it at?", a `SegmentedControl` of the two brackets). Picking one states the
  deck's Bracket: it is the stated-bracket control, not a second feedback
  system, so the hero reacts per the ruling above. Owner only.
- **Tell your pod** closes the panel for the owner: one copyable sentence
  (`lib/deck-analysis/bracket-pod-line.ts`) with the bracket, Game Changers by name, the
  deciding combo, land denial, extra turns, and what the deck does NOT run.
  It speaks in the owner's voice once they state a bracket the estimate
  disagrees with. Copy confirms with the app's toast; Share only where
  `canShare()`.
- **At the table** sits above the pod line for the owner (`BracketTableRead`,
  `lib/play/table-read.ts`): tracked wins against an even share (one over the pod
  size, per decided game), the even share ticked on a `MeterBar`. Below 10
  games it says how many more give a read, and never guesses. Twice an even
  share reads "may play above the tables you take it to", half or less
  "below". It never moves the estimate and never names a bracket: the
  opponents' brackets are unknown. The seat rule (`seatCountsForDeck`) is the
  one the Table record uses, so the two can't count different games.

### The combo clock says what it measures (2026-09-25)

"Typically kills by turn 35" was right for the model and read as a bug, and
"kills" was wrong for an infinite-turns lock. The clock now:

- **Says assembled, never kills**, and leads with the early turn:
  "The combo is assembled by turn 6 in 4% of games, and in half of them by
  turn 35" (`assemblyClockSentence`, shared by Win conditions and the
  practice-hand panel). The bracket question is whether a combo is early,
  which a median alone can't answer.
- **Shows the shares as a fixed strip** (turns 4, 6, 8, 10, 12, 15), so two
  decks compare column for column; the strip is a labelled `role="img"`, the
  sentence carries the reading.
- **Names its scope**: drawing, tutoring and casting the pieces over 1,000
  goldfish games; combat and poison damage aren't simulated.
- **Is seeded from the list** (`librarySeed`), so the same 99 always reads the
  same, and the Bracket Judgment's "Reads as 3" quotes the same figure for the
  deciding combo. Two panels quoting one number must not disagree.
- Ends in words, not rounding: "under 1%", "over 99%", "in none of 1,000
  games", "in every game".

## Deck-analysis band words

### Avg mana value (curve)

Three words map a deck's avg-CMC pacing, rendered beside the number in `DeckCurvePhases`:

| Band word   | Typical avg CMC | Pacing keys                      |
| ----------- | --------------- | -------------------------------- |
| `lean`      | < 2.8           | `aggressive-early`, `fast-tempo` |
| `balanced`  | 2.8 – 3.5       | `midrange`, `balanced`           |
| `top-heavy` | > 3.5           | `late-game`                      |

The mapping is a pure exported function `avgCmcBandWord(pacing)` in `DeckCurvePhases.tsx`. Do not duplicate the logic elsewhere.

### Salt score (EDHREC)

Four words map a card's EDHREC salt score (0–4 scale), rendered in `SaltiestPanel` beside each raw score:

| Band word        | Score range |
| ---------------- | ----------- |
| `table-friendly` | < 0.5       |
| `mild`           | 0.5 – 1.4   |
| `spicy`          | 1.5 – 2.4   |
| `polarizing`     | ≥ 2.5       |

The mapping is a pure exported function `saltBandWord(salt)` in `SaltiestPanel.tsx`. The avg-salt footer also shows the band word for the deck-level average.

---

## Suggestion feeds (Coach tab — UX-401)

The Coach tab (`?view=tune`) is the one prescriptive surface: a ranked,
filterable list of moves the user can apply to improve their deck. The
design rulings below are binding for any future work on the feed.

### Tab posture (UX-402)

The tab reads top-to-bottom as **verdict → work surface → catalog → extras**,
and every zone wears the panel vocabulary the other analysis tabs already use:

1. **Next best move** hero — the verdict. Always expanded, max 3 moves.
   **Every numbered step has an action** (2026-09-25, E415): Add, Fill, a
   jump to another tab, or, when the move points at the tab you are on, a
   "Show upgrades" / "Show gaps" button that opens that lane. A move with
   nothing to do ("Limited data") is a muted note under the steps, never a
   numbered step with an empty right edge.
   The steps are hairline rows inside the hero, not boxes inside a box; the
   first step leads by its filled, tier-coloured rank chip and a larger
   title, not by a lifted card with a coloured edge.
2. **"Suggestions" panel** — the feed (chips + strips + rows) sits inside the
   shared `.deck-stats-panel--wide` chrome with a `.deck-stats-panel-title`
   header. A bare chips-and-rows zone on the bento reads as an unstructured
   wall; the panel chrome is what gives the tab the same scannable hierarchy
   as the Stats/Power bentos.
3. **Browse catalog** (`Browse all EDHREC suggestions` disclosure) — sits
   **after** the Suggestions panel, never between the filter chips and the
   rows they filter (there its all-caps summary read as a heading for the
   feed below it).
4. **AI strips** — both Coach-tab AI panels take the E244 insight-strip
   posture (see "AI-written content"); a list surface never mounts a full AI
   panel uninvited.

**The feed shows one bounded page.** `ROW_CAP` (8) rows render, then a
full-width quiet **"Show all N suggestions"** expander (chevron flips,
`aria-expanded`, 44px coarse target) reveals the rest; it re-collapses
whenever the lane or a cross-cutting toggle changes. An unbounded "All" lane
rendered 30–60 rows and buried the catalog and the AI surfaces — progressive
disclosure is the overflow-ladder rung for a ranked feed: the ranking already
promises the best rows are the first ones.

### Row anatomy

Every suggestion row is a `DeckCardRow` instance and contains, from left to
right:

1. **Thumbnail** — card art (CDN, cached via `useCardThumb`). Tap opens the
   card carousel (the complement view). On a swap row, the outgoing card art
   sits left of an arrow, dimmed.
2. **Body** — card name (bold, `--text-sm`) + verdict chip(s) (shared
   `VerdictBadge`) + plain-English reason (`--text-xs`, `--text-secondary`,
   3-line clamp). Inclusion % is hue-tinted per the verdict badge's
   red-<10%-only rule. The body text is **non-interactive** — only the
   thumbnail, action buttons, and the optional **Why disclosure** toggle
   (below) are tap targets. The reason line gets an optional expandable
   breakdown when the change carries `whyFactors` (see Why disclosure).
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

### The feed is a table (2026-09-25, E415)

The Suggestions panel's rows are hairline rows, not bordered cards inside the
panel ([§ Surfaces: one frame](../STYLE_GUIDE.md#layout-system-t135--one-build-of-each-pattern-every-screen)). From a 48rem feed each row is a grid with a
quiet column header (Card / Why / Played in): the art, the name with its
chips, the why (reason, "AI agrees", Why this?), the played-in cell (the
tinted "In 71% of Sram decks" over a `MeterBar` in the same `inclusionColor`,
one scale down the column), then Fit & cut and the primary action. The row
body steps aside with `display: contents` so its parts land in their columns;
the art column widens to fit a swap's out → in pair when the list has one.
Under 30rem the body takes the row's full width and the actions sit on their
own line at the right.

- **The thumb is the art crop** (`DeckCardRow artThumb`, 52px wide at 4:3),
  not a whole card shrunk to 42px. The swap panels keep the card.
- **Synergy is a chip, only above zero:** `Synergy +34%` in the accent
  `VerdictBadge`. EDHREC's synergy is a −1..1 fraction; `synergyPct` in
  `lib/coach/why-factors.ts` is the one conversion. Printing it rounded bare put a
  green "+0% synergy" on every row.
- **The rows name the commander by its short name** ("Sram", not "Sram,
  Senior Edificer"), so the played-in line holds one line in its column.

### Why disclosure (the reasoning behind a suggestion)

The differentiator is **explainable** editing: a cut/swap suggestion must be
able to show _why this card_, in plain English, from signals the engine already
computed — never an opaque "weak slot". When a `Change` (or `RankedCut`) carries
`whyFactors`, the shared **`components/deck/WhyBreakdown.tsx`** renders a quiet,
tappable disclosure under the reason line.

- **Disclosure, not tooltip.** This is per-row _reasoning_ (multiple factors,
  primary content the user scans while deciding), so it is an inline
  `aria-expanded` toggle that stays open — **not** an `InfoTip`. `InfoTip` is for
  a one-off concept/jargon gloss (one per concept); reasoning that differs per
  row would be both clutter (an `ⓘ` on every row) and touch-hostile in a
  transient bubble. The two patterns don't overlap — pick by "explaining a term"
  (InfoTip) vs "justifying this row" (WhyBreakdown).
- **Collapsed by default** so the feed stays scannable; the heavy reasoning is
  opt-in. Toggle copy is a question in sentence case ("Why this?" / "Why cut
  this?"), flipping to "Hide reasoning" when open.
- **Factors are grounded and tone-tagged.** Each factor is `{ text, tone }` with
  `tone` ∈ `pro | con | neutral`, shown as a colored dot (`--success` /
  `--warn-text` / `--text-muted`). Every factor must trace to a real signal —
  never a fabricated comparison (don't claim "+37% vs X" without X's number).
  A combo-break is always surfaced first as a `con` so a cut never blindsides.
- **Token-driven** so it inherits the always-dark card-preview panel's white-alpha
  remap and the light Tune lanes alike. 44px touch target on coarse pointers; the
  only `:hover` is capability-gated; the chevron rotation honors reduced-motion;
  `:focus-visible` ring like every interactive control.
- Reuse it anywhere a suggestion needs a "why" — the in-deck Swap panel, the
  `CardFitPanel` audition cuts, and the full-deck `DeckSizePrompt` options all
  feed it the same `whyFactors`, so the explanation reads identically everywhere.

**Substitute reasons are fixed vocabulary (E517).** The owned alternatives,
Swap this card and Similar cards rows take their factors from
`services/substitutes/reasons.ts`, and every line reads off a fact the ranker
scored:

- `Same effect: {trigger}, {effect}` (pro, first) when the two cards share a
  trigger and effect aimed at the same player: "Same effect: whenever a
  creature you control dies, each opponent sacrifices a creature". The words
  come from the replaced card's own facts; a tuple with no phrasing reads
  `Same effect as {card}`, never a paraphrase.
- `Pays off your {engine} engine: N cards feed it` / `Feeds your {engine}
engine: N cards pay it off` (pro) when at least 3 deck cards support the link.
  `{engine}` is the synergy axis's name, lower-cased ("sacrifice").
- `A common substitute for {card} on EDHREC` (pro), the collection lane's
  existing line, reused verbatim.
- What the substitute gives up, as cons: `Hits creatures only`, `Sorcery
speed`, `Costs 2 more`, `Watches opponents' creatures, not yours`. Their
  mirror images are pros: `Instant speed`, `Costs 1 less`, `Same mana cost`.

Pros lead, the lane's own factors sit in the middle, cons close the list.

### Tiered ordering

The ranker (`lib/coach/coach-rank.ts`) orders moves in three tiers, owned-first
within each tier:

| Tier                        | Trigger                                                                | Examples                                      |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| **Tier 1 — severe deficit** | a gap/upgrade move whose target `roles` or `cardFit` sub-score is < 60 | a missing removal staple when `cardFit` is 55 |
| **Tier 2 — quality**        | the move's target is the weakest `PlanScore` sub-score and it's < 75   | ramp gap when `roles` is the weakest signal   |
| **Tier 3 — polish**         | everything else                                                        | combo completions, land swaps, budget swaps   |

**A row is promoted by what it fixes, never by the lane that carries it**
(T171, 2026-09-30). A missing staple targets `roles` (when it has a role) and
`cardFit` (unfilled staples are `cardFit`'s gap term); an optimizer
"Fills {role} gap" pick the same; an optimizer EDHREC pick `cardFit`; a
synergy pick for an engine the deck is invested in `strategy`; an owned
stand-in `roles`. A synergy pick for an engine the deck has only started
(`budding`), a manabase add (mana, flex or color fix) and every land, budget
and similar row target nothing and stay tier 3. The old lane mapping put every
upgrade row on `cardFit`, so "rewards cycling" picks for Atraxa rode a low
`cardFit` into tier 1 over the staples the deck was missing.

**Within a tier:** owned before unowned, then rows that make the deck better
before a budding-engine pick or a budget swap (a budget swap saves money, and
its play rate is the cheaper card's, so it can't outrank a staple on that
number), then EDHREC play rate high to low (the one signal every add lane
shares). `deltaScore` only breaks ties: land swaps are the only rows that
carry it, on their own scale, and sorting on it first put every land swap
ahead of every staple.

**A role gap is read off the live deck.** A "Fills {role} gap" row whose role
is already at target is dropped, and a staple for a met role targets `cardFit`
only, not `roles`: the analysis can predate the user's last edits, and a gap
the deck has since filled is not a reason to promote anything (T171 re-gate).

**A met role is not a gap to fill** (T171 round 3). A missing staple whose role
is at or over its target isn't offered, unless it is a staple mana rock or a
staple of this commander's page (40%): Sol Ring and Arcane Signet still come
in, as an upgrade inside the role (see the cut floors below). Blasphemous Act
reached a go-wide Isshin deck at 2 of 1 wipes as an "EDHREC staple" before
this. **A deck that builds a board is offered no symmetric wipe**: Coach reads
the generator's own rule (E109/E112, `isBoardCentricPlan` and
`isOneSidedWipe`), so Ruinous Ultimatum can come in and Blasphemous Act can't
(`services/deckBuilder/coachWipes.ts`).

**An off-page Upgrade pick needs the deck to enable it.** A synergy payoff with
no play rate on this commander's page is offered only when the deck makes its
condition happen: a payoff for opponents discarding needs cards that make them
discard, a payoff for your own discards needs looting, a convoke card needs a
creature-dense deck. Waste Not reached five decks whose only discard was their
own looting. A land search is never a card-advantage staple (Elven Passage).

**An add with nowhere to go ranks last** (T171 round 3). On a full deck, an add
whose replace prompt has no suggested cut (every weaker card is a plan card,
at its role target, or owned on a partial deck's floor) still shows and still
says what it adds, but ranks below every row that has a cut or needs none,
tiers included. The rank reads the prompt's own logic
(`lib/coach/replace-cuts.ts`), so the two never disagree; the prompt then
reads "No suggestions. Pick a card below." A combo completion keeps its place,
and it always gets a suggested cut (see the cut floors below).

**The Cuts chip reads weakest first:** spell cuts before land tuning (a
basic-for-basic rebalance is not a card the deck is worse for running), then
play rate low to high, a card missing from the commander's page first.

(Deck-size and missing-win-condition _structural_ alerts have no concrete card
move, so they live in the NextBestMove headline above the feed, not as ranked
rows.)

**No raw score numbers in the UI** — the ordering is felt, not displayed, to
avoid implying false precision.

### The deck's own settings bound the feed (T171)

A generated deck keeps its build settings (`generationContext.customization`):
per-card price cap, budget, rarity cap, Game Changer limit, target bracket
(the stated `bracketOverride` wins over the built one) and collection
strategy. **A move that breaks one is not shown**, in the feed, the upgrade
plan or the Next-best-move hero (`lib/coach/deck-settings-fit.ts`). The check
reads the incoming card's price and rarity off the row (the analysis stamps
both); data it doesn't have never hides a move, except a price: **under a
budget or a per-card cap, a card with no price is not shown** (`unpriced`),
since reading it as free is how a $50 deck was once handed an unpriced
Goblin Lackey. Basics and owned cards the budget ignores are exempt. An add
to a full deck assumes the least favourable cut: nothing freed for the
budget, and an owned card out for a partial deck's owned share only when every
card in it is owned. With an unowned card in the deck, the replace prompt
offers only cuts that keep the deck's settings (`cutKeepsSettings`), so a
missing Arcane Signet isn't hidden from a 50%-owned deck sitting on its floor.

**The Budget lane runs only for a deck with a budget or a per-card cap**
(`coachSettings.savesMoney`). A Yuriko deck with no budget had Underground Sea
swapped for Temple of Deceit by it. Within a budget, **a swap that costs power
is shown only when the deck can't afford the card it replaces** (its settings
would hide that card's re-add); with room left, the lane offers drop-ins only,
and a drop-in never trades away a card Coach would suggest straight back or a
utility land (`coach-changes.ts`, `costAnalyzer.ts`). Every budget row says
what it trades in words the badge abbreviates ("Same job for less", "Cheaper,
played a little less", "Cheaper, a step down in power"). The cost plan reads
each current card's play rate off the deck's page: it used to read 0%, so
every swap in the same curve slot claimed to "play nearly the same".

When the settings empty the feed, the empty state says so instead of "This
deck looks tuned": the tagline is "Nothing to coach within this deck's
settings." and the hint names the one setting behind every hidden move, or
falls back to the reason-agnostic "Every suggestion breaks one of this deck's
build settings." when it's several (Voice & copy rule 3).

The hero's combo move names a missing piece this commander's decks play (on
its EDHREC page, most played first): a combo that only needs a generic card
(Hullbreaker Horror with the Sol Ring every deck runs) is not a next best move.

### Which EDHREC page Coach reads (T171 re-gate)

Coach reads a generated deck against **the page it was built from**, not the
commander's base page (`services/deckBuilder/deckEdhrecSource.ts`): its themes
merged the way generation merges them, at its bracket and budget, following
the rung `buildReport.dataSource` records (the build can ladder off a theme or
a bracket). Every play rate Coach quotes ("Played in 62% of decklists"), the
40% staple floor below and the role targets all come from that page. A
hand-built deck, or a page that fails to load, reads the base page. On the
base page a Zombies Gisa deck's 62% lords read as 0% misfits, which is the
advice this rule retires.

**What the build removed stays out** (T171 round 3). A card the build cut for a
stated reason (`buildReport`'s coherence repairs, fixup repairs and surplus
conversions) isn't suggested back while the card it made room for is still in
the deck: Sythis's build cut Rest in Peace, an orphan combo piece, for Path to
Exile, and Coach had offered it straight back. Graveyard hate isn't suggested
to a deck that recurs from its own graveyard (invested in the graveyard axis,
or running three counted recursion cards) (`deckBuilder/coachExclusions.ts`).

### What Coach never offers to cut (T171)

Every cut surface (the Cuts chip, the optimizer's removals, the misfits, the
replace-when-full prompt, the budget lane's outgoing card) shares these floors,
and a land swap never takes a premium land (Path of Ancestry in an elves deck):

- **Premium cards** (`services/deckBuilder/premiumCards.ts`): a Game Changer
  by name as well as by stamp (an imported deck has no stamp), a staple mana
  rock, a staple of this commander (at least 40% of its decks), a spell among
  the 100 most played in Commander, and, from the card facts, an efficient
  tutor, protection piece, answer or board wipe (cheap, or free to cast), and
  any tutor the bracket estimator counts, whatever it costs.
- **A card whose role is at or under its target**, unless the incoming card
  fills that same role and the role isn't short: a cut never opens a gap Coach
  would then ask to fill.
- **Anything but a weaker card of the same role, for an add whose role is at
  or over target** (T171 round 3). That add is an upgrade inside its role: the
  cut is a strictly weaker card of the same counted role (played here less, or
  flagged weak when the add's play rate is unknown), and the reason says
  "Upgrade in ramp", never "Excess Ramp". Boros Signet once came in for Battle
  Angels of Tyr as "Excess Ramp" and ramp stayed at 16 of 13. With no weaker
  card in the role, there is no suggestion. This holds on every path that adds
  a card, the hero's included.
- **A plan card.** A card that feeds one of the commander's own abilities (an
  attack trigger Isshin doubles, a tribe Lathril leads; the commander profile's
  detectors) is never a misfit, an optimizer removal or a budget swap's
  outgoing card, and the replace prompt offers it only for an incoming card
  that feeds the commander too. A card whose card facts rank its counted role
  below its primary one is never an excess cut or an in-role upgrade either
  (`services/deckBuilder/incidentalRole.ts`). Battle Angels of Tyr counts as
  ramp for its Treasure, but it is an Isshin payoff; the Signets are the
  excess.
- **A card the user just added.** A staple the analysis still lists as
  missing is in the deck only because the user added it since, most likely
  on Coach's advice; offering it as the next cut undoes that move.
- **A card Coach would suggest adding straight back.** An unflagged card
  played here at least as much as the least-played staple the analysis lists
  as missing would join that list the moment it's cut. A budget swap keeps
  such a card in play only when the deck's budget would hide the re-add. When
  the replace prompt has nothing left to cut, it says "No suggestions. Pick a
  card below." and the user picks from the whole deck.
- **A combo piece** of a combo the deck has.
- **A finisher, as an overlap cut.** A card the card facts read as a finisher
  (an overrun, an alt win, mass animation like Starfield of Nyx) or that the
  deck's win paths name as an alt win is never cut as "Overlapping
  Enchantress"; it goes only when the analysis flags it weak.

An excess-role cut is the least played card of the role that isn't a plan or
engine card: a crowded curve slot no longer pushes a 22% Birgi out ahead of a
12% Strike It Rich.

**A combo completion always gets a cut** (T171 round 3). It isn't an upgrade
inside a role, so the in-role rule doesn't apply: the cut is the least valuable
card that isn't protected (a plan or engine card, a finisher, a survival piece
like Lightning Greaves, a premium card, a piece of another combo), flagged weak
first, then the least played here. It keeps every role at its target when the
deck can; when it can't, the combo still gets its cut.

The replace-when-full prompt also keeps the slot: **a land makes room for a
land, a spell for a spell** (the weakest land for this deck first, a utility
land never), and an unflagged card is never offered when it is played here at
least as much as the card coming in, nor when swapping it out would break the
deck's settings.

A land swap's "Adds green fixing you're short on" comes from the deck's own
manabase report (its `short` flag), so the two never disagree.

### Land swaps are upgrades for this deck (T171)

The land lane reads merit with `landSlotMerit`, not generation's
`landPowerScore`: a land that only fetches a basic counts as one basic, tapped
or not; a land that does more than make mana (channel, MDFC, legendary, a
static rule, a repeatable non-mana ability, mana it can only spend on some
spells) is never cut; an incoming land enters untapped or conditionally, makes
more of the deck's colors, and never only fetches a basic. Basics the deck's
own basic fetchers need stay.

### Hidden gems fit this deck (T171)

A gem needs a tie to this deck, not only general power: it completes an
engine live in the deck's own cards (the synergy classifier, three or more on
the axis), or this commander's decks play it more than others in its colors.
Lift and similar alone filled the lane with fast mana any deck takes.

### Filter-chip row

A row of `var(--radius)`-rect toggle chips (aria-pressed — these ACT on the
feed, so shape-language puts them in the rect tier, not the 999px label
tier) sits above the feed. Rules:

- Chips wrap (`flex-wrap: wrap`), never clip — a narrow phone adds a second
  line, not horizontal overflow (control-row rule from the Toolbars section).
- A chip is hidden when its count is zero (except "All").
- Count badges inside chips are `--text-muted` when inactive, `--accent` when
  the chip is pressed.
- The `f` key cycles chips in order (All → first non-zero chip → … → wrap),
  guarded by `isTypingTarget`. Register it under the "Coach" section of the
  `?` overlay via `useRegisterShortcuts`.

**Cross-cutting toggles join the same row, styled identically, but stay out
of the lane set (E64).** "Off-meta" (spicy/off-the-beaten-path picks,
`lib/deck-analysis/inclusion-label.ts`'s `classifyInclusion(...).kind === 'offmeta'`) can
appear in _any_ lane, not one of them, so it isn't a `FilterId` — it's an
independent boolean that narrows whichever lane is active, the same
relationship "Owned only" already has to the lane set. It reuses
`.coach-feed-filter-chip` verbatim (same rect, same count-badge treatment)
rather than inventing a second toggle style, but: it does **not** join the
`f`-key cycle (that cycles lanes only), and it gets its own
`isOffMetaEmpty`-style empty-state branch (mirroring `isOwnedEmpty`'s "name
what actually hid it + one-tap relax" pattern) rather than falling through to
the generic "no suggestions" message when it's the toggle, not the lane,
that emptied the view. Renders nothing at zero count, same as any lane chip.
A future cross-lane toggle (not a new lane) follows this precedent, not the
lane-chip one.

### Cuts are separated

Cut suggestions **never interleave** with add/swap rows. They live behind the
**"Cuts" filter chip** — a pseudo-lane keyed on `change.type`, deliberately
excluded from "All" (trimming is a different intent than improving), and
`ownedOnly` never applies to it (every cut is a card already in the deck).
Mixing cuts into an adds feed reads as noise and makes it unclear whether a
row is an opportunity or a warning. (An earlier revision described a
`<details>` disclosure at the feed's end; the shipped design has always been
the chip lane — this section was stale until the UX-402 posture pass.)

### The Cuts lane shows each cut with its best replacement (E540 S6, 2026-10-06 ruling)

"The Cuts lane shows each cut with its best replacement, scored as one swap. A
cut on its own appears only to fix a broken rule: over the card count, over
budget, over a bracket or Game Changer limit, or a banned card."

- **The row is a swap that leads with the cut.** It is a `DeckCardRow` swap
  (`change.pairedCut`): the cut card's dimmed art, an arrow, the replacement's
  art, and a line above the replacement's name reading "Cut {X}, add". One
  action, aria-labelled "Cut {X} and add {Y}", does both through the page's
  swap path; the leave animation and Undo are the ordinary ones. There is no
  "Fit & cut" on it (the cut is already chosen), and its Why disclosure reads
  "Why this swap?".
- **The words are at most two plain sentences**: why the cut is the weaker card,
  then why the replacement is better ("Awakening is rarely played with this
  commander. Starfield of Nyx is in 18% of this commander's decks."). The
  clauses come from `deckGeneration/swapCopy.ts`, restated in the present tense,
  never a score or an objective term.
- **The replacement is the whole-deck objective's pick** (`lib/coach/coach-cut-swaps.ts`
  over `coach-move-score.ts`, `judgeMove`): the best card Coach itself offers in
  the cut's slot class that the deck's settings allow (budget, ownership, rarity,
  Game Changer limit), not a card the protection set holds, and no card is offered
  as the replacement twice. One source of truth: never a second pairing in the feed.
- **A collection deck searches the whole collection** (2026-10-07 ruling): every
  owned card legal in the deck's colors is a candidate, narrowed by color identity,
  slot class and the deck's settings before any card is judged, and scored on the
  fast terms with the commander's page cards first. A card the commander's page has
  no row for must clear 0.6 of gain outside the roles, synergy, engines and lift
  terms (what any card of a kind earns, or an incidental theme read earns): the swap
  has to improve the deck by the commander's own data. What the build removed on
  purpose, and graveyard hate in a deck that recurs from its graveyard, is never a
  replacement (`coachExclusions`, which follows a replacement the build itself cut
  later).
- **The words are the current deck's.** After an apply the rows still on screen keep
  their card (a withheld row stays withheld) but are judged again, so a reason that
  says ramp goes from 16 to 15 says 15 to 14 once the first swap took it to 15. A
  payoff is called a theme only with four or more feeders.
- **A cut with no acceptable replacement is not shown as a bare cut.** The one
  exception is a repair: a bare cut that fixes a rule the deck breaks keeps its
  row and its reason names the rule ("The deck is over its card count, so a card
  has to go."). A size repair claims one cut per card over.
- **The order of the cuts is the legacy order**; the objective's cut order
  measured as a wash, so only the pairing is new. Rows are scored in that order
  and scored rows come first; anything unscored by the budget keeps today's
  order below them.
- **Loading.** The lane shows the existing skeleton until the pairing lands, at
  most about 4 s (`CUT_PAIRING_BUDGET_MS`), the scorer yielding to the page every
  40 ms. The verdicts land in one batch, so **rows never reorder after paint**.
  The chip shows no number while it runs, then the lane's count. After an apply
  the last verdicts stay on screen until the new ones land.
- **States.** Loading: the skeleton. Empty (every cut lacked a replacement):
  "Nothing to cut. No weak card here has a better one to take its place." while
  the lane is open (the chip itself disappears at zero, like every lane). Can't
  score this deck (no EDHREC page, a thin page, no commander): today's cut rows
  with a one-line note, never a blank lane. Error: today's rows, a note and
  "Retry".

### Collection lane — owned alternatives

The collection lane ("Stand-ins") shows one **primary** row per missing staple —
the single best owned card that fills it — to keep the feed scannable. When the
collection holds runner-up owned cards for the same staple, the primary row
carries an **"N other owned options"** disclosure (`SubstituteOptions`),
collapsed by default, that expands the ranked alternatives as nested
`DeckCardRow`s (each with its own grounded `WhyBreakdown`). Rules:

- **Best pick stays in the flat feed; alternatives are opt-in** under the
  expander — never flatten all owned options into the feed (it buries the
  recommendation and double-lists the same physical copy).
- The expander toggle matches the Why-disclosure vocabulary (chevron, sentence
  case, 44px coarse target, hover-gated, focus ring); the alternatives sit under
  a logical-inline grouping rail (`border-inline-start`), modest indent — no deep
  margin (it cramps the nested rows at 320px).
- An owned card chosen as one staple's primary is **never** offered as another
  staple's alternative (no implying you can apply the same copy twice);
  `buildSubstitutionOptions` enforces this. Applying any option removes every
  feed row naming that card on the next render (the live `deckNames` filter).
- **No fabricated "% match".** Substitute ranking v2 (E517,
  `services/substitutes`) orders the options. Its score is a fitted sum with no
  unit, and held out it reaches nDCG@5 0.79 against hand grades, far from
  certain. Rank order carries fit, the Why disclosure carries the reasons, and
  no surface shows the score or a percentage.
- **The ranking only reorders.** v2 never adds or drops an owned option: the
  role gate, colour identity and the land rule decide which cards qualify, so
  a row can only move, never appear from nowhere.
- **A stand-in fills a short role, or it isn't offered** (T171). A missing
  staple gets owned stand-ins only while its role is under target
  (`staplesToSubstitute`): in a role already met, the stand-in was a lateral
  swap between two owned cards off the commander's page, and the next pass
  traded it straight back.

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

### Not for this deck (E580, 2026-10-08)

Every suggestion row (Coach, Swap this card, Similar cards, the Add panel's
suggestions, combos and Hidden gems) can be turned down for the open deck.

- **It is the row's own ⋮ menu, one item: `Not for this deck`.** Not a second
  always-visible button beside the apply: the apply stays the one loud action,
  and a dismissal is a quiet, rarer verb. That is the right-click contract
  (§ Verbs, Menus) applied as written: the menu opens on a right-click, the
  Context Menu key and Shift+F10 too, and `SuggestionDismissMenu` is the one
  component that renders it. The ⋮ rests hidden under a fine pointer and shows
  on row hover or focus; it is always visible on touch. Its slot keeps its
  width, so nothing shifts when it appears.
- **44px is a ghost, not a box** (dense-row rule): 24px at a fine pointer, a 44px
  `::after` on touch, inside a row that is already 44px tall.
- **It hides at once and says so with Undo**: a toast `Hid {card} from this
deck's suggestions`. Undo restores the row. Focus moves to the next row.
- **It is stored on the deck** (`Deck.dismissedSuggestions`: the card, whether it
  was a cut suggestion, and the surface), so it syncs and survives a reload. The
  card is keyed by name: hiding a card hides it on every surface for this deck.
  Coach's next analysis does not suggest it back (`coachExclusions`), and a
  Cuts-lane replacement the player hid reads as withheld.
- **The way back is `Hidden for this deck (N)`**, one quiet disclosure under the
  Coach feed and under the Add panel's suggestions, each entry with `Show
again`. It renders nothing while nothing is hidden, so a deck the player never
  curated pays no chrome. Opened and then emptied, it stays and reads `Nothing
hidden. Suggestions you hide from a row's menu show up here.`
- **It is also a label** (E518): `dismiss` on the surface the row was on, `undo`
  when it is restored.

### Empty states

| Situation                                            | Copy                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| No suggestions at all (deck is tuned)                | "Nothing to coach — this deck looks tuned." + hint: "Your deck is well-covered. Try adjusting your bracket target or browsing themes below." |
| A filter chip returns zero rows but other rows exist | "No {filter} suggestions right now." (inline, no doors)                                                                                      |
| Analysis still pending and no changes yet            | Skeleton (`deck-analysis-skeleton` pattern — see Deck-analysis tabs section)                                                                 |

## AI-written content (T96, extended T102)

Model-written text always says so. The rulings:

- **The marker is a pill on the surface's title** (`.deck-ai-marker`, reading
  "AI-written", or "AI Beta" before consent) — outline style, `--text-muted` on
  `--border`, never the accent. AI provenance is metadata, not a feature to
  celebrate; it must be visible before the prose is read but never compete with
  it.
- **AI surfaces are additive and self-hiding.** An AI panel renders literally
  nothing (`null`) when the feature is unavailable or off — never a locked or
  greyed-out teaser. The page without AI is exactly today's page.
- **Nothing is sent on render.** An AI surface may fetch its own cheap status,
  but model calls happen only on an explicit press of a clearly-AI button.
- **Consent is granted in place, at the point of use (T102).** The first-use
  card names exactly what leaves the device, the daily cap, and where the
  master switch lives, then grants consent with its own Enable button — never a
  link that sends the user off to a settings page to hunt for a toggle. It
  keeps the "No thanks" dismiss (localStorage); dismissed or enabled, it never
  returns. The settings page stays as the master off switch, and consent itself
  is still enforced server-side (a rendered button is not consent).
- **Granting consent never spends a call.** Enabling drops the surface into its
  idle state with the AI button waiting — it does not auto-run the thing the
  user just permitted.
- **One sources contract per deck, one control (T112).** Where the AI may draw
  candidates from (any card / cards you own / free copies you own / budget
  picks, a fixed per-card ceiling by cheapest printing in the player's
  display currency, USD or EUR / cards you don't own, the collection read as
  a list to leave out) is a deck
  field (`deck.aiScope`), read identically by every AI surface on that deck and
  set in exactly one place: the `AiSourcesControl` fieldset above the Coach
  tab's AI panels. Native radios, options are rects (§ segmented controls), and
  the note under them states the cost — the scope is part of the server cache
  key, so a change makes the next reading a new one against the daily cap. An
  AI panel never grows its own owned/budget toggle; the Coach feed's "Owned
  only" checkbox is a free display filter over engine rows and does not drive
  the AI.
- **"Leave my cards out" exists wherever the collection is a source.** A
  surface that can build from the collection also offers its inverse: the deck
  generator's "Skip my cards" strategy (inside "Use my collection") and the
  AI's "Cards you don't own" scope. Basic lands and the player's own picks
  (must-includes, commanders) are exempt, and the build report says how many
  owned cards it left out. The cube builder is the exception for now: its only
  pool IS the collection.
- **The AI never annotates engine rows unlabelled (E274).** When the live
  refine reading picks the same card as an engine row, the row gets an
  "AI agrees" `AiMarker` followed by the model's own sentence, on its own line
  (`.deck-card-row-ai`) — apart from the engine's `reason` and never inside the
  grounded `WhyBreakdown` factors. Output-only join; it drops the moment the
  tweak is dismissed, re-rolled or applied.
- **Long AI prose is sectioned, and the finding leads (T102).** Prose past a
  couple of paragraphs gets client-side section titles derived from the
  prompt's fixed order — the model writes headerless prose, the UI titles it —
  and the section that earns the feature (the weakness/finding, not the
  summary) renders **first**, wherever the model wrote it. The lead section
  takes the quiet attention rail (`--warn-border` left rule, `--warn-text`
  title) and one step up in body size; the plate stays unfilled, because a
  finding is a finding, not an error. Prose too short to section honestly falls
  back to plain paragraphs rather than mislabelling itself.
- **Card names inside AI prose are tappable as text, not as pills**
  (`.deck-ai-card-chip`): weight + underline on the running text, opening the
  shared card carousel seeded with every card the reading named. A pill per
  name shreds the paragraph — the "Card-name chips" primitive above is for
  lists and grids, not for prose. Match against the actual decklist (basics
  excluded — "your Swamps" is a turn of phrase), so a hallucinated name simply
  gets no chip.
- **Stale AI output stays readable, flagged, never silently regenerated**: a
  notice ("Your deck has changed since this was written") plus an explicit
  re-run button; the prose itself drops to `--text-secondary` while stale.
- **Generated AI prose persists — reopening a surface restores its last
  output, and past outputs stay reachable.** The review panel restores the
  newest stored reading on expand (a DB read, never a model call) and lists
  every kept reading on a quiet date rail (`.deck-ai-history`: uppercase
  micro-label + outline date pills, `aria-current` on the shown one) under the
  prose; reopening one is a local swap. A restored reading is dated, not
  flagged stale — whether the deck changed since isn't knowable client-side,
  so it gets "Written N ago" with the same re-run affordance instead of a
  staleness claim the UI can't back.
- **Streaming shows the prose, never the plumbing (T102).** A skeleton covers
  only the wait before the first word; after that the text renders as it lands,
  with a caret and an announced "Writing…" status. Structure that depends on
  the _whole_ answer — section titles, card chips — waits for completion rather
  than reflowing mid-write. Any machine-readable tail the model emits is
  withheld server-side so it can never flicker on screen as prose. A stream
  that ends without its terminator is a failure, not a short answer: drop the
  partial and offer the retry, because half a finding still reads as a finding.
- **An AI surface that proposes actions shows the whole move on the row**
  (T102): what comes in, what goes out, and why, so the move can be judged
  without expanding anything. Accepting routes through the app's existing apply
  path — the same `Change` the coach feed uses — never a parallel mutation. And
  **"nothing to change" is a result, not an empty state**: say so in a sentence
  rather than rendering a blank panel that reads as broken.
- **One shared AI status per page** (`useAiStatus`). Multiple AI panels read
  the same quota store, so they can never show two different "N left today"
  numbers; a spend updates every meter at once. Each panel still self-hides on
  its own when the feature is unavailable or consent is absent.
- **On a list/browse surface, an AI panel takes the insight-strip posture
  (E244).** Where the surface's primary job is browsing rows (the add-cards
  sheet's Suggestions tab), the AI affordance starts as ONE compact strip —
  AI-Beta pill, title, candidate count, chevron, 44px coarse target — and
  expands the full panel in place only when tapped. It renders nothing at all
  when its candidate pool is empty: an advisor with nothing to say shows no
  chrome. This is the "Index-page insight strips" ruling applied to AI, and it
  outranks the build-report precedent of mounting the full panel directly —
  that sheet is a report, not a list. The replace-when-full prompt takes the
  same posture: its ranked cuts are the primary content, so the AI verdict
  ("Is it an upgrade?") is a strip there too. **The Coach tab is a list
  surface** (UX-402): both its AI mounts — "Read the deck" and the
  `variant="coach"` refine pass — start as strips below the browse catalog;
  the review strip omits the candidate-count teaser (it has no pool) and,
  since it never depends on a pool, is the one strip that may render
  pre-consent (expanding shows the in-place consent card). Only the
  build-report sheet still mounts the full refine panel.
- **Managing an AI proposal afterwards is code, not another model call**
  (T102 refine levers, `DeckAiRefine`). Once the model has proposed its
  tweaks, three controls operate purely on data already in the browser and
  never re-prompt: **bulk-apply** every remaining swap as one undo entry (a
  plain `.btn` above the list, hidden below 2 remaining un-applied/un-dismissed
  swap tweaks and hidden entirely on the `replace` variant, whose bulk verdict
  is meaningless for a one-card prompt); **dismiss**, which collapses a row to
  a quiet "Dismissed {name}" line with an **Undo** — reversible, never
  destructive — and persists by added-card name in
  `localStorage['sc-ai-refine-dismissed:<deckId>']` (try/catch every access;
  Safari private mode throws) so a rejected suggestion never resurrects on
  reopen or a cached-reading replay; and **re-roll**, which cycles a row
  through an engine-supplied alternatives list (AI's pick → alt 0 → … → back
  to the AI's pick) and, critically, **drops the AI's `why` the instant a row
  is re-rolled** — that sentence was a claim about the AI's card, and showing
  it under a different card would misattribute a model claim to a card the
  model never evaluated. A re-rolled row shows a neutral, honestly-sourced
  line instead ("Engine alternative — same role as {original}."), styled
  distinctly (italic, no `AiMarker`) since it is explicitly **not**
  model-written text, plus an explicit way back to the AI's original pick.
  Accepting a re-rolled row applies the card **currently on screen**, never
  the AI's original pick underneath it — the same rule bulk-apply honors via
  a shared `displayNameFor` helper. The dismiss/re-roll icon controls use the
  ghost hit-area pattern (`.deck-row-select-check`'s technique: small visible
  box, 44px `::after` on coarse) so they can't inflate the dense tweak row's
  height; the standalone bulk-apply and undo buttons take their floor
  directly via a two-class selector (`.btn.deck-ai-bulk-apply`) so it beats
  responsive-nav.css's same-specificity `.btn { min-height: 36px }`.
- **Rule citations in AI prose are text-level, in the accent, and expand to
  the official text on the same page** (E261, `/rules`). A cited rule number
  (`.rules-ref-chip`) takes the card-chip treatment (weight + underline in
  running text, never a pill) but in `--accent`, because it expands content
  below rather than opening a preview overlay; it carries `aria-expanded` +
  `aria-controls` for the row it toggles in the "Rules cited" list. **Only
  refs the server verified against the corpus become interactive** — an
  unverified number stays plain prose, exactly as a hallucinated card name
  gets no chip. Every AI answer that quotes an authority renders the
  authority's own text within reach, plus a plain-words disclaimer
  ("AI can misread corner cases — for tournament play, ask a judge"):
  grounding the reader can check is the feature, not decoration.
- **The Rules Reference sheet carries the AI escalation door** (E261): one
  quiet insight-strip row above its footer — "Ask a rules question", Sparkles
  glyph, "AI — cites the rules" hint — that closes the sheet and navigates to
  `/rules?tab=ask`, seeding the ask box with the search that came up short (a
  seed only; nothing sends until Ask). Self-hiding like every AI surface:
  without AI the sheet is exactly today's sheet.
- **Rules is a place, and the sheet is its quick look** (settled 2026-09-19).
  `/rules` is the Rules hub: Keywords / Glossary / Rules (the offline
  Comprehensive Rules, `components/rules/RulesReference.tsx`, the same lists the
  sheet shows) plus an Ask tab that self-hides without AI. Section and search
  live in the URL (`?tab=`, `?q=`) so a rule lookup is a linkable address.
  Its doors are utility-shaped, never a fifth primary tab: the header's
  utility cluster beside Search (on a phone, the Search page itself; see
  below), the ⌘K Navigate group, and You › Help. The
  sheet (`RulesReferenceSheet.tsx`) stays for the one place you must not
  leave, the in-game menu, and is never the target of a link. Don't
  reintroduce a header sheet trigger or a tab-bar slot: the nav redesign
  that removed them was right about the bar, wrong to leave Rules reachable
  only from Play.
- **A Rules door lives in three kinds of places, never on a page** (settled
  2026-09-19): the global utility slot, the place you can't leave (the game
  menu), and a contextual escalation (the sheet's "Ask a rules question" when
  a search came up short; a row's "Ask AI about this"; Search's keyword row,
  below). The Play hero's own Rules pill sat one row under the header door
  and was removed for that reason. The same shape as Search, which does not
  repeat on Collection.
- **The utility slot is the header from 1024px and the Search tab below it**
  (settled 2026-10-08). The header is `display: none` in the mobile shell, so
  the 2026-09-19 ruling above, which named "the header, every width", left
  phones with no door but You › Help for three weeks. On a phone Rules rides
  in Search, its desktop neighbor: a "Rules" link beside "Search syntax"
  under the pill (`.search-rules-door`, the syntax toggle's shape), hidden
  from 1024px where the header door sits one row up. Still no tab-bar slot
  and no page pill. Guarded by `styles/rules-door-every-width.test.ts`.
- **A search that names a keyword shows its rule first** (2026-10-08). When
  the whole query is a keyword's name, or a form card text prints it in
  ("scried", "islandwalk"), one row sits above the card results
  (`SearchRulesHit`): name, kind and number, two lines of the rule's own
  sentence, a trailing chevron. It says what the card-text keyword popover
  says, from the same ~15 KB `keyword-glossary.json` (never the rules
  bundle), and opens `/rules` on that keyword with its subrules expanded. A
  keyword inside a longer query ("ward elf") is a card search, and a syntax
  query never fetches the glossary. Nothing renders without a match: it is
  an answer to the query, not an advisor, so it never takes room it hasn't
  earned.
- **A query that isn't a keyword falls back to a glossary term** (2026-10-08,
  E587). The same row, with "Glossary · 117" for the meta and the term's own
  definition for the text, for an exact term ("priority", "the stack", "mana
  value"); it opens `/rules?tab=glossary&q=…`. The terms come from
  `rules-glossary.json` (~20 KB gzipped, every glossary term that is not a
  keyword, derived beside the keyword file), and Search fetches it only after
  the keyword lookup has answered "not a keyword", never in parallel with
  it, so a keyword search costs the keyword file alone. A keyword always
  wins over a term of the same name.
- **Every reference row has a menu** (`RulesEntryMenu`, on the shared
  `OverflowMenu`): Copy text (the number and the official text, for the
  group chat), Share link (the row's own `/rules?tab=…&q=…` address; the
  native share sheet where there is one, else the clipboard), and for
  keyword abilities only, "Cards with this keyword" (`/search?q=keyword:…`)
  and "Search Scryfall"; keyword actions get neither, since `keyword:`
  matches abilities and an empty result page answers nothing. "Ask AI about
  this" seeds the Ask tab and self-hides without AI. The ⋮ is the visible
  affordance on every pointer; right-click, the Context Menu key and
  Shift+F10 on the row open the same menu (`openEntryMenu`). The ⋮ is
  **always present, never hover-revealed** (settled 2026-09-20): reference
  rows are a dense stack the eye travels down, and a glyph that pops in at
  every stop is what you notice instead of the rules. It rests muted and
  comes up to full on the hovered or focused row. This is the opposite of
  the deck list's ruling, and the difference is the surface — a list you
  ACT on can hide its controls until you arrive at a row; a list you READ
  cannot afford the flicker.
- **The ⋮ takes its row's vertical centering, never a blanket
  `align-self`** (settled 2026-09-20). A keyword head and a glossary term
  are single lines, so their ⋮ sits ON the line, beside the rule number.
  Only a numbered rule opts out: it is a paragraph, so its ⋮ tracks the
  first line rather than centering down four lines of prose. A blanket
  `align-self: flex-start` on `.rules-ref-entry-menu` is what once left the
  ⋮ floating in the corner above the term while the rule number — which
  lives inside the head button — sat correctly on the line.
- **The reference is a dictionary, and both lists draw it the same way**
  (settled 2026-09-20). Keyword entries and glossary terms are
  **hairline-separated rows, never bordered cards**, and the category badge
  beside a term is a **small-caps label, not a chip** — the pill form is for
  a mark that must catch the eye against other content, and here the same
  mark repeats on nearly every row. Keywords shipped as cards while the
  glossary next door was already a hairline list; at 2-up the cards' grid
  also carried `align-items: start`, so each entry kept its own content
  height, the shorter of every pair left a ragged hole beneath it and no two
  row gaps measured the same. **At 2-up neither list takes `align-items` or
  a row gap** — letting each row's pair share a height is what puts the two
  columns' hairlines on one line, and a box edge is what makes a mismatch
  visible in the first place. Hover fills the whole entry; it does not ring
  it in accent. Guarded by `styles/rules-reference-rows.test.ts`.
- **A keyword row that opens says so with a chevron, and the chevron LEADS
  the row** (settled 2026-09-20). The head is a disclosure button
  (`aria-expanded` + `aria-controls` naming the subrule body it reveals)
  carrying the app's standard chevron: `ChevronDown`, `data-open`,
  `rotate(180deg)`, muted, `--motion-fast`, silent under
  `prefers-reduced-motion`. The row reads as a definition, so without the
  mark nothing told a sighted visitor it also opened; `aria-expanded` alone
  is a promise kept only to screen readers. The definition and the opened
  subrules indent by `--rules-kw-indent` so body copy hangs under the term,
  not under the chevron.
- **In-place disclosure ⇒ LEADING chevron. A row that opens a separate
  surface ⇒ TRAILING chevron.** These are two patterns, and the trailing
  ruling above (suggestion strips, § Suggestion feeds) is the second one —
  navigation, not disclosure. Every in-place toggle in the app leads:
  `CardRulings`, `CardDetails` (Legalities), `WhyBreakdown`, and both of
  `CoachFeed`'s. External design systems default an accordion chevron to the
  END (Carbon, so the title aligns with other type) and NN/g's accordion-icon
  study tested only that placement — we go the other way **on purpose**,
  because five in-app precedents beat a generic default, and because Carbon's
  own stated exception is tree-like content: a keyword expands into its
  numbered subrules, which is a hierarchy. Don't "fix" a leading chevron to
  match an outside design system.
- **The Rules hub uses a wide screen; the sheet never does** (settled
  2026-09-19). Below 1024px `/rules` is the 640px reading column its social
  siblings use. From 1024px it widens to the 1100px cap Search / Compare /
  Tags share and lays the reference out for the room: the section strip and
  the search share one toolbar row over a single hairline; keyword cards and
  glossary terms, which are short, go two abreast (a grid that reads across,
  never CSS `columns`, which would send a long list down one column and back
  up the next); numbered rules and the AI answer are prose and keep a ~44rem
  measure; the Ask tab seats the box, its starters and past questions beside
  the answer instead of above it. Every desktop rule is scoped under
  `.rules-page` so the in-game sheet stays the single-column quick look.

---
