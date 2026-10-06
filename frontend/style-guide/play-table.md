# Style guide: Play, playtest & the table

The playtest table, the online table, Horde and the life-counter play board. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, colour and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## The card back is the real one (2026-09-20 ruling)

A face-down card — yours, an opponent's mini card in the rail, or the
library pile — draws the actual Magic card back from
`frontend/public/card-back.webp`, not a gradient approximating one.

It is the same Scryfall CDN artwork every card face in this app already
renders, so declining it while the whole product is built on the faces was an
arbitrary line, not a principled one. It is **downloaded once and served
locally** rather than hotlinked: unlike a face, the back is drawn many times
per board, and Scryfall asks consumers to cache rather than re-fetch.

Sizing is a deliberate trade, not a default: 600px wide covers a card at full
zoom on a 2x display, and WebP at quality 72 takes the 1.1MB source PNG to
71KB. It lives in `public/`, so it is outside the entry graph and costs the
boot budget nothing. Re-deriving it means re-running the same resize rather
than dropping the source PNG in.

## Playtest ↔ online table: one linkage rule (2026-09-20 ruling)

The playtest board doubles as an online seat's board. **Whether it does is
decided in exactly one place, `playtest/hooks/use-table-seat.ts`**, and the
rule has three parts: there is an online game, this device holds a seat in
it, and **the seat's deck is the deck this board is playing**.

The deck part is what makes the link per-board instead of per-account.
Without it, holding a seat was the whole test, so opening any other deck to
goldfish silently became your seat: it published that board to the table,
fed its log lines into the table ticker, took the table's authoritative life
total for its own, relabelled the page "Your board" with a back link into the
game, and armed chat, reactions, dice, pointing and holds against a game it
was not part of. A shared or public deck reaches the same board through
`PlaytestSession`, so that was exposed too.

**Never re-derive it.** The condition was hand-rolled in four places — the
two hooks, `HoldBanner` and `PlaytestPage` — which is precisely how three of
them kept the old rule when the fourth learned about decks. `useOnlineTable`
and `useOnlineSignals` both consume `useTableSeat`; anything new that asks
"am I seated here?" consumes it too. A second copy is a bug with a delay on
it.

Two deliberate non-rules:

- **No `status` gate.** A finished game stays linked, because `TableMoments`
  runs the win ceremony off the status transition and needs the link alive to
  see it. Status is that component's business, not the linkage's.
- **A seat with no deck is nobody's board.** It does not fall back to
  "whatever you happen to be playtesting". The board door's "pick a deck to
  open your board" is the route that sets the seat's deck, and it already
  navigates afterwards.

## The table's keyboard map (2026-09-20 ruling)

The playtest/online battlefield does **not** use the app-wide `?` registry as
its source of truth. It owns a rebindable binding table
(`playtest/lib/shortcuts.ts`) and one keydown dispatcher in `PlaytestBoard`,
and _feeds_ the `?` overlay from it. Three rules hold:

**Defaults are EDHPlay's map, and that claim is tested.**
`playtest/lib/shortcuts.test.ts` holds an `EXPECTED` key → id table plus an
`UNBOUND` list, and a third test fails if any shortcut appears in neither. A
default changes by editing that table in the same commit — never silently.

**"The card in view" is the one targeting rule.** Every per-card key (tap,
move, flip, counters, arrows, the stack) acts on **the selection when there
is one, otherwise the card under the pointer or keyboard focus**. The hover
half comes from `data-card-id` on `PlaytestCardFace` plus
`hooks/use-hover-target` — a ref, never state, so crossing cards with the
mouse re-renders nothing. A key over a card that isn't yours resolves to
nothing and **falls through to the browser** rather than being swallowed.

**A key may read the context, and `=` / `-` do.** With a card targeted they
are ±1/±1 counters; with nothing targeted they size the cards. That is
EDHPlay's own mapping (its spec lists `-` under both global actions and
counters) and what this board did before the map was first written, which
split them into four separate keys and quietly cost the muscle memory the map
exists to preserve. The two meanings do not compete in play: you reach for a
counter with a card under the pointer, and for card size while looking at the
whole board. The shifted `plus` / `_` stay bound as the form that only ever
means a counter, so the unambiguous route survives. A context-reading key
must state both halves in its label — the shortcuts sheet is generated from
those labels, so a key that behaves two ways and says one is a lie.

**Ctrl + the wheel sizes the cards, never the page** (2026-09-24, from
EDHPlay). On the wide tier a native, non-passive `wheel` listener takes every
ctrl + wheel (a trackpad pinch arrives as the same event), stops the browser's
own zoom, and steps the same card-size setting the slider and `=` / `-` drive:
one step per mouse notch, a pinch's small deltas added up to one. The felt,
its grid and every corner stay their size. The narrow tier has no card size to
set, so it leaves the browser's zoom alone.

**A pile's card is picked up the way a card on the felt is** (2026-09-24). The
top of the library, graveyard and exile, and each commander in the command
zone, drag onto the battlefield, into the hand, or onto another pile; a card
dropped back on its own pile has gone nowhere and costs no takeback step. The
pile shows the card underneath while its top card is in the air, and the
library's top stays a card back on the way unless the top is being played
revealed. The drag is pointer only: Enter and Space on a pile keep meaning its
click, and the viewer and menus carry every move for the keyboard. **Clicking
a commander opens its card menu; it never casts.** Casting is that menu's
Move to ▸ Battlefield, or a drag onto the felt, because a click that cast put
the commander on the table every time someone only meant to look at it.

**A card held over the hand opens a gap where it will land** (2026-09-28,
user). With the pointer over the fan, the cards either side part by exactly
one fan step (a card's width less the overlap) and the drop goes into that
gap, whether the card came from the felt, a pile, or the hand itself; a hand
card lifted out also closes its own empty box. One step and no more, because
the fan is centred: when the card lands every other card is already standing
where the new order puts it, so nothing jumps. The pointer decides, not the
card's box, since the gap follows the pointer and the drop has to agree with
the gap the player sees. There is no drop-onto-a-card target in the hand any
more; the hand card menu's Move earlier / later is the keyboard's way to
arrange.

**Commander tax is a coin above the command zone, never a line in a menu**
(2026-09-24, EDHPlay's layout). One coin per commander (`taxCommanders`: the
deck's commander gold, its partner silver, a card put in the zone by hand too,
two at most) sits out of flow above the Command label, with the tax beside it.
A click adds a cast (+2), a right-click, the Context Menu key or a long-press
takes one off, floored at zero; each is an undoable, logged step. The coins
stay while their commander is on the battlefield, because that is when the
next cast's price matters, and the card's own menu no longer repeats it.
Hovering or focusing a coin never opens the pile under it: the coins ride on
the pile's top, and an opening pile would slide a coin out from under the
pointer between one click and the next (the first build did exactly that).
One `TaxCoins` component draws them everywhere: floating above the table's
command pile, and inline in the phone's command tile, which is where a phone's
command zone lives. The phone had shown the tax only for a card still in the
zone, so a cast commander's tax was nowhere on screen until the coins came.

**Every key has a pointer twin.** A shortcut that exists only on the keyboard
is not shipped: each one is also a card-menu item, a table-menu item, or a
control on the surface it drives (the stack strip's own buttons). Menu items
print their live binding via `keyFor(id)`, so a rebound key never lies.

## Table signals — ring, point, arrow (2026-09-20 ruling)

Three different weights of "look at this", and they are not interchangeable:

| Signal    | Gesture                  | Lives for     | Writes to the ticker |
| --------- | ------------------------ | ------------- | -------------------- |
| **Ping**  | any card tap             | ~1.1s         | no                   |
| **Point** | a deliberate menu action | 5s            | yes                  |
| **Arrow** | `W`, then a target       | until cleared | no                   |

A **ping** is a ring in the pinging seat's palette colour
(`paletteForIndex`), drawn by `TablePings` as a viewport overlay measured off
`data-card-id` — the same DOM-lookup pattern `TableArrows` uses, rather than
threading a prop through four components. It is deliberately silent in the
feed: it rides an ordinary tap, so a line per ping would bury everything
else. Solo play still rings locally (the ring doubles as tap feedback) and
sends nothing. Outbound pings are throttled client-side — the server's signal
limiter is a shared budget, and a busy combat step is a lot of taps.

Reduced motion keeps the ring and drops the travel: it appears at the card's
own size and fades. Never remove the signal itself for reduced motion —
somebody indicating a card still has to get through.

---

## Card corner ribbons — state on the left, identity on the right (2026-09-20 ruling)

A ribbon is the only card mark that survives the card being half-buried under
another one, so it is reserved for the two things a player must never misread,
and the corner says which kind it is:

- **Top-left, gold: what is happening to the card.** `Stack` — waiting to
  resolve. Transient, paired with a ring so a covered card still reads.
- **Top-right, slate: what the card is.** `Token` — this one is a token copy,
  not the printed card it is a picture of. Permanent for the card's whole life,
  and deliberately ink rather than a status colour: being a token is not
  something happening to the permanent.

Both can be true at once, which is why they take opposite corners rather than
one shared slot. A ribbon is `aria-hidden` (a 45° banner read aloud mid-name is
noise) — the fact goes in the card's own `aria-label` instead. Anything that
shares a ribbon's corner, like the attachment link glyph, layers above it.
Face-down hides the token ribbon along with the power/toughness and counters:
the back of a card gives nothing away.

Everything else about a card — counters, stickers, phasing, attachment — is a
badge, not a ribbon. If a third ribbon ever seems necessary, it is a badge.

**Where the mark has to be repeated.** Any surface that shows a card at
reading size repeats the ribbon on the same corner: the hover preview does,
one type step up, because an enlarged token shows the art of the card it
copied and would otherwise be the one place the difference disappears. A
surface that shows cards as a _list_ uses that list's own chip vocabulary
instead — the stack panel marks a token with a chip mirroring its seat chip,
because its tucked rows are clipped to the title bar and would cut a 45°
ribbon in half. The rule: ribbon on a card, chip in a list.

**Where the stack panel's chips sit (E502).** On a row with card art, the
seat chip and the Token chip lie over the card's top border, in the corners.
On a text-bar row (no art, usually an opponent's card whose art is not
cached) they get their own line above the name, in the same corners, and the
name and cost take the full width below. Never back to a reserved left pad:
the seat chip is as wide as the seat name, so a pad only fits the default
label (core `STYLE_GUIDE § Color & spacing`, "sized by its text").

---

## Horde table (Local Horde, 2026-09-24)

The horde plays itself. There is no opposing player's board on screen — only
the horde's own `Battlefield`/`ZonePile`/`LifeStrip`, built from the real
playtest components, never a bespoke card grid.

- **The attack ring is a third fixed colour, not a tap.** A creature the horde
  declares as attacking wears a fixed red ring (`--pt-ring-attack`,
  `.playtest-card--attacking`), alongside the existing cyan-hover /
  gold-selected pair. It is never `tapped` — the horde has no tap step of its
  own, so "attacking" and "tapped" stay two different facts, the way the ring
  and the printed body already keep hover and selection apart.
- **The damage-total banner is a proposal, not a fact.** It prefills the
  numeric field with the horde's full power and lets the number go down (a
  survivor blocked or removed some of it) — it never recomputes the total
  itself. Taking 0 reads as "Skip", not "Take 0".
- **Landscape-first, tablet-first.** The table's four-corner layout assumes
  the ≥1024px table tier by construction; a phone or tablet held in portrait
  gets a "turn it sideways" prompt (reusing playtest's `RotatePrompt` on a
  phone) rather than a squeezed version of the corner chrome.
- **No piles for the horde's own board.** Every horde permanent is its own
  card on the felt, exactly like a real player's battlefield — the "no piles"
  rule that governs the rest of the table applies here too, even though
  nobody chose where each card landed.
- **A horde permanent's death is recorded by hand.** This board never
  simulates the survivors' side of combat, so nothing here ever removes a
  horde creature on its own — a card menu (Destroyed / Exiled / Returned to
  the library) is the one way a permanent, including a boss that entered on a
  tick, leaves the battlefield. Copy is past tense, the same "you report a
  physical act already done" grammar as the binder review queue. Opens on a
  click, a touch tap, a long-press, right-click, or the Context Menu key — the
  same four-path parity the main playtest board's card menu holds.
- **The library/graveyard tiles read at full card height, not the tucked
  peek.** `.horde-table-piles .playtest-pile__stack` overrides the main
  board's 35%-sliver default (`height: var(--pt-card-h)`, scoped to this
  table only) — a peek sized for a lap-held phone disappears from across a
  real table, and there is no hand/drag gesture here to defer it for.
- **The library meter carries the horde's own boss ticks.** A gold hairline
  per `HordeSettings.bossTicks` fraction, dimmed once crossed, plus a "Next
  boss in N" line under it — the meter is read as the horde's health bar
  ("Horde library · N / N"), not a generic progress indicator.
- **A boss banner's wording is derived from the crossed fraction, never
  hard-coded to "Half".** Casual has no ticks; Standard crosses only 50% and
  100%; Brutal (and any Customise override) can cross a quarter, three
  quarters, or the library emptying outright — "A quarter of the horde is
  gone." / "Half…" / "Three quarters…" / "The horde's library is empty.",
  each still followed by which boss joined.
- **The reveal sheet reads left to right, in reveal order.** A horizontal
  row (scrolling if a wave overflows it), each card captioned "N · Name" —
  or "N · ends the wave" on the card that closes it, which also wears the
  gold selected-style ring. Widened past the phone default at ≥1024px (`min(48.75rem,
calc(100vw - 4rem))`, the dense-dialog pattern) so a normal wave reads as
  one row instead of a single narrow column.
- **A sheet built on the card-picker shell supplies its own body padding.**
  `.card-picker-list` ships with none by design — every sheet's content
  decides its own gutter. The end summary's stat list follows "Real tables
  speak print" (label left, number right, `1px dotted var(--border)` row
  rules, tabular figures), the same voice as `.play-records-table`.

### Solo Horde on the playtest board (E387 PR 5)

Fighting a horde with your own deck reuses every class and sheet above —
these are the rulings specific to sharing one board with a real, live game.

- **The felt is fixed 50/50 at ≥1024px, even during setup.** `.playtest-main--horde`
  turns `.playtest-main` into a two-row grid (horde top, yours below, 2px
  gutter on `var(--border)`, same shape as `.playtest-main--grid`'s seat
  split) and never resizes once the horde arrives — an empty-looking half
  during setup is still exactly half the table, not a sliver that grows.
  `--pt-card-w`/`--pt-card-h`/`--pt-edge` are redeclared together on BOTH
  halves for the half-height row, same rule as the seat grid.
- **The horde's half is dimmed, never relabelled.** A translucent
  `.horde-half::before` tint under its cards is the only visual difference
  from the paper table: a glance tells you which half is "not yours" without
  a badge or a border the paper table doesn't have.
- **Never a `filter`, `transform`, `perspective`, `contain`,
  `backdrop-filter` or `will-change` on `.horde-half`, `.horde-band` or
  `.horde-band__field`.** Each makes the element the containing block for
  `position: fixed` descendants, and a sheet or menu inside it then clips to
  the half with its Done button out of reach (it shipped once, as a
  `filter`, in PR 5's first build). The horde's card menu and damage sheet
  mount at board level (`HordeOverlays`), never inside the half or band;
  `horde-containing-block.test.ts` enforces both.
- **The phone band is one line until its turn, never a modal.** `.horde-band`
  folds to a bar (`flex: 0 0 auto`) and opens to `flex: 0 0 48%` on its own
  the moment `phase` becomes `reveal`/`combat`, folding back on `waiting`.
  A real `<button aria-expanded>` lets the player override either way, and a
  compact "Damage" button (accessible name "Damage the horde") sits at the
  bar's right end outside combat, so a phone can always hit back. The open
  strip reuses the same `HordeFelt` battlefield the desktop half does, at a
  smaller card density.
- **In combat, the damage total moves INTO the band's bar — nothing ever
  floats over either board on a phone.** The desktop equivalent
  (`HordeAttackBanner`) sits in YOUR half's own `.playtest-banners` stack,
  `position: static`, never centred over the screen the way the paper
  table's copy floats — two boards share the screen, so a screen-centred
  banner would sit on the seam between them. When any attacker's power is
  variable (`*`), the field is not capped at the printed total and the copy
  names the variable attackers, on the paper table too.
- **A (re-)load never leaves a blank half.** Whenever `hordeLoad.status` is
  `loading` or `error` — the setup sheet's own submit, or a Reset re-arming
  the same settings — the half/band shows a quiet "Loading the horde…" or an
  error line with "Try again" in place of the board, never an empty gap.
- **The turn chip degrades exactly like "somebody else's turn" online.**
  While the horde is mid-turn (`reveal`/`combat`) the chip is not pressable
  and reads "The horde's turn" — one function (`doNextTurnHordeAware`)
  decides, on every call site (the chip, Space, the table menu's "Next
  turn"), whether passing your turn is due to open the horde's turn instead
  of advancing yours.

### Horde at an online table (E387 online co-op)

1-4 survivors share the same fight over the network, replaying one server-
logged step sequence (`useOnlineHorde`) instead of driving a local reducer —
every seat, and a reload mid-game, rebuilds the identical board.

- **The horde's half sits on top, your own board below — same as solo,
  never a quadrant.** `.playtest-main--horde` is unchanged; a horde table
  adds `.playtest-main--horde-rail`'s 15rem rail column beside it rather than
  reaching for the desktop seat grid. The horde is this table's one
  "opponent", and the grid has no cell shaped for it.
- **Teammates always sit in the existing side rail, never the 2x2 grid.**
  The seat-grid toggle is forced off at a horde table (`gridFits` is `false`
  there) — pressing it shows the same "This table only fits the rail." toast
  a 5-seat pod gets, rather than a second, silently-broken layout mode.
- **The team-turn chip replaces the turn chip, never adds a second one.**
  Mid-survivors-phase, not yet done: a pressable chip, "Team turn N" over
  "Done" (narrow: "Team N"). Marked done, teammates still playing: "Waiting
  for Maya" (narrow: "Waiting", full sentence still announced), pressable
  again to un-mark ("Not done"), plus a "Start without Maya" button under it
  on desktop — the same intent as the band's "Go now" on a phone. During the
  horde's own turn (reveal or combat): a plain readout, "The horde's turn"
  (narrow "Horde"), matching solo's own degrade. `PhaseChip` never renders at
  a horde table — a team turn has no phases to click through.
  Space (the pass-turn shortcut) toggles this seat's own done flag instead of
  passing a turn that doesn't exist here.
- **One ending, never two.** The Horde end sheet is the only game-over UI at
  a horde table — the online win ceremony (`TableMoments`) and the persistent
  `TableFinishedBanner` both gate on `format !== 'horde'` and never mount
  there. A host sees "Rematch" (dispatches `reset`, back to the lobby) and
  "Leave table"; a joiner sees only "Leave table" plus "The host can start a
  rematch." — never a Rematch button that would bounce off the server's
  host-only check.
- **A rail entry's status tag is glance information, not a second source of
  truth.** `OpponentSeat.status` ("Playing" / "Done" / "Offline") is folded
  into the same entry the rest of that seat's board already renders in, in
  both rail densities, and into its `aria-label` — never a separate list or a
  modal of its own.

---

## Play board — a state mark carries its own control (2026-09-15)

The board's turn marker settled a question that recurs for every board-level
state: where does the _action_ on a state live, relative to the _mark_ that
shows it?

- ~~**The mark and its control belong on the thing they describe, rotated
  with it.**~~ **Reversed 2026-09-24** (see "Play board: a seat is all
  number" below): the mark stays on the seat (the white active-turn ring), but
  seats carry no controls, so passing the turn moved to the clock's turn
  segment in the seam hub. The `.pp-turn-chip` is gone.
- **A mark with no control is a mark nobody finds.** Turn tracking shipped
  ring-only, reachable only through a seat's ⋯ menu, and stayed invisible: the
  ring needs a seat to be active and nothing made a seat active. If a state has
  an "off" that hides its own mark, ship the affordance that turns it on in the
  board's own chrome, not behind a menu.
- **The seam hub is the board's one control cluster — grow it inward, not
  outward.** A fourth floating satellite beside the hub, undo and clock lands
  on panel name labels at column-seam layouts (`4p-sides`, `2p-side`). New
  board-level controls go _inside_ an existing satellite. The turn cold-start
  (`.game-clock-start`, icon-only) renders only while the clock's turn segment
  is absent, so the chip's widest state never grows.
- **Table-level readouts stay screen-relative; seat-level controls rotate.**
  The clock reads upright for whoever holds the device (how long the table has
  played is a table fact, the same ruling the win celebration carries); the
  turn chip rotates with its seat. That split is the rule, not a one-off.
- **The seam is shared ground: panels hold back from it, and satellites sit at
  the middle of an edge, never at a corner** (E299/E310). Three rules, each
  from a measured collision rather than an eyeball:
  1. Every panel insets its corner clusters by `--seam-keepout` on **both**
     axes — at a corner, either edge leads away from it, and a single-axis
     inset cleared the hub while leaving the clock overlapping. Unconditional:
     the seam runs along a panel edge in every layout, so there is none where
     the risk is absent.
  2. A satellite on a **column** seam takes the quarter points of the seam
     (`seamSatellite`), because the hub there is a four-panel crossing and
     anything hung a few rem from it lands on a name in either direction. The
     middle of a panel edge is clear by construction, which is why this holds
     at every board size rather than only the one it was tuned at — for
     every board whose rows are a plain left/right pair, which is every
     col-seam board except the one shape rule 4 below carves out.
  3. A **wide** satellite is anchored by its near edge, never centred at an
     offset — half of a 133px pill swallowed the 44px hub button and hid the ⋯
     glyph entirely on every row-seam board. Cap its width against the board
     edge too, so a narrow phone or a long player name shrinks the pill instead
     of pushing it off-screen.
  4. **Exception to rule 2: a Wide seat in row 1 shifts the "before" point to
     32% (2026-09-25) — everything else still gets the literal quarter.** A
     flat 25% holds only because a plain left/right row repeats identically
     at every position, so _which_ row it lands in never matters. `7p-ends`,
     `8p-ends`, `9p-sides`, `9p-ends` and `10p-ends` all seat a Wide seat (no
     left/right split at all) in row 1, which pushes seat 1 — the seat a
     table actually marks "up next" most of the time — into row 2 instead of
     row 1. Their 5-6 rows put row 2 somewhere a flat quarter doesn't land on
     its own boundary, so the point ends up _inside_ that cell instead, and
     undo growing 42→44px (#2279) tipped that into a measured 10px² overlap
     with seat 1's own "up next" chip corner. `seamSatellite`'s `wideFirstRow`
     parameter — GameBoard.tsx derives it from `seats[0].colSpan === 2`,
     never a preset id — opts a board into the 32% point **only** when a Wide
     first row AND the row count would otherwise land the flat quarter inside
     a cell (`0.25 * rows` not a whole number); `7p-sides` has the same
     Wide-row-1 shape but only 4 rows, where a flat quarter already lands
     exactly on the row 1/row 2 boundary, so it keeps rule 2's literal 25%
     same as `8p-sides`/`10p-sides` (no Wide seat at all) and every other
     col-seam board. 32% is itself measured, not a `rows`-driven formula — one
     value clears both the 5-row and 6-row cases. The "after" (75%) side never
     shifts: nothing renders a column-seam "after" satellite today, so a
     symmetric Wide-last-row exception would be guessing ahead of a collision
     nobody has measured. `board-layouts.test.ts` pins the literal-quarter
     default, the shifted value under the exact condition, and the
     Wide-seat-in-row-1 shape GameBoard.tsx derives `wideFirstRow` from.

  Verify with `.claude/tools/seam-geometry-scratch.mjs`, which drives all 16
  preset layouts through the menu's Setup tab and reports every satellite ∩
  panel-furniture overlap in px². **Measure, don't read the CSS** — the
  collisions this caught were 7–10px slivers invisible in a static read, and
  two of them were on layouts (`4p-pod`, the default four-player board, and
  `2p-stacked`) that a previous audit had recorded as clean.

## Play board: legible across the table (2026-09-24)

Set against Lotus, the counter people at a real table reach for. The job is
reading a life total from across the table, and every ruling below serves it.

- **The numeral is sized from its own panel, never the viewport.**
  `--life-size` is `min(60cqh, 44cqw)` of the panel's cell (axes swapped on a
  sideways seat), and the ± and their spacing derive from it. A per-player-count
  `vmin` clamp drew a 62px number in a 410px seat. Two-seat boards take 72% of
  the height; a short panel (under 10rem across a sideways seat, 12rem tall
  upright) drops to ~40%, because the 44px corner chips are fixed-size and a
  percentage alone runs the digits into them.
  ⛔ **The 12rem-tall-upright short tier stayed at `38cqw` (gestures audit,
  2026-09-25):** the base ceiling above moved 38 → 44 once Bebas Neue (below)
  made the width axis cheap — 4p-pod and 5p/6p's non-wide seats read 56px
  (38%) at every width, and 44 clears them to 65-89px (320-430px) with zero
  new numeral/name/±/chip overlap (`life-board-probe.mjs`, every 2-10p preset
  at 320/390/430). The 12rem tier (5p/6p's own 155px-tall cell at 320px) had
  no headroom to match it — even 39 there put the "up next" designation chip
  into the numeral — so it's the one tier still tuned for the old face.
- **Every board numeral is Bebas Neue, tabular, self-hosted (E416).** The
  life total, the ± step glyphs, the burst count, the commander-damage split
  values and the High Roll value all read the same face via one token
  (`--font-numeral` on `.player-panel`) — never set the family per element.
  Condensed on purpose: it's the Lotus-like look (tall, narrow digits) that
  fits a big total into a short 7-10p seat, the same job `--life-size`'s
  short-cell tiers already do — an earlier pick (Rubik, wide) fought that
  goal instead of serving it. Single weight 400 (Bebas Neue's only weight —
  requesting heavier would synthesize a smeared faux-bold) and
  `font-variant-numeric: tabular-nums` so a total doesn't shift its siblings
  as it changes (verified: without it, digit advance ranges 33.7-45.4px at a
  fixed size; with it, every digit is 40px). Self-hosted (OFL,
  `public/fonts/bebas-neue-400-latin.woff2`) and loaded only by the
  play-board chunk's own stylesheet (`play-fonts.css`, imported by
  `PlayPage.tsx`), so a visitor who never opens a game never fetches it.
  Because the face is condensed, the width axis is cheap: the 7-10p
  short-cell tier's width ceiling loosened (38 → 55cqw) and its height share
  grew (32 → 38cqh) so height, not width, is what actually caps the numeral
  there now — the worst 320px cell (10p) rose 27px (pre-E416) → 29px (Rubik)
  → 34px. The other tiers (default, 2p, the two sideways-short ones) kept
  their original 38 ceiling: raising them the same way grew 5p/6p's numeral
  enough to newly collide with their (un-condensed) name, for no growth this
  font swap actually needed — measured, not assumed. `play-numeral-font.test.ts`
  pins the family, the weight and `font-variant-numeric: tabular-nums` on
  every one of those five selectors.
- **The ± hug the numeral at every count.** Pinned to the panel ends they sat
  on a sideways seat's corner controls.
- **Ink is black or white per seat, whichever reads better.** White everywhere
  gave the W seat 1.8:1. `styles/play-numeral.test.ts` recomputes the choice
  for every palette; a new colour picks its ink there, not by eye.
- **A zero count is not board state.** Poison at zero hides (the "+" chip's
  cover holds it). Commander damage stays because it is the only way into focus
  mode, but at zero it drops the "0" and reads as the action it is.
- **The board ground is black in every theme.** It was already an always-dark
  surface (white rings, near-black hub); a light theme's `--bg` framed the seats
  in a pale border.
- **The hub is ≡, a seat menu is ⋯.** One glyph for two menus made the board's
  one control cluster look like another seat's.
- **Seats face the edge their player sits at.** Three players default to
  `3p-wide-top-sides`: one across the short edge, two on the long edges, like
  `4p-sides` for four. Gestures read in the panel's own axes
  (`toPanelSpace`), so "swipe away from you" works at 90° and 270° as well as
  0° and 180°.

Verify on every preset at 320–820px in a real browser (satellites, numeral vs
rails, ⋯ vs chips) and against `main` for the same run. At 320px some
collisions remain, all smaller than the ones `main` has there.

## Play board: a seat is all number (2026-09-24)

Lotus's model, and the reason its seats read from across a table: a seat
carries its life total, faint ± hints and its name, and nothing you tap
besides. Every other pixel is a −1/+1.

- **No buttons on a seat.** The ⋯ seat button, the counter chips and the turn
  chip are gone. What a seat is carrying still shows, as **read-only badges**
  for non-zero counts (`.pp-counter-badge`, `pointer-events: none`, so a tap on
  one is a life tap). Zero counts don't show at all.
- **Two swipes, both in the seat's own axes** (`toPanelSpace`). _Away from its
  player_: commander damage. _Toward its player_: the seat's drawer, which slides
  down over the seat like a shade and leaves a 44px strip at the player's edge
  (tap it or drag it back to close). The drawer holds everything the seat used
  to have buttons for: commander damage (for anyone who can't swipe), pass /
  start turn, monarch, initiative, out / revive, counters, name, partner, color,
  facing. The seat's **name stays a button** that opens it: the keyboard and
  screen-reader route in.
- **The drawer is a dark sheet**, near-black with a trace of the seat's color,
  so it reads as something over the seat, not more of it.
- **Long press is ±10 at once, then again every 0.6s** (`holdStep: HOLD_JUMP`),
  for life and commander damage. Counters keep the gentle 1→5→10 ramp: a held
  poison counter must never land on 10 in one press.
- **Passing the turn lives in the clock**: its "Player 1 0:12" segment is the
  control, with a pass glyph as its tell. The seat drawer can also take the
  turn directly.
- **Commander-damage mode keeps every seat in its own color** and turns the hub
  gold with the dagger; the hub is then the way back out, from the middle of the
  table where anyone can reach it.
- **The board teaches its gestures once per device** (`BoardGestureHint`),
  screen-relative, and the hub's Help key shows the same rows on demand
  ("How the board works", one list: `boardGestures`). A board with no buttons owes its players that.

## Play board: 7-10 players, and seat order is clockwise (2026-09-24)

Lotus's layout gallery goes to 10 players; ours now does too, in the same
2-column grid model as 2-6. Two rulings, one about capacity and one about a
correctness bug the capacity work exposed.

- **7-10 players fit the existing 2-column model.** 7p and 9p (odd) get a
  Wide top or Wide bottom row for the extra seat, the same device 3p/5p
  already use — never an empty grey cell (`board-layouts.ts`'s `LAYOUTS[7]`
  through `LAYOUTS[9]`). 8p and 10p (even) are fully populated 4- and 5-row
  grids, each with two far/near split variants (`8p-4v4`/`8p-2v6`,
  `10p-6v4`/`10p-4v6`), mirroring 4p/6p's own pair of splits. `MAX_LOCAL_PLAYERS`
  (setup roster), the in-game roster (`BoardSheets.tsx`'s `MAX_PLAYERS`) and the
  backend's recorded-local-result cap (`local-result.ts`'s `MAX_PLAYERS`) all
  moved to 10 together. **Online seats moved to 10 too** (game-core's
  `MAX_ONLINE_SEATS`, shared by `routes/games.ts` and `OnlineLobby.tsx` — was
  `routes/games.ts`'s own `MAX_SEATS`, 8) — an online game's whole state is
  one JSONB row; 8→10 measured as a 1-2KB row-size increase, well inside the
  existing MAX_EVENTS-bounded log's headroom.
- **A very short panel needs a third numeral tier.** 9p/10p at 320px produce
  ~90-104px-tall cells (90px with the clock strip on, the default; 104px with
  both clock switches off), and 7p/8p ~115-132px ones — shorter than the
  5p/6p cells (~179px) the existing `@container (max-height: 12rem)` tier was
  tuned for. A further `@container (max-height: 9.5rem)` step
  (`--life-size: min(32cqh, 38cqw)`) targets these cells — measured with the
  board probe, not read off the CSS.
  ⛔ **Superseded by E416 (2026-09-25):** the numeral-only shrink above used
  to leave a residual numeral/name overlap at 320px (9-10 players) and,
  unnoticed until the board probe was run at 390px too, at 390px as well (a
  145px 9p/10p cell missed the old `9rem` cut by 1px and fell back to the
  12rem tier with no protection at all). The name's own font never shrank
  with the panel — the fixed seam-keepout corner offset costs ~45px of room
  regardless of numeral size, so no amount of numeral shrinking alone could
  clear a fixed ~23px-tall label off a 90-145px cell. The same tier now also
  condenses the name (smaller, tighter line) and the designation-chip rail
  (Monarch/Initiative/Up next — its fixed 28px chip reached into the ± step
  buttons on these cells too), clearing every seat of every 7-10p preset at
  320x568, 390x844 and 430x932, both clock states, with the numeral still
  ≥29px. Every count is collision-free against the hub/clock/undo satellites
  at every width tested (320/390/430/820) — that part scales for free, since
  `seamSatellite` already keys off row/col count, not player count.
- **Seat order is clockwise from above, seat 0 first (fixed for 2-10).** Turn
  order is seat index + 1 (`packages/game-core`), and MTG passes the turn to
  the player on your left — clockwise as seen from above. Before this fix,
  every 3p/4p+ preset listed seats in reading order (TL, TR, BL, BR), which
  zig-zags across the table instead. Every preset's `seats` array (2 through
  10, including the seven 3p variants) is now ordered clockwise from the
  topmost-leftmost seat: far row left→right, down the right side, near row
  right→left, up the left side. A Wide (colSpan-2) seat's position in that
  walk is taken from its right-hand cell, which is what keeps the order
  well-defined even for `5p-wide-middle`'s seat sitting exactly on the grid's
  centre line. `board-layouts.test.ts`'s `clockwise seat order` suite pins
  this by computing each seat's angle around the grid centre and asserting it
  increases monotonically (mod 360) in seat order, for every preset. A local
  game already mid-play when this ships will see seats 3/4 (and similar)
  swap screen position on the next load — seat _state_ follows the seat
  number, so nothing is lost, only where it's drawn. Counterclockwise seating
  is not supported; if it's ever wanted, it's a second `seats` ordering per
  preset, not a reducer change.

**Sideways is now the DEFAULT for 7-10 (2026-09-25).** The Wide-row presets
above were the whole story for one day; a look at real screenshots of Lotus's
own 7-10p gallery showed people at a real 7-10 player table sit along the
two long edges, the way 4p-sides already seats four — not stacked in rows
facing the short edges. The 2-column model still holds; only the default
changed, and everything the Wide-row presets already offer stays in the
picker.

- **`Xp-sides` (X = 7-10) is `layoutsForCount(X)[0]`, the new default.** 8p
  and 10p (even) split cleanly, every seat rotated 90°/270° by COLUMN
  (`8p-sides` 4+4, `10p-sides` 5+5) — the same col-seam construction as
  `4p-sides`, just taller. 7p and 9p (odd) can't split evenly, so — the same
  move `3p-wide-top-sides` makes for 3 — the extra seat takes a Wide top end
  (rot 180) and the rest split evenly (`7p-sides` 3+3, `9p-sides` 4+4).
- **`Xp-ends` is new too: a seat at each short end, the rest along the
  sides.** Both ends are Wide (top rot 180, bottom rot 0); the remaining
  seats split between the columns. 8/10 (even, minus the two wide ends
  leaves an even remainder) split cleanly (`8p-ends` 1+3+3+1, `10p-ends`
  1+4+4+1). 7/9 (odd, minus two wide ends leaves an odd remainder) can't —
  one column gets one more seat than the other (`7p-ends` 1+3+2+1, `9p-ends`
  1+4+3+1) and the shorter column's far cell is `empty` rather than
  shrinking the grid to fit it.
- **`Xp-sides` (7p/9p) uses a COL seam even though its top seat is Wide.**
  `3p-wide-top-sides` gets away with a row seam because it has only ONE
  sideways row below the wide top seat; `7p-sides`/`9p-sides` stack three
  and four. A row seam's undo satellite offsets ±3.4rem horizontally from
  centre — a margin measured against upright/180° panels — and at 4-5 rows
  the sideways rows are short enough that their step buttons sit close
  enough to the seam in absolute px to be inside that margin: measured
  90-100px² of undo-vs-step overlap at 320px, on the sideways row on
  _both_ sides of wherever the row seam landed (row 1 or a centred row 2 —
  moving the row didn't fix it, since both neighbouring rows are sideways
  either way). A COL seam sidesteps the whole problem: `seamSatellite`'s
  col-seam quarter-point rule (E299/E310) already keeps satellites off
  every panel's furniture regardless of row count, and the hub lands
  dead-centre (`left/top: 50%`) — which reads fine even with a Wide seat
  at row 1, per the screenshot taken while fixing this. `8p-sides` and
  `10p-sides` were always col-seam (no Wide seat at all, so this never
  came up for them).
- **A mixed-rotation layout still needs one seam.** `Xp-ends` has no single
  row where every seat above is one rotation and every seat below is
  another (the side seats are 90°/270° regardless of row), so there's no
  rotation boundary to place the hub at the way a pure Wide-row layout has.
  It takes the row seam at `Math.floor(rows / 2)` — the vertical middle of
  the grid, same convention `Xp-sides` now uses above and the existing
  wide-middle presets already used for a seam that isn't a rotation
  boundary — which keeps the hub centred rather than pulled toward
  whichever end happens to be first.
- **Every new preset passes the existing clockwise/fill-grid suites
  unmodified** (`board-layouts.test.ts`'s `every preset fills its grid
exactly` and `clockwise seat order` both iterate `layoutsForCount` for
  every count, so the new ids were verified for free) plus a dedicated
  `7-10p Lotus sides/ends layouts` suite for the default-per-count,
  even/odd split and seam-sanity assertions specific to this change.
- **Numeral sizing is unchanged by this ruling.** A sideways cell on these
  boards gets the same container-query tiers every other sideways seat
  already uses (`[data-sideways]`, keyed off the panel's own cqw/cqh, not
  the preset id) — nothing here is preset-specific CSS. Re-measure once the
  Bebas Neue numeral face and its tier re-tune land (a concurrent change);
  this ruling only adds seat geometry.

## Play board: the hub ring and its table moments (2026-09-24)

Lotus parity group 2 (`BoardHubMenu.tsx`, `GameBoard.tsx`'s High Roll section,
`lib/util/use-fullscreen.ts`). The hub was a direct shortcut to the game menu;
tapping it now opens a fan of labelled petals first, Lotus's radial menu.

⛔ **Superseded in part by "the hub ring's keys, dock and sheets" below
(2026-09-26, T155):** the five pill petals, the Menu petal and the tabbed game
menu are gone. What still stands from this section: the ring is
`useMenuKeyboard` over a `role="menu"`, the full-circle-first geometry of
`hubPetalPositions`, High Roll as a seat-level moment, Restart's confirm copy,
and the fullscreen rulings (the manual toggle is now a Settings switch).

- **The hub opens a ring, not the menu.** Tapping `.game-board-menu-btn`
  outside commander-damage mode fans out five screen-relative petals —
  Restart, High roll, Players, Menu, Help — and the hub itself becomes ✕.
  Restart and Players are dropped for a viewer who can't control the table
  (mirrors the game menu's own Setup-tab gating); High Roll drops once the
  game is finished. Menu and Help stay reachable always. **Players** jumps the
  game menu straight to its Setup tab (`GameMenu`'s new `initialTab` prop) —
  it exists so "change the layout" is one tap from the ring instead of two
  taps through Now. **Menu** opens the same sheet at Now, unchanged.
- **The ring is a real menu, reused, not reinvented.** `BoardHubMenu` is
  `useMenuKeyboard` (the same hook OverflowMenu/SelectMenu use) pointed at a
  `role="menu"` of `role="menuitem"` petals: focus moves into the first petal
  on open, Arrow/Home/End roam it, Escape and an outside tap close it and
  return focus to the hub. A backdrop sits behind the petals for the same
  reason `.game-menu-backdrop` exists — an outside tap meant to dismiss must
  land on something covering the panels, or it falls through onto whichever
  seat is underneath it.
- **Petals go evenly around a full circle when the hub has room, Lotus's own
  layout — a half-circle fan is the fallback, not the default.** The first
  cut fanned every hub across a half-circle toward the viewport's middle
  unconditionally, which put five petals lopsided around a hub that already
  has room on every side (true for every layout this app's fixed 2-column
  board can produce — only a seam's row varies, its column is always
  centred) and let two of them nearly touch. `hubPetalPositions`
  (`lib/play/board-hub-layout.ts`) now tries a full circle first — 72° apart for
  five, starting straight up — at the largest radius that clears every
  petal's own angle (exact per-angle geometry, not a coarse four-direction
  guess: a full circle whose specific angles never point due left/right
  isn't penalized for a constraint none of its petals actually hits) and
  never smaller than the radius that keeps adjacent petals from overlapping
  (solved from the chord length between points `2π / count` apart). Only
  when that floor doesn't fit anywhere does it fall back to the half-circle
  fan toward the open side, tuned the same way against the hub positions
  this app's own presets can reach — not against a literal viewport corner,
  which this board's fixed-centred-column geometry can't produce and which
  five petals at their real measured width (101px, the widest label) can't
  occupy without overlapping regardless of algorithm (verified empirically:
  every arrangement tried still overlaps inside roughly the closest 40-45%
  of either dimension). Every point is still clamped inside the viewport as
  a final safety net. Pure and unit-tested on its own, including a pairwise
  rectangle-overlap check at the hub positions this app's boards actually
  produce — this is the one part of the ring worth trusting to arithmetic
  rather than an eyeball pass at one layout.
- **The ring hides the clock and undo satellites while open**, the same
  ruling commander-damage focus mode already established for the clock — a
  petal landing on top of a satellite is exactly the seam collision the
  three seam rules above exist to prevent, and hiding is cheaper than adding
  a fourth keep-out zone.
- **Board-level Restart reuses the game menu's own confirm, verbatim.** Same
  title, body and `reset` dispatch as the Setup tab's Reset — a table-level
  action gets a table-level entry point, not a second copy of the copy. A
  local game's `reset` still needs the `start` that follows it (see the life
  counter board invariants memory) — `dispatchLocal` already chains that, so
  the board-level Restart button is not a second place that has to remember it.
- **High Roll is a seat-level moment, not a screen-level one.** Each living
  seat's d20 renders inside that seat's own panel — same trick as commander
  damage and the seat drawer — so it's already rotated to face that player
  instead of needing its own counter-rotation math. The rolled number is
  sized off `.player-panel`'s own `--life-size` (play-board.css) rather than
  a fixed cap — the overlay lives inside the panel, so it inherits the same
  per-player-count, short-panel-tier-aware value the real life numeral uses,
  and reads like an actual life total instead of a third its size. The die
  glyph stays small and the "goes first" caption stays caption-sized so
  neither competes with the number for the read. The overlay covers the
  whole panel (`role="presentation"`, dismiss only on `e.target ===
e.currentTarget`, mirrors the win celebration's backdrop) so a
  dismiss-tap can't fall through to a life change, and every panel's life
  taps disable for the moment's duration regardless of whose seat is
  showing the roll. It dismisses on a tap, on Escape, or after four seconds.
  Ties re-roll only the tied seats (`highRoll` in `lib/play/game-tools.ts`) and
  the winner is recorded through the exact same `settings`/`pass-turn`
  dispatch pair the quiet "First player" tool already uses, so both routes
  feed one on-the-play stat. The two tools stay separate on purpose: High
  Roll is a ceremonial table moment (a d20 per seat, a winner treatment,
  four seconds to read it) and "First player" is a quiet menu pick — folding
  them into one code path would save a few lines at the cost of blurring two
  moments the rest of this section treats as different in kind.
- **Fullscreen is offered, never forced, and only where a gesture can ask for
  it.** `lib/util/use-fullscreen.ts` gates on `document.fullscreenEnabled` AND
  `(pointer: coarse)` — a mouse user already owns their window, and an
  unsupported browser (iOS Safari among them) gets a hook that quietly does
  nothing rather than a menu item that fails silently when tapped. The board
  requests fullscreen on the first pointerdown anywhere on it (a capture-
  phase listener, so it fires ahead of a panel's own `stopPropagation`) —
  once per mount, not on every tap, because the Fullscreen API needs a
  genuine gesture and re-asking after someone backs out of it reads as a nag.
  The menu keeps a manual "Full screen" / "Exit full screen" toggle for
  anyone who dismissed the browser's own prompt or wants back in later.
- **The board leaves fullscreen the way it found it.** Every way off the
  board — Minimize, Clear the table, finishing and navigating away — exits
  fullscreen if and only if the board's own request (first-gesture or the
  menu's manual toggle, one shared `useFullscreen({ exitOnUnmount: true })`
  instance for both) is what caused it. Ownership is confirmed by
  `fullscreenchange`, never assumed the instant `enter()` is called — the
  request is async and can be silently rejected — so a fullscreen the user
  entered some other way is never yanked out from under them on the way out.

## Play board: the hub ring's keys, dock and sheets (2026-09-26, T155)

Board T155, E442/E443, Direction A of the mockup. The pill petals read as
five chips scattered over the seat colours, the Menu petal led to a tabbed
catch-all, and Players was the same sheet at another tab. Now the hub opens
one object, and every key opens one focused sheet. `BoardHubMenu.tsx`,
`BoardSheets.tsx` (shell + Players, Settings, History, Help, Leave),
`DiceSheet.tsx`.

- **The ring is six labelled rect keys on one circle round the ✕**, over a
  scrim that takes the seats to 38%, with a dark disc behind the keys and a
  faint track through their centres. Clockwise from the top: High roll, Dice,
  Players, Settings, Help, Restart. High roll is first so a pointer or
  keyboard open lands on the table moment; Restart is last so focus never
  lands on it first. Keys are 72×64 (66×60 on a grid under 359px wide), a
  6px rect with the icon over its word: never a pill, never Lotus's circle.
  The hub stays round (existing board chrome). The d20 glyph is
  app-invented, so it never appears without "High roll" (glyph literacy b).
- **A dock along the board's bottom edge holds the places you go away from
  the table:** History · Rules · Leave. It sits over the clock strip, and the
  ring's geometry is bounded to the seat grid AND above the dock, so with the
  clock strip turned off a key still can't land under it. The dock caps at
  30rem wide and centres on a tablet. A compact board stacks each dock
  item's icon over its word.
- **Keys and dock are one menu, one order.** `useMenuKeyboard`
  (`preventScroll: true`) over `role="menu"`: keys clockwise, then the dock;
  Arrow/Home/End walk that list, Escape and an outside tap close and return
  focus to the hub. A pointer open still moves focus to High roll without
  drawing its ring (state on the panel, not a classList edit: the panel's
  className re-renders when the compact size applies). Undo hides while the
  ring is open.
- **Gating.** Players and Restart are host-only and drop once the game is
  finished. A finished board shows Rematch (the one filled key, where the
  ring starts), Dice, Settings, Help, and the dock's Leave becomes **Clear
  the table**, which acts at once: the result is already in History.
- **Placement is `hubPetalPositions`, unchanged**, fed the key's box. Its
  bounding-circle floor is conservative; on a hub high on a short board the
  full circle at the room available still clears (measured below).
- **Reduced motion:** keys are placed, never flown out; the fade is the only
  motion and reduced motion drops it.

**Every sheet is one shell (`BoardSheet`):** grabber, a title with one meta
line (its `aria-describedby`), a 44px rect ✕, ONE scroll region, and a footer
only when there is something to commit. Corners are `--radius-lg`, top only
on a phone; a centred dialog on a roomy unrotated board; `90cqw` tall on a
board kept still in landscape. It renders inside `.game-board-rotator`, so it
rotates with the board, and takes `useOverlayDismiss` (Escape, the Tab trap,
focus back to the hub). Focus lands on the first control that does something,
the `data-autofocus` one when a sheet names it, never on the ✕; a sheet with
nothing to act on focuses itself. Buttons are the `Button` tiers, at most one
primary per sheet, and every button keeps 44px at every pointer (touch-first
surface). Section headings are `.form-section-heading`.

- **Dice** is one control: a count stepper (1 to 20) and six die keys whose
  labels are what a tap rolls (`3d6`), rolling at once; **Other…** opens a
  sides field and the sheet's one primary, Roll (disabled with "A die has 2 to
  1000 sides." when the field can't be a die). The result slot is always
  there, `aria-live`, and before a roll it shows the unknown-value dash and
  "No roll yet". Flip a coin and Pick first player land in the same slot.
  First player stays separate from High roll (the ceremony vs the quiet
  pick); a finished table keeps only the coin.
- **Players**: Seats (roster, remove keys, Add player; at two seats remove
  stays visible and disabled with the reason), then Layout (the picker, now
  with each preset's name under its thumbnail as its accessible name, the
  default-for-N switch, Custom… for the editor). Once life moves the roster
  locks and the lock note carries its fix as a link: "Restart…", the board's
  one Restart confirm. No primary: a layout applies at once.
- **Settings**: Taps, Clock strip, Seats, This device. **Full screen is a
  switch** in This device (it's a state), hidden where `useFullscreen` is
  unsupported. No Save; a finished table drops Taps.
- **History**: the rules as the meta line, then time on turn, this game's
  stats, life over time and the log. Before anything has happened it is one
  two-part empty state, not four empty sections.
- **Help**: `boardGestures` rows (the first-run card's own list) with a
  small seat diagram each; "Got it" is the footer's primary.
- **Leave**: End game… (primary, the winner picker follows), Minimize
  (secondary), then Discard game in the danger tier below a divider, which
  still confirms. Each row carries a one-line hint.
- **The two confirms are unchanged.** Restart (from its key, or the Players
  lock note) and Discard (from Leave) are today's `ConfirmDialog` copy
  through the app-wide `Modal`: a full-board dim, screen-relative even when
  the board is kept still.
- **Removed as duplicates:** the menu's Reset (= Restart), "How the board
  works" (= Help), the menu's Undo (the seam undo is the one Undo), the
  Menu petal. The online-only branches (voice link, "Leave the table", the
  game code title) were dead: `GameMenu` only ever rendered on the local
  board.

Measured with `life-board-probe.mjs HUB=1` (keys vs viewport, grid, dock and
each other, real touch on the hub) on all 33 presets at 320x568, 390x844,
430x932, 820x1180 and the landscape keep-still board (844x390, both
landscapePrimary and landscapeSecondary), 198 runs, every one picked and
applied: zero key overlaps, zero keys off-screen, on the hub or on the dock,
zero clipped labels, keys 72×64 (66×60 compact) and dock items 54px tall
inside the 56px dock. Closest keys 21.5px apart and ≥35.5px inside the grid
everywhere but one: `8p-2v6` at 320x568, the hub highest on the shortest
grid, where the circle shrinks to the room there is and the closest keys sit
5.4px apart, 8px inside the grid. The dock clears the lowest key by ≥46.7px
(`4p-wide-middle` at 320). Guards:
`BoardHubMenu.test.tsx`, `GameBoard.hub.test.tsx`, `BoardSheets.test.tsx`,
`DiceSheet.test.tsx`, `board-hub-layout.test.ts`, and the ring's px floors in
`styles/play-touch-targets.test.ts`.

## Play board: the table clock is pausable and optional at setup (2026-09-24)

Two independent device preferences replace the single `showClock` flag: **Game
timer** (the total, and lets it be paused) and **Turn tracker** (the active
seat's turn time and the pass-turn control). Either can be off; the strip
itself disappears only when both are (see the edge-strip ruling below for the
control's own shape).

- **Pausing is a logged EVENT, never a stored field.** `{ type: 'clock',
paused, actorSeat }` pushes one `clock` event per tap; `isClockPaused` folds
  the log for "is it paused right now", the same design as `activeSeat` being
  a fold over `turn` events. A state with no `clock` events reads as "never
  paused" by construction, so a persisted row from before this shipped needs
  no migration.
- **Every derived reading subtracts paused time**, including a pause that
  spans a turn change (each interval's own subtraction only counts the
  overlap that falls inside it, so the paused stretch splits correctly
  between the outgoing and incoming seat) and a game that ends mid-pause
  (the interval's own end caps it, so the clock freezes exactly where it
  was). Read `clockView(game, now)` rather than re-deriving any of this by
  hand — it bundles total, paused, active seat, turn and per-seat totals in
  one call.
- **Tapping the total pauses/resumes it.** A real button (`aria-label`
  "Pause the game clock, 12:04" / "Resume…"), and a paused state that pairs a
  pause glyph with the word "paused" in the visible text — never colour alone.
- **Not undoable.** Pausing is a table decision, not a misclick to
  compensate; it is deliberately excluded from `isUndoable`'s five kinds.
- **Passing the turn stays reachable with the tracker off**, from the seat
  drawer's "Start turn here" — the clock strip's Pass button is one route to
  it, not the only one.
- **Turn time belongs to the tracker, not the timer.** It shows whenever
  Turn tracker is on, with or without the Game timer — a table that only
  wants to know whose turn it is still gets to see how long that turn has
  run, since that's the tracker's own job, not the timer's.
- **Defaults both on.** The board has shown the clock since it shipped, so an
  upgrading device keeps exactly what it already showed (its old `showClock`
  value carries into both new flags); a fresh install also starts both on,
  since the app isn't asking someone to opt into a feature they already had
  by another name.

## Play board: the table clock is an edge strip, not a seam satellite (2026-09-24)

Four interactive prototypes were built and tried (a seam pill, a "Done"
button on the active seat, a hub ring, an edge strip); the edge strip won.
`GameClock.tsx` now renders a single full-width strip along the board's
**bottom edge** — the device holder's own edge — as a normal flex child of
`.game-board` (which is `flex-direction: column`), stacked _below_
`.game-board-grid`. The old floating seam pill (`.game-board-clock`, offset
from the hub via `seamSatellite`) is gone; the seam now carries only the hub
and undo.

- **A sibling, never an overlay.** The grid has `flex: 1`, the strip has
  `flex: 0 0 auto` — the grid shrinks to make room for the strip, rather than
  the strip floating on top of a seat. This is also why the strip needs none
  of the old pill's pointer-events choreography (`pointer-events: none` on
  the wrapper, `auto` per control): it occupies its own space, so every
  control is a plain button.
- **Screen-relative, safe-area for free.** Never rotated to a seat, same
  ruling as the win celebration. `.game-board` already pads every side for
  `env(safe-area-inset-*)`; the strip being an ordinary child of that padded
  box is what keeps its buttons clear of a home indicator — it carries no
  safe-area CSS of its own.
- **One line, always.** At 320px there is a full sentence ("Game 12:04 ·
  Max's turn 1:12") plus two buttons to fit on one row. Only the active
  player's **name** is allowed to shrink (`.game-clock-strip-name`,
  `max-width: 6ch` mobile-first, a `min-width: 2ch` floor so it never
  vanishes to nothing) — every other segment (`Game 12:04`, the separator
  dot, `'s turn 1:12`) is `flex: 0 0 auto` and never wraps or clips instead.
  Text and button sizing themselves are mobile-first tight (`--text-xs`,
  tight gaps) and widen at `min-width: 600px`, the same convention the rest
  of the board uses, rather than starting roomy and trying to shrink.
- **Real 44px buttons, not a ghost.** The old pill was too small to carry its
  own touch floor, hence the invisible `::after` ghost pattern. The strip has
  genuine room, so Start/Pause/Pass are simply `min-height: 2.75rem` on
  coarse pointers — no ghost needed.
- **The "up next" marker is quiet, and reuses the designation rail.** A seat
  about to take the turn gets a faint, icon-only chip (`ChevronRight`,
  `.pp-designation-chip.is-next`) in the same `.pp-designation-chips` rail as
  Monarch/Initiative — not a new corner, not a new collision to test. It's
  read-only (`pointer-events: none` via the rail), dimmer than a claimed
  designation so it never reads as a third one, and never marks the active
  seat itself (there's nothing to be "next" relative to a lone survivor).
  `nextActiveSeat` (game-core, now exported) computes it — the same
  alive/sort/wrap logic `pass-turn` already uses, so the marker can never
  disagree with where a tap would actually go.

## Play board: the remaining Lotus settings, and counterclockwise seating (2026-09-24)

The last lane of the Lotus parity program — the settings list beyond timer/
tracker (already shipped, see above): low life warning, underlined 6/9,
minimalist mode, a per-bracket starting life, and a table-level turn
direction.

- **Low life warning fires below 10, gated by a device pref (default on), and
  is a wash, not just a ring.** `isLowLife` (`GameBoard.tsx`) widened from 1-5
  to 1-9 to match Lotus's own "below 10" wording, and now reads
  `lowLifeWarningEnabled` from the play store before applying at all. The
  first pass kept the pre-existing thin ring unchanged; a design pass over
  screenshots found that read as barely-there next to Lotus's own "blinking
  red alert" from across a table. `is-low-life::before` (`play-enhancements.css`)
  now pulses a translucent red `background` wash across the WHOLE panel
  together with the ring/glow (1.4s, peaking at 0.24 alpha so the numeral
  stays legible) — still not colour-only (the wash+ring only exist in the
  danger state, a structural cue) and still steady-red (no blink) under
  `prefers-reduced-motion`, at the wash's peak intensity rather than its
  resting one so reduced-motion doesn't read as a quieter warning. It
  composes with every other state ring by construction: `is-active-turn` /
  `is-lethal-flash` paint on `::after`, `is-winner`'s box-shadow sits on the
  real element, and none of them share `::before` — verified by starting a
  seat's turn while it's also below 10 life and confirming both the white
  ring and the red wash render at once.
- **Underlined 6 and 9 is a shared digit renderer, not a per-surface hack —
  and each mark is its own short bar, not one continuous underline.**
  `numeralDigits(value, underline)` in `GameBoard.tsx` wraps only the `6`/`9`
  characters of a number in `.pp-digit-underline` spans when the device pref
  is on; off, it returns the plain number so the DOM is byte-identical to
  before the pref existed. One function feeds all three numerals that can sit
  upside down across a table — the life/commander-damage numeral, a Partner
  seat's split-half numeral, and the High Roll die value — so a fourth numeral
  can never quietly skip it. The mark itself is a per-digit `::after`, not
  `text-decoration: underline`: two adjacent underlined characters ("69",
  "66") drew as one unbroken bar with `text-decoration` (no gap between
  characters), which read as a stray extra digit rather than two marked
  ones. `::after` sized to a percentage of the DIGIT'S OWN inline-block box
  (18% inset each side) keeps every mark short, rounded and separate
  regardless of how many underlined digits sit side by side, holding at
  every `--life-size` tier including the smallest (a 6-player board at
  390px) — verified on both an upright and a sideways seat with "69", "96"
  and "66". The aria-label on the life button still reads the plain number
  (unaffected — it's a separate attribute, not derived from the digit
  spans' text content).
- **Minimalist mode hides the ± glyphs, not the controls.** `.is-minimalist
.player-panel-life-wrap > .player-panel-step-btn` uses the standard
  clip-rect sr-only pattern (1px box, `overflow: hidden`, `clip: rect(0,0,0,0)`)
  instead of `display: none`, so the buttons stay in the DOM, focusable, and
  announced — only a pointer user loses the visible glyph, and the tap-zone
  halves (already invisible) are the primary gesture regardless. Scoped to
  the life numeral's own step buttons on purpose: the commander-damage
  split-half steps (`.pp-cmd-half-step`) sit in a flex row keyed to their own
  visible width, and hiding them the same way would re-center the split
  value oddly for a pairing (minimalist + Partner focus) rare enough not to
  be worth that risk. **The burst-count badge ("-3") is dropped in minimalist
  mode along with its button** — it's chrome for the same control, not an
  independent readout, so there's no second home to give it. Decided rather
  than defaulted: revisit only if a table actually asks for the burst back
  without the glyph.
- **Starting life remembers the last value chosen per player-count bracket
  (2 vs 3+), and a format pick always wins over that memory.** Two device
  prefs, `startingLifeTwoPlayer` / `startingLifeMultiplayer` (play store v3,
  default `null` = "no override yet"). Precedence, on the local setup form:
  1. **A loaded table profile wins outright** — a profile is an explicit
     reset (see the table-profiles ruling above), not a bracket-memory
     candidate, so loading one suppresses the save-on-change effect for that
     update and re-primes the bracket tracker to match the profile's own
     roster size.
  2. **Picking a format sets its canonical life**, unconditionally — the
     existing `applyFormat` behavior, untouched. This also becomes the new
     "last chosen" value for whichever bracket the table is currently in
     (nothing suppresses the save effect here), since a format pick is as
     much a deliberate choice as dialing the stepper.
  3. **A manual stepper edit is remembered** for the bracket the table is in
     right now.
  4. **Crossing 2↔3+ players applies the OTHER bracket's memory**, or the
     current format's default if that bracket has no memory yet — never the
     bracket you're leaving. This is one `useEffect` keyed on `count`,
     comparing against a `prevBracketRef` so it only fires on an actual
     crossing (not every add/remove-player click within a bracket), paired
     with a `suppressBracketSaveRef` so applying the OTHER bracket's value
     doesn't immediately get written back as if the user had chosen it.
- **Turn order travels with the GAME, not the device.** `GameState.turnOrder`
  (`'clockwise' | 'counterclockwise'`, game-core) is optional and settable
  through the existing `settings` action, same as `layout`/`tapOrientation` —
  presentation, not a rule, so it earns no log row and the backend validates
  it the same way it validates `visibility` (`invalidTurnOrderError`,
  `routes/games.ts`). It is picked once on the **local setup form**, next to
  Game timer / Turn tracker (a `SwitchRow`, "Counterclockwise seating") — a
  fact decided before the game starts, unlike the device-level board display
  prefs above (which live in the hub's Settings sheet instead).
  - **The reducer's own turn order never changes.** Seat index + 1 is still
    the whole rule. What changes is which SEAT sits in which CELL:
    `board-layouts.ts`'s `layoutsForCount`/`resolveLayout` take a `turnOrder`
    argument and, for `'counterclockwise'`, reorder a preset's `seats` array
    to `[s0, s(n-1), …, s1]` — seat 0 (the topmost-leftmost anchor) stays put,
    the rest run backward. Seat index + 1 read against a reversed placement
    already goes the other way around the table, so nothing about pass-turn,
    the next-seat marker, or a recorded first player needed to change; they
    all key off seat index, and seat index's on-screen position is the only
    thing that moved.
  - **A custom (user-arranged) layout ignores `turnOrder` entirely** — it
    already IS the order the user set by dragging seats into place, and
    reversing it out from under them would be the surprise, not the feature.
  - **The layout picker's previews carry `turnOrder` through** (`LayoutPicker`
    now takes it, the Players sheet passes `turnOrderOf(game)`), so a picker shown
    for a counterclockwise table shows counterclockwise thumbnails — the seat
    numbers printed on each preview cell are what actually prove it at a
    glance.
  - **Verify geometrically, not by eye**: `board-layouts.test.ts`'s
    `clockwise seat order` suite gained a mirror-image counterclockwise
    assertion (angles run the other way around the grid centre, excluding
    the one seat0→seat1 edge that wraps through the anchor) plus a seat-0-
    stays-put check and a legacy-state-reads-clockwise check.
  - **It survives every flow that re-seats the same table.** Turn order is a
    fact about how the people at the table are sitting, so `RematchTemplate`
    (`gameToRematch`) and table profiles (`LocalGameSetup.turnOrder`, already
    part of `buildSetup`/`applySetup`) both carry it — a counterclockwise
    table stays counterclockwise through Rematch or a saved/reloaded profile.
    `recordToRematch` is the one gap, and it's a real one, not an oversight:
    `GameRecord` (persisted history) never stored `turnOrder` — it's
    presentation, not a rule the history table tracks, same reasoning as the
    partner-less/poison-off gaps that function already documents — so a
    rematch from History starts clockwise regardless of the original table.
    A legacy profile (saved before this field existed) reads as clockwise,
    same as a legacy `GameState`.

## Play board: landscape keeps the board still (2026-09-25)

A phone lying flat on the table between players, bumped into landscape, must
not spin every seat — the user's own ruling, and the opposite of the
playtest table's `RotatePrompt`, which explicitly **wants** the phone turned
sideways (to see more of the battlefield) and never locks orientation for
that reason. Both rulings stand; they answer different questions. The life
board isn't asking the player to turn the phone — it's refusing to let an
accidental bump change what's rendered.

- **The whole board counter-rotates as one rigid unit, not per-seat.**
  `GameBoard.tsx` wraps the seat grid, the clock strip and every board-owned
  overlay except `ConfirmDialog` in `.game-board-rotator`
  (`play-board.css`). Under `(orientation: landscape) and (max-height:
500px) and (pointer: coarse)` — the same "phone on its side" query
  `RotatePrompt` uses — `data-board-rot` (set by `lib/play/use-board-keep-still.ts`'s
  `useBoardKeepStill()`, reading `screen.orientation.type`) drives a CSS
  `rotate(90deg)` / `rotate(-90deg)`, and the rotator's own local width/height
  are swapped via `cqw`/`cqh` container-query units (`.game-board` becomes a
  size container only inside that same media query) — the only way to say
  "my width = my parent's height" in CSS without JS-measuring pixels. Outside
  that condition `.game-board-rotator` is a transparent passthrough; nothing
  about the ordinary (portrait, or a tall-enough landscape tablet) board
  changed.
- **A panel's own seat rotation (`slot.rot`) is never touched.** It composes
  with the board's counter-rotation automatically through ordinary CSS
  transform nesting — a panel rotated 90° inside a board rotated another 90°
  simply paints at 180°, the same way any nested `transform` composes. The
  ONE thing that does NOT get this for free is code that reads raw pointer
  coordinates (`clientX`/`clientY`, and the deltas `useTapAndHold`'s
  `toPanelSpace` derives from them) — those are always true screen-space,
  unaffected by CSS transforms, so `PlayerPanel`'s `gestureRotation =
(rotation + boardRotation) % 360` composes the two explicitly and feeds
  that into `recordPointer`, both `useTapAndHold` calls (life + partner
  half) and `SeatMenu`'s own close-swipe. Miss this and a swipe that used to
  open a drawer in portrait silently stops registering once the board is
  rotated (the axis-ratio gate in `tap-and-hold.ts` just never crosses
  threshold) rather than opening the wrong thing — quiet, not loud, which is
  why `GameBoard.board-rotation.test.tsx` pins it by checking the OLD screen
  gesture stops working and the newly-composed one takes over, not just that
  SOME gesture opens the drawer.
- **The hub ring rotates WITH the board, reversing its usual "screen-relative"
  rule.** `BoardHubMenu`'s petal math is ordinarily screen-relative — Lotus's
  ring reads upright for whoever's holding the device regardless of which
  seat's rotation the hub sits near (see the hub ring section above). Under
  a board rotation that's wrong: the entire point of "keep it still" is
  reading in the ORIGINAL portrait framing, and a screen-upright ring
  floating over a counter-rotated board would look broken, not correct. It
  gets this for free positioning-wise — `.board-hub-ring`'s `position: fixed`
  automatically resolves against the ROTATED ancestor's own local box once
  that ancestor has a `transform` (a CSS spec rule, not a hack) — but the
  JS math has to switch from `getBoundingClientRect()` (real screen pixels,
  the wrong coordinate system once a transform sits between the ring and the
  true viewport) to `localRectRelativeTo()` (an `offsetParent`-chain walk,
  transform-agnostic by construction) when `boardRotation !== 0`. The
  ordinary (untransformed) path is completely unchanged.
- **The hub sheets, `BoardGestureHint`, `GameClock` and `WinCelebration` all
  rotate with the board too** — they're plain nested JSX inside
  `.game-board-rotator`, no portal, so this needs no extra code: the clock
  strip staying at the device's physical bottom edge and the menu reading in
  the same framing as the seats behind it are both direct consequences of
  being rigidly rotated together with everything else.
- **`ConfirmDialog` is the one exception, and stays screen-relative on
  purpose.** It renders through the shared `Modal` portal straight to
  `document.body`, outside `.game-board-rotator` entirely. `Modal` is used
  everywhere in the app, not just the board; threading a board-specific
  rotation value through it (or forking a second confirm component) isn't
  worth it for a binary Cancel/Confirm dialog that's legible either way —
  confirmed by driving the board's own Restart confirm under a landscape
  rotation and checking it renders fully on-screen, unbroken, just not
  counter-rotated like its surroundings.
- **Fullscreen locks portrait while the board owns it, unlike `RotatePrompt`'s
  "Go fullscreen" (which explicitly never locks orientation — see the
  opening-hand section above).** The two are NOT the same feature reversed by
  accident: `RotatePrompt` wants the player to freely choose to turn the
  phone, so locking there would fight that choice the moment they did;
  `useFullscreen`'s new portrait lock only ever runs for the caller that
  opted into `{ exitOnUnmount: true }` (today, only the life board) and
  exists so a table that's already committed to "keep it still" doesn't get
  yanked into the browser's own auto-rotated layout for the brief window
  before this board's own counter-rotation kicks in. `screen.orientation.lock
('portrait')` fires the instant `fullscreenchange` confirms this hook's own
  `enter()` caused it (never for a fullscreen entered some other way — same
  ownership tracking `exitOnUnmount` already uses) and `unlock()` fires
  symmetrically on the way out, wrapped and swallowed either direction
  (unsupported entirely on iOS Safari, and a rejection is expected on any
  device that disallows locking, e.g. a 2-in-1 laptop) — see
  `use-fullscreen.test.ts`'s `portrait orientation lock` suite.
- **The sign (which of landscape-primary/-secondary maps to +90 vs -90) is
  verified in headless-Edge emulation, not on real hardware** — there's no
  physical device in this environment to rotate. What IS verified: the
  transform is a clean, unmirrored rigid rotation (checked by mapping all
  four corners of a `4p-sides` board through the emulated rotation and
  confirming they land exactly where a geometric 90°/−90° image rotation
  predicts, no distortion), and primary/secondary produce opposite
  handedness, which is the part every downstream consumer (gesture
  composition, the hub ring, the CSS transform) actually depends on. If a
  real device shows the board spinning the wrong way, the fix is the
  one-line swap called out in `use-board-keep-still.ts`'s own `ponytail:`
  comment — nothing else needs to change.
- **Left for later:** the custom layout drag-and-drop editor
  (`LayoutEditor.tsx`'s `dnd-kit` sensors) was not verified or adapted for
  board rotation — dragging seats into place while the phone is held
  sideways may not track the pointer correctly. Rare in practice (editing a
  seating chart mid-game, sideways, is an edge case of an edge case) and out
  of scope for this pass; a future session should drive it under
  `Emulation.setDeviceMetricsOverride` before touching it.

## Play board: the life keypad is a board-level dialog, and the commander-damage focus bar keeps its full copy (2026-09-25)

Two Lotus-parity fixes to the life-counter board, batched together because
both were measured on the same short/sideways seats.

- **The life keypad moved from an in-panel cover to a board-level dialog.**
  `GameBoard` owns which seat it's open for and renders one `LifeKeypad`
  instance (inside `.game-board-rotator`, so it rotates with the board's own
  landscape lock like every other overlay there) that dims the whole board
  and rotates to face the seat that opened it, sized off the viewport
  instead of one seat's cell. The old in-panel cover crushed to 14-16px
  digit keys on any seat under ~300px — every seat of 4p-sides, the default
  four-player board, among others. This REPLACES the in-panel keypad
  entirely; don't reintroduce a per-panel cover for it. Centring the dialog
  with its own `position: absolute` + `transform: translate(-50%,-50%)
rotate(...)`, not flexbox, is load-bearing: CSS layout runs before a
  `transform`'s `rotate()` applies, so a flex parent shrinks a 90°/270°
  dialog's deliberately-larger local width (meant to become the tall screen
  dimension once rotated) to fit its own available width first — measured
  14px-wide keys from exactly this. A definite-size CSS Grid container also
  doesn't grow a `minmax(44px, 1fr)` track to fit its content the way an
  intrinsic-size one does; it shrinks the track instead, so the rotated
  layout's column split and the digit grid's row-span both needed real
  measurement, not just the spec on paper.
- **The keypad opens already facing its seat, and fits a phone on its side
  (2026-09-26).** Its entrance animates the individual `scale` property,
  never `transform`: a transform in a keyframe replaces the dialog's own
  translate + rotate for the animation's length, so it popped in unrotated
  and off-centre, then snapped to its seat. With the board kept still in
  landscape, the keypad sits inside the counter-rotated board, whose own
  width is the screen's height, while vw/vh stay the physical viewport: a
  sideways seat's keypad ran ~80px off an 844x390 screen. Under that same
  media query it sizes from `.game-board`'s cq units (the board's own axes),
  and measures fully on-screen with 44px keys on every seat tried. The ✕
  holds its 44px width beside a long "Set life · <name>" title (it was
  squeezed to 24-28px on a rotated keypad); the title ellipsises instead.
- **Commander-damage focus mode's bar keeps its full copy — a fixed-height
  single line handles the space problem, not shorter words.** The bar used
  to wrap onto 2-4 lines on a short/narrow seat and cover the focused
  player's own numeral (measured up to 100% coverage). The fix is
  `flex-wrap: nowrap` + a fixed `min-height` the numeral's own centred box
  reserves room for (`--cmd-focus-bar-h`, read by both), **not** trimming
  the words: the title stays "Commander damage received" and truncates with
  an ellipsis if it must, because "Commander damage" is the word that
  actually carries the mode's meaning to whoever reads a cut-off title. The
  Return pill matches the hub's own "Return to game" copy (the hub becomes
  the gold dagger and is the other way out, from the middle of the table)
  at any size that fits it; only a genuinely narrow/short seat (the same
  container-query thresholds the drawer and keypad use) swaps to the bare
  "Return" — two spans in the button, one `display: none`d per size, so the
  accessible name always matches what's shown (neither is `aria-hidden`;
  `display: none` alone drops a span out of the accessible-name
  computation). A first pass shortened both the title ("Damage received")
  and the pill ("Return" always) to solve the same space problem — wrong
  trade: it silently dropped the word that told a reader what number
  they're looking at, for space the fixed-height/ellipsis approach didn't
  actually need to spend that way.
- **The per-seat "⚔ dealt to `<name>`" caption is gone**, replacing itself
  with the panel's own `aria-label` (already carried the same meaning) — it
  used to print directly over the panel's name on a short seat, 300-900px²
  measured. A partner (split) seat's own life total also moved from an
  absolutely-positioned corner chip to an in-flow `<span>` inside the split
  wrap, so it can't land on a half's own − button the way the corner
  overlay did on a short panel.
- **The focused seat's numeral clears both the bar (below) and the name
  corner (above) by pulling in `.player-panel-life-wrap`'s own centred box
  from both edges** — padding on `.player-panel-content` has no effect here,
  a dead end tried first: the life-wrap is `position: absolute; inset: 0`,
  so its containing block is the panel's full padding box regardless of any
  padding set on an ancestor. The top inset is scoped to `:not([data-
sideways])` on purpose — a sideways panel's local top/bottom axis is its
  screen WIDTH after rotation, a scarcer resource than height, and adding a
  second reservation there measured worse, not better. The two shortest
  upright boards (8p-4v4/10p-6v4, not the newer sideways defaults for those
  counts) additionally shrink the numeral itself in focus mode
  (`--life-scale: 0.42`, the same ratio already used for a 5/6-digit total)
  since no inset value alone found a spot clear of both edges there — a
  small, floor-matched shrink, not the numeral cut to nothing.
  ⛔ **Superseded by the space reclaim below (2026-09-26):** the top inset,
  the focused seat's 0.72 scale and the 0.42 shrink are all gone. The 0.42
  had been widened to every 7-10 player board, sideways included, which took
  a 10-player sideways seat's own total from ~38px to 16px at 320px, exactly
  what the ruling above says must not happen.
- **The focused seat gives its corners back to its numeral (2026-09-26).**
  While a seat holds focus its name corner (name and deck subtitle) and its
  designation chips are hidden; counter badges already were, for every seat.
  The bar says what the panel is, the title carries the player's name for a
  screen reader (a visually hidden "<name>: " prefix), and the panel's
  aria-label still reads "<name>: <life> life". The numeral keeps its
  normal tier size. Only where the box above the bar is genuinely shorter
  than that size does a cap bite: `font-size: min(<tier size>, <panel
height> - bar - --space-2)`, in the panel's own axes (the cell's height
  upright, its width sideways). That caught one case, 2p-side's 148px
  sideways seats (a 107px total went 9% under the bar; now 80px, clear).
  Measured on every preset: focused total ≥31px at 320x568 (was 14px on
  9p/10p-ends), ≥50px at 390, ≥79px at 820, 0% under the bar, zero
  text-on-text on any seat.
- **The bar fits the shortest and the narrowest seats without cutting its
  title to a letter.** On touch, the 7-10 player wide rows (79-95px tall)
  tighten the bar to hug its 44px Return (`--cmd-focus-bar-h: 2.9rem`), and a
  narrow seat with height to spare (a sideways seat ≤12rem across, an
  upright one ≤12rem wide and ≥10rem tall) stacks the title above Return in
  a 4.5rem bar. The title had read "C" on a 10-player sideways seat; it now
  reads "COMMAND…" at worst and the full copy on most seats.
- **Partner halves.** The split seat's own life readout sits BELOW the
  halves (above them it sat on the seat's name on every board, 1075px²), the
  wrap clears the name's real line (`--space-2 + --seam-keepout + 1.5rem`,
  0.6rem in the 7-10 player tier where the name condenses to ~7px), and the
  corner's commander subtitle is hidden on a split seat since the halves
  name both commanders. On touch a half's ± are hints, not targets, the same
  F2 ruling as the life numeral's ±: a live 44px circle over the half's own
  tap zone swallowed the press (a long press gave +1, not +10), and the pair
  drew over the value on any seat under ~140px. The rule is scoped through
  `.pp-cmd-half-row` because `.player-panel-content button` re-enables
  pointer events at higher specificity. The halves stack when the seat is
  too narrow for them side by side (a `cmd-split` size container on the
  wrap, so one query covers both orientations), and a stacked half on a
  short seat is one line, name beside value. Residual: on the 7-10 player
  boards at 320px a half's two tap zones are 30-39px on their short axis
  (16 presets), and 36px on 9p-wide and 10p upright at 390px; every half
  still reads cleanly and no text overlaps.

## Play board: a short seat's drawer is one scrolling row (2026-09-26)

On a seat under ~300px on its short axis (every seat of `4p-sides`, the
default four-player board on a phone, and every 5-10 player seat) the seat
drawer's body is one horizontally scrolling row: the actions, the counters as
steppers, then Name / Partner / Color / Facing as chips that swap the row for
that one editor, with a Back chip to return. Same component and same
`activeEditor` state as the tall sheet; container queries on
`.player-panel-cell` pick the shape, keyed by orientation because a sideways
seat's height is its cell's width.

- **Measure the row's height, not only its length.** The first cut checked
  that every chip was reachable by scrolling and at least 44px in its own
  axes, and missed that the row itself was 33px tall on a 148px seat and 0px
  on a 95px one (the 7-10 player wide rows): header (44px) + strip (44px) +
  padding had already taken the seat. Every chip was clipped by the row it
  sat in. A drawer check has to confirm each control sits inside the row and
  the panel after scrolling to it, on a touch-emulated run (the coarse floors
  and the clock strip's 44px buttons change the budget).
- **No header on a short seat.** Its ✕ repeats the strip (same close, same
  44px target, same drag), and the seat's name stays the dialog's accessible
  name. The sheet's padding tightens to `--space-1`/`--space-2`.
- **The shortest upright seats (under 7.5rem) put the strip at the row's far
  end**, a 44px column with an upright grab bar, so the row keeps the seat's
  full height. The shade metaphor holds everywhere else.
- **A counter is `[− value +]` under its label**, one 44px row. Lotus stacks
  the stepper vertically; three 44px rows plus the label need ~135px and the
  row gets 66-100px.
- **Chips never outgrow the row** (`max-width: 100%`), and the Name/Partner/
  Color/Facing group un-wraps with `display: contents` like the actions do,
  so its chips size against the row.
- **Editors keep 44px targets on a narrow seat.** Swatches and facing
  buttons run as one scrolling line of 44px targets (the swatch grid had
  squeezed to 4-23px wide), the name/partner field wraps its Save below it,
  and on touch a tall seat's swatch grid fills with as many 44px columns as
  fit. On a tall sheet a counter's stepper wraps under its label rather than
  squeezing the label to nothing (it went to 1px on a 190px-wide drawer).
- **The row has its own scroll cue.** `SeatMenu` publishes
  `data-overflow-x` (`right` / `both` / `left` / `none`) from the same effect
  that drives the tall sheet's vertical `data-overflow`, and the row fades
  the edge that still has chips behind it, the Tabs.tsx convention. The fade
  is `min(--space-6, 15%)`: a 9-10 player seat's row is one chip wide, and a
  full 24px fade ate a third of that chip.

Measured (headless Edge, touch emulation, every seat of all 33 presets at
320x568, 390x844 and 820x1180): row body 0-40px → 66px minimum at 320,
controls under 44px 2400 → 0 per viewport (the swatch and facing editors),
controls clipped by the row or panel 4394 → 0 at 320 and 1066 → 0 at 390,
clipped labels 1771 → 0 at 320 and 15 → 0 at 820. Guards:
`styles/play-drawer-compact.test.ts`, `SeatMenu.test.tsx`.

## Play board: the board sizes off itself, and every mark fits its seat (2026-09-26)

A final audit of the board after T143 found six layout defects, each one a
rule that only held on the seat or the orientation it was tuned on.

- **Vertical tap areas move the ± with the zones.** With vertical taps on, the
  top half of a seat is +1 and the bottom half −1, so the + sits above the
  numeral and the − below, in the seat's own axes (`.is-vertical-taps`). Left
  beside the numeral, the "+" sat on the zone boundary and a long press on the
  visible "+" gave −10 on every 0° and 270° seat. The stack is centred in the
  box below the name corner's band (`--pp-v-top`) and sized to fit it, so the +
  never lands on the name. A partner half takes top/bottom zones too, its pair
  at the half's far edge, one glyph centred in each zone. In commander focus
  "N to lethal" moves below the −. **Check it by touch**: a long press on each
  visible glyph must give that glyph's sign, on every seat rotation.
- **Nothing inside the board reads the viewport.** Under keep-still the board
  is turned 90° inside a landscape phone, so its width is the screen's height:
  a `min-width: 600px` query still matched the 844px screen and gave the 7-10
  player seats desktop names that sat on their numerals. Every width/height
  media query in a board stylesheet is scoped to an unrotated board
  (`:where(.game-board-rotator:not([data-board-rot]))`), and where the answer
  flips under rotation the rotated board gets the swapped query. A rotated
  board is always under 500px wide, so it takes the phone values. Components
  inside the board that need their own threshold ask their container (the
  clock strip does). Guard: `styles/play-board-viewport-queries.test.ts`.
- **Commander focus still gives the clock strip's space back to the seats.**
  Reserving it (`visibility: hidden`) was tried to stop the 7-10 player
  cells crossing the 9.5rem name tier on the way in, and measured worse: it took
  14px from every 90px cell at 320px, the focused total fell from 31px to
  19px and the numerals ran into the life chips. The name does change tier
  between modes, and that is fine once the board sizes off itself: zero
  text-on-text in focus at 320/390 portrait and both landscapes.
- **High Roll fits the seat's own height.** The number is capped by what the
  die, tiebreak, caption and gaps leave of the panel's height (the cell's width
  sideways), a seat under 8rem drops the die, and a seat 2.5 times longer than
  tall reads the roll along one line.
- **The focused total keeps off the seam.** The focus bar pushes the numeral
  toward the seat's far edge, which faces the seam, so the focused seat insets
  that edge by the seam keep-out (`--seam-keepout` + `--space-1`). Always on a
  sideways seat; on an upright seat only at 12rem or taller, so the 7-10
  player rows keep their totals.
- **Marks read the seat's ink on the ink's opposite** (`--pp-ink-plate`).
  "Up next" stays quiet through a fainter plate and a dashed ring, never a
  faded glyph: at 55% opacity on a dark plate it measured about 1.5:1 on the
  light blue seats.
- **A local board has no host mark.** Seat 0 is "host" there only by
  construction; the ★ stays for online games, where the host runs the table.
- **Names give way last.** A partner half on the shortest seats keeps its
  commander's name on its own line over a smaller value (and drops "N to
  lethal"); a phone-narrow clock strip gives its button padding to the name.

## Daily card puzzle (E558, 2026-09-30)

`/daily`: one card a day, the same for everyone (the UTC day), six guesses.

- **The answer never reaches the browser before the day is done.** The server
  picks each day's card at random from `backend/data/daily/pool.json` and
  stores the pick in Postgres (`daily_puzzles`); nothing in the repo names an
  answer, because the repo is public. `POST /api/daily/play` scores a guess and
  returns only the clues earned so far; the art comes from
  `GET /api/daily/art`, blurred by the server. Never render a Scryfall URL,
  image or name for the card while it is in play: a CSS blur is not a secret.
  The browser holds only `public/daily-names.json`, for suggestions.
- **Its own destination, not a Play tab.** Play is your real games. The header
  gets a Daily link between Play and Social; the phone tab bar is full, so the
  phone door is Home's hero ⋮ ("Daily card"), per
  [§ App chrome](app-shell.md#app-chrome--leather--divider-tabs-t53).
- **Every miss teaches twice.** A wrong guess opens the next clue and gets a
  scored row: colors, mana value, type, rarity and year of the first
  printing. Colors and type read **close** on a partial overlap, rarity one
  step away; mana value and year only ever point (up or down), never "close".
- **A scored cell is never color-only.** Tint + glyph (check, approximately,
  arrow, cross) + an sr-only sentence ("Rarity: Uncommon, close."). The
  legend under the grid names the glyphs.
- **Newest guess first.** It's the row you just made. In a column narrower
  than 34rem the name takes its own line above the five cells and labels
  switch to short forms (Com., Unc., MV), by container query.
- **A locked clue shows only its number.** The server doesn't say what a
  locked clue is, and the card names itself as "this card" in the rules and
  flavor clues: a bar the length of the name would be a clue.
- **Giving up asks once, inline** (it ends the day and the streak), with
  Keep playing beside it. No retry: the card is the same for everyone.
- **Share is squares, never names.** The share text is the Wordle grid (hit,
  close, anything else); it's the one place the page uses emoji, and it's
  clipboard data, not UI copy. On screen, Copy result swaps its own label to
  Copied; Share appears only where `canShare()`.
- **Friends' counts, never their guesses.** Signed in, the server keeps your
  guesses and records your result itself, so the friends panel is honest; it
  shows guesses used and streaks, never guesses.
- **Solve fires the seal** in the card's colors, once, beside the "Solved in
  N" heading that says it in words.
