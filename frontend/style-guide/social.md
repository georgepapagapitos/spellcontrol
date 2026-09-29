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

Who can see a thing is one control, `components/VisibilityChoice.tsx` (a
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
