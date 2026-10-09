# Style guide: Sharing & social

Public shared views, discovery tiles and trades. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, colour and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## Trade offer rows (T120)

The offer card (`TradeOfferList`) is one object that reads as two things
depending on whether it is still a decision:

- **The status pill answers "whose move is it?"** `Your call` (incoming, open)
  and `Waiting on them` (outgoing, open), then `Accepted` / `Declined` /
  `Withdrawn`. Never a bare `Waiting`: on the friend hub, where rows are not
  grouped by what you have to do, it put the same word on opposite situations
  one row apart.
- **The net is stated once, under the two side totals**, as the subtraction
  the reader was doing in their head: `You come out about $40.00 ahead` /
  `They come out about $8.00 ahead` / `About even`. "about" only when a side
  is a floor (an oracle-level ask). It is omitted entirely while a side
  cannot be priced (`+?`), because a subtraction with a missing term is a lie
  with a dollar sign.
- **Decline and Withdraw confirm (E501).** Both are final on the server:
  there is no restore endpoint, so there is no Undo to offer. Each opens a
  danger confirm, `Decline the trade from <who>?` / `Withdraw your offer to
<who>?`, whose body says what the other person sees and ends
  `This can't be undone.` (core § Delete and remove). Accept keeps its own
  step, and Remove needs none. If a server restore ever lands, the confirm
  goes and an Undo toast replaces it; never both.
- **A finished trade is a ledger line, not a decision.** Declined, withdrawn
  and settled rows render `.is-compact`: tighter padding, flat `--surface`,
  no note, no net, the two sides collapsed to two ledger rows (`You give ·
chips · value` over `You get · chips · value`, no arrow, at every width),
  and a `Remove` icon button in the head. The chips stay and stay tappable
  (the record of what changed hands). Anything still in
  motion, including an accepted trade that has not settled here, keeps the
  full card and has no Remove.
- **A line is a card tile, not a chip (E590).** The point of the row is to SEE
  what is changing hands, so each line is a button holding card art at the
  63:88 aspect with the card corner radius, the name under it (two lines,
  ellipsis) and `×N` as a badge on the art. Open offers size the tile by the
  side's own width (a container query on `.trade-offer-side`, because the row
  is a different width on `/trades` and the friend hub): 120px under 20rem,
  144px from 20rem, 160px from 26rem, i.e. two across on a 390 phone and in
  each half of a desktop row. Three across left a desktop row with 90px
  thumbnails in a 760px card, too small to read the printing. A finished
  ledger row keeps the cards at 44px of art (52px from 36rem) with the name
  beside them, so it stays a line but never goes back to a 20px thumbnail.
  The tile stays a button that opens the carousel at that card, keeps the 44px
  coarse-pointer floor and the focus ring, and its accessible name carries the
  name, the quantity and the printing state (`Preview Sol Ring, 2 copies,
  foil`). Loading and error are the same card-shaped box (the name on it), so
  nothing shifts when art arrives.
- **The art is the printing the line names.** A line pinned to a printing
  (`copies[0].scryfallId`) shows THAT printing, resolved by id through the
  batched `usePrintingThumb`, and carries it as `data-scryfall-id`; only a
  line with no printing, or one whose id no longer resolves, falls back to the
  card by name. A pinned nonfoil says nothing extra (the art is the proof); a
  foil or etched printing says `Foil` / `Etched`.
- **An oracle-level ask says "Any printing".** Offers sent before asks were per
  printing have no copies on the ask side. The tile captions it `Any printing`
  (also in its accessible name), and in the carousel the panel opens with
  `Any printing. This one is an example.` so the picture never reads as a
  promise. A pinned line whose printing fails to load is NOT "any printing"
  (the ask still names one); its slide says `Couldn't load the printing in
  this trade. This is another printing of the card.` The two sides of an open
  offer align to the top, so a caption on one tile never drops the other
  side's label out of line.
- **Remove is per-side.** The other person keeps their copy, so a single row
  needs no confirm; the bulk `Clear history` on `/trades` does confirm.

## Public shared views (/s/:token)

Public shared views live in `components/share/` (the whole `/s/:token` + `/d/:slug` cluster —
distinct from `components/shared/`, which is primitives) and wrap their content in
`components/share/SharedShell.tsx` — **not** the app
`<Header>`/`<Footer>`, which couple to the auth/collection/play stores a logged-out visitor
doesn't have. `SharedShell` is the SINGLE scroll root for any `/s/:token` page: when wrapping
a full-height scroller in new chrome, the wrapper owns the scroll and the inner element's
`height`/`overflow` must be neutralized — never stack two `100dvh` scroll roots.

The conversion CTA on a shared **deck** is "Copy this deck" into the guest local store (works
logged-out; sign-in promotes it). Shared binders/collections get the brand bar and footer CTA
but no deck-copy action. Keep conversion deck-only for now.

Because `/s/:token` is often a non-user's first contact, its **states must be
brand-complete**: loading shows a spinner/skeleton inside `SharedShell` (not bare
text); error and notFound include a "Go to SpellControl" link so no state is a
dead end (the authRequired state's sign-in CTA is the reference). Other rulings:
`SharedShell` brandbar/footer respect safe-area insets and use `--z-*` tokens
(never a raw z-index); any `.shared-list-table` is wrapped in
`.shared-table-scroll` (the shell clips `overflow-x`, so an unwrapped table is
silently cut off at 320px); mana costs render via the `ManaCost` primitive (never
raw `{1}{W}` text); sort headers use the shared `SortDirArrow`.

### Visibility is one choice, not a link to manage (board T136)

Who can see a thing is one control, `components/share/VisibilityChoice.tsx` (a
`ChoiceList` under the hood), applied the moment it's picked: **Public /
Friends / Private**, or **Anyone with the link / Friends / Private** for a
kind with no public page of its own. Every option's hint stays visible, not
just the picked one's, and an option that isn't available right now (Public
while signed out or offline) stays in the group, disabled, with the reason as
its hint — never hidden, never a bare greyed-out label with no explanation.
There is no confirm step, no display-name gate and no list of links to revoke
anywhere in Settings. The control opens on the real current state and never
creates anything just by opening. The link it shows is the thing's own
address, to copy; it is never something the owner manages. New decks start
Public (the create form's first option); "Send to a friend" sits below the
choice because it isn't one. `ShareDialog`, `CollectionVisibilityDialog`,
`DeckGeneratePage` and `ImportDeckDialog`'s creation-time fieldset, the online host
form, and the online lobby's in-game setting all render through it. A public
or friends-only collection lives on the owner's profile
(`/u/:name?tab=collection`), not at a link of its own.

**A deck can be created as Friends, end to end.** Picking Friends mints the
same share `ShareDialog`'s own Friends choice does
(`createShare({kind:'deck', audience:'friends'})`); the deck's first sync
carries `initialVisibility: 'friends'` the same way `'public'`/`'private'`
already did (`publications/sync-hook.ts`), which books it unpublished and
mints the friends share in the same pass, so a repeat sync never re-mints it.

### Feedback view (suggestion-mode deck share)

The feedback view is **card-forward like every other card surface** (grid of
`SharedCardTile` art default, list with E128-sized thumbs as the alternate) —
never a text-only checklist: a reviewer can't judge a cut without reading the
card. Interaction ruling: **tap = read** (opens the `CardPreview` carousel,
same as SharedDeckView) and the destructive-ish intent is an **explicit
scissors toggle** — an overlay button on tiles (bottom-right; qty badge owns
bottom-left, the "Cut" state chip owns top-left) and a trailing 44px button on
list rows, both `aria-pressed`. The carousel offers the same toggle via
`getActions` so judging and marking happen in one place. Commanders render for
context but are not cuttable. Pending work stays visible via the sticky
`.feedback-tally` pill (sticky bottom, `--z-dropdown`, safe-area offset) that
scrolls to the submit form — on a 100-card deck the form is otherwise a full
page-height away. The tally renders **only when suggestions exist** (insight
surfaces never displace content).

## Discover deck tiles (art-banner, tile system v2)

`DiscoverDeckTile` (Discover, SavedDecksPage) and `PublicProfilePage`'s own
`DeckTile` both build on the shared `.decks-index-card` family
(`deck-builder-decks-index.css`), but **grid view** layers an art-banner
treatment on top — pass 2a of the visual-richness program, informed by
Archidekt's home tiles and adapted to this app's identity. **List view is
deliberately untouched**: it stays the original compact thumbnail-row design
(current behavior), because the banner/overlay/hover chrome below assumes a
full-width art band list rows don't have. A future view that wants this
treatment needs its own art-banner width, not just a class toggle.

**Banner**: a wrapper (`.discover-tile-banner` / the per-page equivalent)
reserves `aspect-ratio: 16 / 9` — not a viewport-relative `clamp()` height —
so the box holds its size before the image loads (zero CLS) regardless of
whether the art or the fallback color banner ends up inside it. The art
`<img>` is always `loading="lazy"` with `alt=""` (decorative; the tile's own
aria-label carries the deck's identity). New banner-treatment rules that need
to reliably beat the shared base rule's own specificity use the compound
`.decks-index-card.discover-tile` (or `.public-profile-tile`) prefix — the
same defensive pattern `DiscoverDeckTile.css`'s header comment already
documents for import-order independence.

**On-art overlay stats**: views · copies · recency, bottom-anchored over the
banner, `aria-hidden` (decorative reinforcement — the tile's own aria-label
carries the real numbers). Views/copies are individually thresholded exactly
like `social-proof.ts`'s `formatSocialCount` (hidden below the public-count
floor, never a bare zero); recency has no floor and always renders. Likes are
intentionally absent from this line — `LikeButton` already carries that state
via its own `aria-pressed` heart, so the banner spends its one line on
recency instead. The scrim is `var(--art-scrim)` → transparent (never a
per-theme token): **on-art overlays are always dark, in both themes** — the
same reasoning as the always-dark card-preview panel (`CardDetails.css`) —
because legibility over unpredictable art/fallback-color can't follow the
app's light/dark swap. Pair the text color with `var(--art-scrim-text)`.
`.win-celebration-card` and its `GameRecap` insert are further instances of
this always-dark ruling: a dramatic full-board celebration surface commits to
one dark look in both themes rather than branching on `data-theme`.

**Segmented color-identity bar**: one flat `flex: 1` segment per color in
`colorIdentity`, directly under the banner, `aria-hidden` (the aria-label
already states the colors). Segment colors are the **exact backgrounds
ColorPip/ManaSymbol already paint** for a solid WUBRG pip — mana-font's own
`.ms-cost.ms-<letter>` circle fill (`node_modules/mana-font/css/mana.css`),
not the font's separate `--ms-mana-*` custom properties (those are scoped to
`.ms` elements for the hybrid-symbol gradient halves, not usable from an
unrelated part of the tree, and aren't what a solid pip actually renders
on screen): W `#f0f2c0`, U `#b5cde3`, B `#aca29a`, R `#db8664`, G `#93b483`.
Colorless renders a single neutral segment (mana-font's own `.ms-cost` base
gray, `#beb9b2`) instead of an empty bar — never omit the bar entirely.
It is one primitive, `ColorIdentityBar` (`components/shared/`), and every
deck tile in a grid wears it: the owner's own index, Home's Your decks row,
Discover and a profile or friend's library (2026-09-29, user ruling). It used
to be two copy-pasted families and absent from My Decks, so one deck had a
strip on Discover and none in its owner's list; Home's row, which draws its
own tile, missed it again. List and compact views leave it off. Its colors
come in the order the tile's pips use, from `deckDisplayColors`
(`lib/deck/deck-validation.ts`): most-used first for a deck without a commander,
the commander's identity in WUBRG order otherwise.

**Hover quick-actions** (grid + `@media (hover: hover) and (pointer: fine)`
strictly — never on touch): an "Open" pill plus the relocated Like/Bookmark
buttons fade in on `:hover`/`:focus-within` of the tile. "Open" is a real
`<Link>` (so a mouse click navigates) but `aria-hidden` + `tabIndex={-1}` —
it's a purely decorative, mouse-only reinforcement of the tile's own already
fully-labeled main link immediately before it in the DOM, so a real focus
stop there would just be a redundant announcement for keyboard/AT users with
zero destination difference. On touch, Like/Bookmark stay **exactly as
today**: always visible, never hover-gated (the `hover: hover` media query
itself already excludes touch — no separate override needed).

**Controls on the art sit on the scrim plate at rest** (2026-09-29). Like,
Bookmark and Open each take `--art-scrim` behind `--art-scrim-text`, the same
plate as every badge on art (STYLE_GUIDE § On-art scrims); pressed tints the
filled glyph `--art-scrim-accent`. A bare white glyph with a drop-shadow was
the old treatment, and it vanished wherever the cover is a full card image,
since the corner lands on the pale name bar and the mana cost. On touch the
disc stays 1.9rem and the 44px target comes from an `::after`, as with the
owner's ⋮ button, with the cluster gap widened so neighbouring targets don't
overlap. Guard: `styles/art-controls-plate.test.ts`.

**Footer**: `buildablePercent`, `estimatedValueUsd`, and "no data" are mutually
exclusive, in that priority order — never stack a price line and a buildable
meter, and never render an empty shell when neither applies. This is the
differentiator slot where Archidekt shows tags.

**Owner attribution**: `UserAvatar` (small) + `formatIdentity(...).primary`,
still a genuinely separate sibling `<Link>` — never nested inside the tile's
main link (nesting `<a>` inside `<a>` is invalid HTML and would double-fire
navigation). List view keeps the plain-text "by username" caption.

## Profiles (`/u/:username`, T175)

A profile answers "what does this person brew?" before it lists their decks.
Top to bottom: header (banner, identity, stat line, follow), the Colors and
Game record panels, then the deck library.

- **Banner source order**: the pinned deck's art, else the top commander's
  art, else no banner at all. Never an empty grey box. The box reserves its
  aspect ratio (16 / 5, capped at 14rem; 5 / 2 on a phone) so it holds its
  size before the image loads. The image is decorative (`alt=""`, lazy) under
  an always-dark `--art-scrim` gradient, in both themes. No text sits on it;
  the avatar overlaps its lower edge with a ring in the page background.
  A moderator-hidden profile gets no banner, stats or panels.
- **Stat line**: decks, followers and following are plain counts (a new
  brewer reads "0 followers", which is true). Likes and copies received are
  people counts, not clicks, and pass through `formatSocialCount`, so they
  disappear below the floor instead of reading "0 likes". Plain text, not links.
- **Follow vs Friends**: Follow is a one-way toggle (`FollowButton`, shared
  with other surfaces); "Friends" is a separate, quiet label chip beside it,
  because friendship is mutual and its own relationship. Follow is hidden on
  your own profile and on a hidden one; the official account can be followed.
  A guest tap opens the same sign-in popover as Like and Bookmark.
- **Pinned deck**: the same deck tile, larger and with a "Pinned" badge, above
  the grid while nothing is searched or filtered; once the viewer narrows the
  list it is an ordinary tile so a search still finds it. It never shows twice.
- **Colors** (was "Brews most", renamed 2026-09-29 after the user asked what
  it meant): a stacked colour bar with `ColorPip` counts under a plain
  "Colors" heading and a caption saying what the numbers count ("Decks per
  color, across 17 decks"). A panel heading names what it shows; never a
  clever label that needs decoding. Below it, **Most-built commanders** lists
  only commanders in two or more of their decks, each opening Discover
  filtered to it. A commander built once says nothing about the brewer (17
  one-off decks made "top 3" an arbitrary three), so with no repeats the row
  is absent. Renders nothing for a brewer with no live decks.
- **Game record** is opt-in (off by default, You > Profile > On your profile):
  games, wins, win rate and the most-played deck. Nothing renders when off.
- Panels sit side by side from about 45rem, one column on a phone. Controls
  keep the 44px coarse-pointer floor.

## Brewer cards and the Brewers tab (T175)

**Brewers is a view of Discover, not a hub tab.** `/decks/discover/brewers` sits
under the same hub strip as Discover, and `DiscoverSwitch` (`Decks | Brewers`,
the `underline` variant of `Tabs`, per § Tabs / view switchers) sits under it on
both pages so it never moves. Both pages hang their content in `DiscoverPanel`,
the tabpanel the switch controls. Precons stay under Decks (`?source=precons`).

**`BrewerCard`** (`components/social/`) is the one brewer tile. Three variants:
`card` (16:9 art banner, avatar straddling its lower edge, name, `@handle`,
"N decks · N followers", "Brews <commander>", `ColorIdentityBar`), `row`
(no banner, for search results and lists) and `featured` (the spotlight: stacked
on a phone, banner beside body from 600px). The whole card is one link to
`/u/:username`, named by identity, stats and commander; there is no Follow
button on it (Follow lives on the profile). The banner is the art crop the
server picked; without one it takes the same flat accent field as a deck tile.
The scrim under the avatar is `--art-scrim`, always dark in both themes.
Followers pass the `social-proof` floor (`formatSocialCount`), so a brewer with
four followers reads "3 decks", never "4 followers". `BrewerCardSkeleton` has
the same boxes.

**A rail under its people floor renders nothing.** The server sends `[]`; the
page draws no heading and no empty card. If every rail and the spotlight are
empty, one empty state invites the viewer to publish a deck. Rail order:
"Brewing your commanders" (signed in), "Newest brewers", "Most liked brewers",
"Most followed brewers"; the spotlight leads them all.

**Rails scroll on a phone and grid when wide.** Below 1024px a rail is a snapping
sideways scroller that fades its overflowing edge (`useOverflowEdges`); from
1024px the same cards lay out as a grid, so a mouse never needs a horizontal
wheel. (`SnapCarousel` is the centred card-preview carousel and is not a rail.)

**Search replaces the rails.** Two characters minimum, debounced 300ms; under two
the rails stay. Results are `row` cards; states are skeleton rows, "No brewers
match “…”", and the shared `.discover-decks-error` strip with Retry.

## Friends page (`/friends`, T175)

The page shows people, not usernames. Top to bottom: the find-people box, the
tab strip (`Friends | Following | Requests | Inbox | Activity`), the active
panel, then, only when there are fewer than three friends and follows combined,
a strip of brewers to meet.

- **A friend row is a person** (`components/friends/FriendRow`): avatar, name,
  `@handle`, a peek at what they brew ("3 decks · Brews Atraxa", or the honest
  "No public decks yet"), "Friends since …", and from 600px the art of one of
  their decks with its colour bar. The whole identity is one link to
  `/u/:username`; everything else lives in a `⋮` beside it, outside the link.
  Friends are accepted mutuals, so the avatar and public deck count are fine to
  show. The peek comes from `GET /api/friends` (backend `friends/peek.ts`,
  the same projection as `BrewerCard`).
- **No "View shared" button.** The friend hub (`/friends/:id`: head-to-head,
  trades, what they shared with you) is in the row's menu as "Trades, games and
  shared"; the profile is the row itself and "View profile". The hub earns its
  place only for what the profile lacks, so it is a menu item, not a headline.
- **Remove is a menu item, danger-toned, and asks first.** A friendship can't be
  undone from the UI (both sides lose friends-only shares), so the confirm
  dialog stays; there is no undo toast because there is nothing to restore.
- **Following is a tab**, `BrewerCard` `row` cards, each with the `FollowButton`
  beside it (a sibling, never inside the card's link). Unfollowing leaves the row
  as "Follow" until the list next loads, so a mis-tap is one tap to undo. Empty:
  "You aren't following anyone yet." with a Find brewers action.
- **Find people is one box.** As you type (300ms, two characters; Enter searches
  at once, even one character) it asks the handle search (any account, deck or
  not) and the brewer directory (name or handle; accounts with a live deck) and
  merges them by handle. Rows link to the profile, with Add friend for anyone
  and Follow for brewers only (Follow is the row's filled button when both show;
  Add friend goes secondary). Friendship state is derived from the lists the page
  already holds ("Friends", "Request sent"). A name with a space skips the handle
  search, which would 400. One directory failing never blocks the other.
  "Find brewers to follow" sits under the box.
- **Suggested brewers are an insight surface**: shared-commander brewers first,
  else the newest, six cards in the rail scroller. They render nothing when
  empty or failed (no skeleton, no error), only after friends and follows have
  both answered, and never while the load error shows.
- **Home gets "New from brewers you follow"**: deck (to `/d/:slug`), "by brewer"
  (to the profile) and relative time, at most four rows, last seven days. It rides
  the activity fetch, is deliberately not in the nav badge count, and renders
  nothing when empty.
- **Profile rulings that landed with it.** The pinned deck spans the grid row from
  1024px as a wide feature (art left, details right); below that it stays the
  stacked tile. "Friends" beside Follow is a flat status label (tinted, no border,
  no pill, no pointer), so it cannot be mistaken for a button. On a phone the
  stat line is one row of equal columns, value over label, never wrapped
  sentences that orphan the last stat. The Brewers tab's header reads
  "Find brewers to follow and see what they build."
