# Style guide: App shell & first run

The chrome around every page, the landing and welcome screens, Home, You, guest gates and app-wide moments. An appendix to the frontend style guide: the principles,
tokens, verbs, voice, accessibility, responsive, motion, colour and
spacing rules every screen follows are in the core,
[`STYLE_GUIDE.md`](../STYLE_GUIDE.md). Its Appendices section lists
where every section lives.

---

## App chrome — leather & divider tabs (T53)

- **Sticky chrome clears the display cutout on both sides.** `.site-header`
  pads with `max(var(--space-4), var(--safe-right))` /
  `max(var(--space-4), var(--safe-left))`, the same floor the mobile tab bar
  and the phone modal backdrop use, so a landscape phone with a notch never
  puts the brand or nav under the cutout. Any new fixed/sticky bar takes the
  same two insets, not just `--safe-top`/`--safe-bottom`.

The header and mobile tab bar are the **binder's cover**, not page surfaces —
they wear the `--chrome-*` tokens (`-bg`, `-surface`, `-text`, `-text-muted`,
`-border`), never `--surface`/`--bg`. Light schemes pin a theme-invariant warm
leather (the dark-cover-on-bright-pages signature); dark schemes re-derive the
chrome tonally from the guild's own ground in `themes.css` (Dimir stays navy,
Rakdos stays blood-black). Rulings:

- **Divider-tab anatomy.** Primary navigation is a physical divider tab: the
  current destination wears an `--accent` fill ("the guild's cover dye") with
  `--on-accent` text, corners rounded **toward the page it attaches to** (top
  corners in the header and hub strips; bottom corners in the mobile tab bar,
  which hangs under the page), a 1px inset top-face highlight
  (`rgb(255 255 255 / 14%)`) to lift the silhouette off dark grounds, and a
  `-1px` margin over its strip's hairline so the fill merges into the page.
  **In the mobile tab bar the fill is an inset `::before`** (E159:
  `inset: 0 3px 6px` — flush to the page edge above, a floor-and-sides gap
  below) so it reads as a tab hanging into the bar, never a full-height slab
  touching its neighbors; the link itself stays the full cell, keeping the
  44px+ touch target. Cells are `overflow: hidden` — a tab label may never
  paint outside its own cell (the pre-E159 "Collection" label overflowed a
  61px cell at 360px and collided with an active neighbor's fill; it now
  swaps to its short form "Cards" below 420px via the long/short span pair).
  Resting tabs are quiet text (on leather, one notch above muted:
  `color-mix(in srgb, var(--chrome-text) 45%, var(--chrome-text-muted))` —
  pure `--chrome-text-muted` read as dim floating glyphs in device review;
  `--text-secondary` on the paper hub strips); hover raises
  (`--chrome-surface` / `--surface-raised`). State is never color-only: the
  fill pairs with `aria-current`/`.active` and ≥4.5:1 on-accent text.
- **The mobile tab bar is FULL at 5 destinations + the Search utility — a new
  top-level surface gets its phone door on Home, not a 6th cell.** The bar is
  five `flex: 1` cells plus a fixed 44px Search. Six cells would need
  `6×44 + 44 + 12.8` px of padding = **320.8px**, wider than the 320px floor,
  _before_ a single label — and labels already needed a short-form swap
  ("Collection" → "Cards") plus a tracking trim to fit five. The phone's
  primary nav is closed. A cluster needing top-level reach takes the
  form-factor pair the app already uses elsewhere (desktop has no "You" link;
  the phone has no avatar menu): **a `.site-nav-link` in the header, where
  ≥1024px has the room, plus a door on Home** — Home being where the tab
  bar's activity badge already lands, so the rule stays inferrable. This is
  how the social cluster (`/friends`, `/trades`, `/pods`, `/friends/:id`) got
  its front door; before that it was the app's only page cluster reachable
  solely through a button buried inside another page. **Any badge on such a
  door reads off the shared `useActivity()` bucket** — the whole `count` on
  Home, the `actionRequired` subset on a social door — so two doors can never
  claim different numbers.
- **`--font-label` scope.** The condensed label face is for chrome, tab, and
  tape labels ONLY — always uppercase with letter-spacing (0.05–0.12em).
  Body/content text stays `--font-serif`; data stays `--font-mono`. Never set
  `--font-label` on prose, headings, or form controls.
- **…plus bare numerals in a badge or count pill**, which is the one non-label
  exception. `--font-sans` resolves to **Vollkorn** under the default grimoire
  type set, whose old-style "1" is a slab-serif figure that reads as a Roman
  **"I"** when it sits alone beside uppercase text — `/trades`' section counts
  shipped that way before being caught on a screenshot (#1532). Every existing
  numeric badge (`.friends-nav-link-badge`, the nav counts) is already on
  `--font-label` via its chrome parent; match it, and set it **explicitly** if
  the parent is a serif heading rather than chrome.
- **Badges invert on accent fills.** An `--accent`-background badge sitting
  inside the active tab's accent fill swaps to `--on-accent` bg + `--accent`
  text (`.site-nav-link.active .friends-nav-link-badge`, mobile equivalent) —
  never leave an accent-on-accent badge.
- **Focus rings on chrome are white** (`rgb(255 255 255 / 70%)`), not
  `--accent`: the leather is an always-dark surface, same ruling as the game
  board's white rings. Everything else keeps the standard accent ring.
- **Chrome-resident indicators can't trust scheme-flipped tokens.** The
  light schemes' `--warn-text` override is a dark brown tuned for paper — on
  leather it vanishes. A dot/glyph living permanently on chrome uses a
  theme-invariant color (the game dot uses `--brand-seal-gold`); a
  self-backgrounded pill (the sync indicator) is fine as-is because it paints
  its own surface.
- **Brand hover is brass** (`--brand-seal-gold`) on the leather — the app's
  one metallic; don't introduce a second.
- **Any `position: fixed`, viewport-anchored bottom overlay must clear the
  mobile tab bar, not just the safe-area inset.** The tab bar
  (`.mobile-tab-bar`) is a normal-flow flex child, not an overlay, so page
  _content_ already accounts for its height — but a `fixed` element (the
  toast viewport) is positioned against the raw viewport edge and paints
  UNDER the bar's occupied strip regardless of `--z-tooltip` winning the
  stacking order (z-index decides paint order, not layout offset). Add
  `var(--mobile-tabbar-h)` (tokens.css — 0 above 1024px, where the bar
  doesn't render; mirrors `.mobile-tab-bar`'s own height exactly) on top of
  `max(--safe-bottom, --keyboard-inset)` in the offset math. This shipped
  wrong on the toast stack: the bottom-most toast's opaque background
  covered the tab bar's leftmost tab whenever a toast fired on a phone-width
  authed page.

## Page hero art — phones get the art, not a downgrade

A hero that has real art available (`art_crop` for a commander, a binder's
cover card) **renders it at every breakpoint.** The phone treatment is
different from desktop; it is not _absent_.

- **≥600px** — art as a right-anchored backdrop panel behind the title, with a
  horizontal fade to `var(--bg)` so the text column keeps its contrast.
- **≤599px** — art goes **full-bleed across the hero**, the hero takes a real
  `min-height`, and the title/meta/status chips bottom-anchor into a vertical
  scrim (`justify-content: flex-end`). The scrim, not the absence of art, is
  what buys legibility. **The phone scrim is dark in every theme** (black
  under the text, a lighter band at the top for the back link, white text):
  a scrim that faded to a light theme's `var(--bg)` was a pale wash the art
  showed straight through, which is what made the old deck header hard to
  read (2026-09-24 mockup, shipped 2026-09-25). The back link rides the art's
  top edge rather than costing a row above it.
- **≥600px, deck header** — the art is a bounded panel on the right
  (`min(58%, 440px)`, the header's full height, ~2:1) that fades in from its
  left edge with a `mask-image`, and the text column sits on the page in the
  theme's colours. The header is 188px tall on a tablet and 216px on a
  desktop, so the panel keeps the commander's face in frame.

The rule exists because the deck hero originally did the opposite — it hid the
commander art below 600px on the reasoning that "art behind full-width text
costs legibility." The result was that the app's most-visited page opened, on
the device most people use, as a lowercase word on a flat charcoal slab with no
identity at all, while every competitor led with the art. **Legibility is a
scrim problem, not a reason to drop the art.** If a crop is too bright, deepen
the gradient; don't `display: none` the image.

Gate the phone treatment on art actually being present (`.deck-editor-hero--art`
is the reference modifier). A hero with no art must not inherit the
`min-height` — an empty tall slab is worse than the plain hero.

**The same two treatments apply to every commander-art header, not only page
heroes.** The post-build report sheet (`BuildReportSheet.css`) shipped the naive
version first — a ~4:3 `art_crop` stretched edge-to-edge with `object-fit:
cover` across a wide, short box, which on any desktop width shows a random
horizontal slice with the title over the busiest art. Two details that differ
from the page hero:

- **Fade to the surface the panel sits on**, not to `var(--bg)`. A takeover or
  sheet is painted on `var(--surface-raised)`, so its horizontal fade and its
  bottom scrim end in that token; fading to `--bg` leaves a visible seam.
- **Take the bottom scrim to fully opaque at the edge** so the art dissolves
  into whatever follows (the phase checklist, the report body) rather than
  ending on a hard horizontal line.
- `object-position: center 25%` and `useCardThumb(name, 'art_crop')` for the
  name-resolved fallback — the `'normal'` full-card image is never a header.

`responsive-primitives.test.ts` pins the `≥600px` right-anchored, width-bounded
panel for each adopter; add a new header there when you build one.

**A waiting surface shows the card, not a crop.** The generation takeover
(`GenerationTakeover.css`) was an art-crop header and is no longer one: while a
deck builds, the commander — and its partner, when there is one — renders as the
real card (`useCardThumb(name, 'normal')` through `CardThumb`, 5:7 at
`var(--radius)`), sat beside the progress column. The distinction is what the
surface is for: a _header_ labels a page you are about to read, so a crop under
a scrim is right; a _wait_ has nothing else to look at, so give the full card,
which is the thing the deck is being built around. Cards stack above the text on
phones and sit to the left of it at ≥600px. The whole composition lives in one
centred stage capped at 54rem (the bar and phase list never stretch across a
wide desktop), the card is lit by a blurred copy of its own image, and a partner
pair fans (two overlapping cards leaning apart) instead of widening the row.

## Home — the page reads as questions, not a board (2026-09-24, T138)

`/home` was a bento of nine equal cards. It answered no one question: the
collection value appeared twice word for word (hero and Value movers),
Discover listed the viewer's own decks beside Recent decks, "326 new" summed
per-deck counts so one card counted once per deck it fit, and four empty
cards collapsed to 44px rows that still took whole grid cells and left holes
beside their tall neighbours. The rebuild (mockups: Direction A, "the desk")
is a column of sections in a fixed order, each answering one question:

1. **The hero** — the collection itself (value + its sparkline, the scale
   line, the day's card, the actions). An empty collection's hero is the
   setup checklist instead.
2. **Waiting on you** — what needs an answer.
3. **Your decks** — what you were working on.
4. **Price movers · Recently added or Your cards** — what changed, and what
   to do about it (one band, never more than two cards).
5. **Around the table** — game nights, activity, friends' new decks.
6. **Discover** — what other players are building.

Rulings:

- **One fact, one place.** The collection value and its sparkline live in the
  hero only; Price movers is the cards that moved, never the total again. A
  deck's new-card count sits on that deck's tile ("+42 new cards", an on-art
  scrim plate at the tile's top-left: state on the left, [§ Card corner](play-table.md#card-corner-ribbons--state-on-the-left-identity-on-the-right-2026-09-20-ruling)
  ribbons). Recently added headlines the latest import's own `count`, never a
  sum across decks. A deck appears in one list: Discover asks the server for
  `exclude: 'mine'`.
- **The band's second card depends on what you have (T164).** Recently added
  holds it only for an import from the last 30 days that ADDED to the
  collection (`isRecentPartialImport`: under 90% of the cards). A first import
  or a replace-everything re-import is the collection itself and would restate
  the hero's card count, so the slot goes to **Your cards**: at most three
  rows from `lib/collection-insights.ts` (decks a few cards from done, spare
  copies, a card more decks want than you own), each a door to where it is
  acted on (`/decks/:id`, `/collection?spares`, `/collection?stats`), with the
  full list behind its Breakdown door. The rows reuse Recently added's deck
  list shape so either card reads as the same family. No insight: nothing.
- **Nothing to show renders nothing** (the general rule: [§ Empty states](components.md#empty-states-e182),
  secondary sections). A `HomeCard` with `empty` renders
  `null` (the collapsed invitation row is retired, along with
  `.home-card--empty`). Every door those rows carried moved somewhere with
  content: Plan a game night and Friends into the hero's ⋮, Find friends into
  Around the table, the setup steps into the hero checklist and Waiting on
  you. Two sections keep **one quiet line** instead of vanishing, because
  they are ways out rather than insights: Around the table (with its two
  doors) and Discover ("No public decks from other players yet." + Browse).
  The quiet line is dashed like an empty sleeve and is not a card.
- **Waiting on you is one line, never a stack.** Trade offers, friend
  requests, unreplied game nights, cards to file in binders, want-list cards
  under their target price, and setup steps left once the collection has
  cards. A four-up row on desktop, a swipe row with an edge fade below it
  ([§ Layout system](../STYLE_GUIDE.md#layout-system-t135--one-build-of-each-pattern-every-screen): chip rows are one line). It appears only once every
  source has settled and holds its line while loading if the last visit had
  one (`home-shape` slot `waiting`), so it never pushes the decks down after
  first paint.
- **Tiles are the index's tiles** (the row itself: [§ Layout system](../STYLE_GUIDE.md#layout-system-t135--one-build-of-each-pattern-every-screen), a row of
  tiles). Your decks renders the decks index's own
  `.decks-index-card` markup and Discover renders `DiscoverDeckTile` — one
  tile for a deck everywhere it appears. Both sit in `.home-rail`: five
  across on desktop, a swipe row below it with the next tile peeking (72% of
  a phone, 30% of a tablet) so the row reads as scrollable. The rail runs
  out to the screen edge past `--page-gutter` and sets `overflow-y: hidden`
  (one-axis strip guard).
- **Each list carries its own search** ([§ Toolbars](components.md#toolbars--action-rows-responsive)). The hero's one search box with a My
  decks / Discover scope toggle is retired: "Search your decks" sits in the
  Your decks head, "Search commanders" in the Discover head
  (`HomeSectionSearch`). From 600px it is a SearchPill; on a phone it is a
  44px search button that opens the list's page, because a second full-width
  pill in every section head costs more than it earns.
- **The hero's actions follow the action rule.** Add cards (filled, opens
  `AddCardsSheet`), New deck (outline), and a ⋮ (`OverflowMenu`) for Plan a
  game night and Friends. 44 / 40 / 36px by tier, 44 on any coarse pointer.
- **Rows vs tiles by the card's width, not the viewport.** Price movers
  switches from rows to card tiles at a 32rem container; Around the table's
  columns sit side by side from a 48rem container and stack with a hairline
  below it. The band is 3fr / 2fr from 600px, and a lone card spans it.
- **Inline RSVP is the same write as the Play page's.** Around the table's
  next night takes Going / Maybe / Can't through `rsvpGameNight` with
  `STATUS_LABELS` from `GameNights`, `aria-pressed` on the chosen answer, a
  44px floor on touch (mutating actions take the floor), and an error toast
  that leaves the buttons usable. A host sees "You're hosting."; a night
  still voting on its date links to vote.
- **Loading takes last visit's footprint (E277), unchanged in spirit.**
  `lib/home-shape.ts` (`sc-home-shape`) remembers, per `HomeCard` title, the
  rendered height or 0 for absent — a remembered-absent card stays absent
  while loading, never a phantom skeleton — plus the hero's value, scale and
  caption lines, the `your-decks` tile count and the `waiting` line. A first
  visit still reflows once. A card must report `loading` while its store is
  hydrating: "nothing here" over an un-hydrated collection is a false empty.
- **Cards in a row share one height; the body absorbs the slack.** The band
  keeps grid row-stretch and `.home-card-body { flex: 1 1 auto }`, so the
  shorter card's slack is inside its own frame, never a floating gap beside
  it (the #1680 reversal of `align-items: start` still stands).
- **The entrance cascade is CSS-only** — `.home-page > *` with `:nth-child`
  delays on the shared `panel-cascade-in` keyframe, capped at 6 slots, inside
  `prefers-reduced-motion: no-preference`.
- **Trade-target prices render in the author's stamped currency**, never the
  viewer's display-currency setting — the "as-entered, never converted"
  contract of `ListEntry.currency`. (The full want-list shortfall now lives on
  /collection/lists; Home surfaces only the under-target hits.)

## Brand mark motion

The rule: **orbit once at boot, pulse when busy, breathe when idle.** Three
loops, one component (`components/shared/BrandMark.tsx`), one stylesheet
(`components/shared/BrandMark.css`). Leaving the `motion` prop unset renders
the plain static mark — unchanged, no animation cost — so every existing call
site that doesn't opt in is unaffected.

- **`motion="boot"`** — the clasp gem detaches and sweeps one orbit around the
  book (with two fading ghost trails) before clicking back into its socket
  with a small ring pulse. Reserved for the app's cold-boot placeholder
  (`App.tsx`, the route shown while auth status is still unknown) — the one
  moment there's genuinely nothing else on screen yet.
- **`motion="busy"`** — the book stays still; the clasp glows, pulses three
  times, then flares with an expanding ring, and loops. This is the loading
  tell for a surface that's waiting on data with no other designed loading
  state: `SharedView`'s share-link loading branch and `CollectionPage`'s
  fresh-device "pulling your collection from the server" branch. Don't add it
  to a surface that already has its own designed loading experience (e.g.
  `BinderPage`, the deck-generation takeover) — those stay as they are.
- **`motion="idle"`** — two soft glow circles breathe behind the book, plus a
  faint sympathetic glow on the clasp. This is the hero treatment for
  first-impression / auth moments: `WelcomePage`, `AuthPage`,
  `ChooseUsernamePage`. It reads as "alive, waiting for you" rather than
  "loading."
- **Chrome stays static.** The header wordmark and the shared-view top bar
  never animate — motion is reserved for the three moments above, not
  decoration on every mark in the app.
- **Reduced motion:** every loop has an explicit
  `@media (prefers-reduced-motion: reduce)` block that turns the extra
  glow/ring/trail/gem elements off, so the mark falls back to reading as the
  plain static grimoire (see STYLE_GUIDE.md "Reduced motion" for why the
  global backstop alone isn't enough for an `infinite` animation).
- **Keyframes** live only in `BrandMark.css`, prefixed `brand-mark-*`
  (`brand-mark-aura`, `brand-mark-seal-glow`, `brand-mark-orbit-ring`, …) —
  never named `*-shimmer` (that family is reserved for `skeleton-shimmer`).
  One deliberate exception: the boot gem's orbital travel is SMIL
  (`<animateMotion>` in `BrandMark.tsx`), because CSS `offset-path`
  mis-anchors its coordinate space on SVG children in Chrome; don't "clean it
  up" back into a CSS keyframe without re-verifying the gem rests on the
  clasp.
- **Anti-pattern:** don't hand-roll a new brand-adjacent loading loop
  elsewhere in the app, and don't add `motion` to a surface that already has
  its own designed loading experience — three loops covering four call sites
  is the whole system; a fifth bespoke one is drift, not a feature.

## Completion moments (the seal)

The seal is the app's one celebration language: `SealBurst`
(`components/shared/SealBurst.tsx`) — the grimoire blooms in a brass flare and
sheds mana motes in the subject's colour identity. **Never confetti, never a
bespoke celebration** (the game board's `WinCelebration` predates this ruling
and is grandfathered; don't copy it).

- **Full scale belongs to the generation takeover only.** Everywhere else uses
  the viewport-centered compact moment via **`useSealMoment()`**
  (`components/shared/SealMoment.tsx`): render `{moment}`, call
  `fire(colorIdentity)` on the completion event. It portals to `<body>`
  (`--z-overlay`), is `aria-hidden` and pointer-transparent, and unmounts
  itself after one play.
- **A moment fires only on a completed-effort _transition_ observed while
  mounted** — an import lands, the binder review queue empties, a deck crosses
  from incomplete to full-size-and-legal. Never on mount of an
  already-complete state, and **once per subject per app-open** (a
  module-level consumed set, mirroring `consumedRevealKeys`). Re-crossing the
  boundary in the same session doesn't replay. **The canonical pattern is a
  module-level `Set` keyed by the subject's id, checked-and-added around the
  `fire()` call** — see `celebratedDeckComplete` in
  `components/deck/DeckDisplay.tsx` and `celebratedBinderCleared` in
  `components/BinderDriftBanner.tsx`. Prose alone let a second call site
  (the binder-cleared moment) ship without the guard, gated only by a
  component-local ref that replays on every clear within a session — a new
  call site should copy one of these two, not reinvent the guard.
- **The seal is decorative and silent; the surface carries the words.** Every
  moment pairs with a real announcement element — the import success banner,
  the deck-complete toast, the binder "All caught up" status row — so
  reduced-motion users (for whom `fire` is a no-op) lose nothing but sparkle.
- **Colours are honest:** pass the real colour identity when the completed
  thing has one (a deck); pass nothing for identity-less completions (a
  collection import) and the motes fall back to seal gold.
- **Anti-pattern — celebration inflation.** Low-stakes actions (copy link,
  add one card, cut a card) get a toast at most. If everything celebrates,
  nothing does; the seal marks _completed effort_, not activity.
- **Timing precedent.** `SealBurst`'s bloom (mark/flare/ring) plays over
  **~1000ms** with `--ease-out-soft`; `useSealMoment()` holds the compact
  portal mounted for a **1250ms** total lifetime (the extra ~250ms lets the
  bloom settle before unmount). The next celebration-adjacent surface — a new
  completion moment, a variant bloom — should snap to these two numbers
  rather than inventing its own; see `SealBurst.css` and the `MOMENT_MS`
  constant in `components/shared/SealMoment.tsx`.
- **Brass gold has exactly two definition points.** The seal's brass lives in
  `--brand-seal-gold` (`styles/tokens.css`, theme-invariant — CSS consumers
  like `SealBurst.css` use the var) and the mirrored `SEAL_GOLD` const in
  `components/shared/BrandMark.tsx` (SVG presentation attributes can't take
  `var()`). Change the hue by editing both; never reintroduce a raw `#f0c368`
  literal anywhere else.

## Full-viewport centered pages (scroll, don't clip)

**Load-bearing rule — any full-viewport centered card page (auth, the `/`
landing, future splash/onboarding surfaces) MUST be a self-scrolling viewport,
never `min-height: 100vh` + flex centering.** The app shell sets
`body { overflow: hidden }` and `#root` has no height cap, so a `min-height`
page that grows past the viewport spills into the clipped region with **no way
to scroll** — the bottom is silently cut off on short screens, on phones (under
the notch / home indicator), and in any browser whose chrome eats height.
`align-items`/`justify-content: center` can't scroll into overflow; they strand it.

**`#root` is the viewport** (2026-09-23, E379): a `100dvh` flex column whose
first children are the account banners (`.recovery-banner`,
`.auto-link-banner`, `flex: none`) and whose last is the page root. A page
root fills the rest (`.app-shell` is `flex: 1 1 auto; min-height: 0`); the
self-scrolling pages above keep `height: 100dvh` and shrink to fit as flex
items, which works because they are scroll containers. Never give a page root
its own full viewport height _beside_ the banners without that shrink, and
never make a banner `position: sticky`: the page overflowed `#root` by the
banner's height, so the phone tab bar sat below the screen, and every
`scrollIntoView` scrolled that overflow and slid the banner over its target.

The canonical pattern (`.auth-page`, `.welcome-page`):

```css
.page {
  height: 100vh;
  height: 100dvh; /* fixed viewport height, NOT min-height */
  display: flex;
  overflow-y: auto; /* the page itself scrolls */
  padding: calc(var(--space-5) + var(--safe-top)) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-5) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}
.page-card {
  margin: auto; /* centers when it fits, yields to overflow when it doesn't */
}
```

- **`margin: auto`, not `align/justify center`.** Auto margins center the card
  when there's room and collapse to let the container scroll when the content is
  taller — they never strand the overflow.
- **Safe-area inset padding is mandatory**, not optional — these pages render
  outside the app's `Layout` chrome, so nothing else accounts for the notch /
  home indicator on a phone. Add `--keyboard-inset` to the bottom padding only if
  the page has focusable text inputs (auth does; the landing doesn't).
- This is a real bug that has shipped twice (auth register mode; the `/` landing
  footer). Treat it as a hard constraint.

## First-run welcome / landing screen (UX-331, pass 2c "welcome storefront")

The first-run gate routes a fresh visitor (and crawlers) to `/` — the public
marketing landing, which doubles as the first-run onboarding surface. It must
follow the full-viewport scroll pattern above. Design rulings settled here:

- **Art-led storefront, not a centered card.** `WelcomePage` is a wide
  (`--page-max`) shell: a full-bleed art hero (`WelcomeHero`, Moxfield-hero-
  informed — same hero-scrim treatment as `HomeHero`, next ruling), then two
  live public-deck rails, then the original onboarding/feature/legal content
  in tightened form. The pre-2c design (a single `max-width: 560px` centered
  card) is retired — a guest now sees the same kind of art-led landing a
  returning/authed user gets on `/home`, not a plainer marketing stand-in.
- **Hero art must actually be visible: `art_crop` + directional scrim.**
  Applies to any full-bleed art _backdrop_ hero (`WelcomeHero`, and any
  future band tall enough to justify one — a compact dashboard band is NOT;
  see the `/home` featured-card ruling below). Two hard rules, learned by
  shipping the opposite: (1) the backdrop is the **`art_crop`** image
  version, never `'normal'`/`'large'` — a full card scan cover-cropped into
  a wide band renders a random strip of black frame and text box, not the
  illustration. (2) The scrim is **directional, never a flat `--art-scrim`
  fill**: stacked `--art-scrim → transparent` gradients (the DiscoverDeckTile
  idiom) anchored to where the on-art text actually sits, leaving the art's
  focal area nearly clear. Controls with their own backgrounds (search
  pills, CTA/action chips) don't need scrim under them. On-scrim type over
  the thinned zones carries `text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5)` as
  a second legibility floor. Flat `--art-scrim` coverage remains correct for
  small tiles/badges where content genuinely spans the whole art.
- **A hero band's slack goes to the chart, not to a gap.** `HomeHero` is a
  two-column grid whose right column (the featured sleeve, 15rem on a
  tablet, 21rem on desktop) is the taller of the two, so any difference
  used to render as one dead band in the left column — the "boring and
  bland, a lot of empty space" report (#1679 answered it with a fourth
  row; T138 removed the search row). The rule now: the left column is
  head (greeting + value) → sparkline → foot (scale line + actions), and
  the sparkline's grid row is `minmax(0, 1fr)`, so the chart grows into
  whatever height the card leaves over (`ValueSparkline` measures both
  axes). On a phone the card sits beside the head and the chart is 48px.
  The scale line is three link plates (`Cards` / `Decks` / `Binders`,
  `--font-label` caption over a `--font-serif` tabular numeral on a
  `--surface` plate), each a door to its surface. Two hard rules: it is
  **suppressed wholesale when every count is zero** (a row of zeroes reads
  worse than no row) and for guests (the hero shows a guest nothing
  personal — same rule as the art pick); and labels **singularize at 1**
  ("1 Binder"), because a figure that small makes "1 Binders" read as a
  bug. Restating the header's own nav chips is deliberate — those are
  abbreviated glyphs (`12K`), these are the real figures.

- **`/home` hero = featured-card sleeve, not a backdrop (geometry rule).**
  A dashboard hero band is ~8:1 while card art crops are ~4:3, so a `cover`
  backdrop discards ~85% of the illustration — no scrim tuning fixes that.
  `HomeHero` therefore shows the day's card as an **object**: the panel
  itself is sleeve matte (`--surface-raised` + `--shadow-card`, no outline,
  normal theme-token type — no scrim, no on-art text), and the card sits in
  a right-hand sleeve frame (`aspect-ratio: 4/3`, `--border-strong` +
  `--shadow-card`) at its full aspect, captioned by a **tape label** (T53
  tape tier — fixed Dymo colors, `--font-label` uppercase) with a muted
  provenance line under it that **states the pick's reason** ("One of your
  most valuable cards" / "One of your newest arrivals" / "Your latest
  commander" — `PICK_REASON_LABEL`; the sub-line hides ≤600px). An unlabeled
  pick reads as random even when it isn't — the picker always knows which
  tier won, so the caption says so. Don't reintroduce an art backdrop here; if
  a future surface wants one, it takes the backdrop ruling above and a real
  (Moxfield-scale) height.
- **Collection-drawn hero art shows the OWNED printing.** When the pick comes
  from the user's own rows, derive art from the row's stored `imageNormal`
  via `scryfallArtCrop` (the binder-cover idiom, #843) — never name-resolve
  through `useCardThumb`, which returns Scryfall's _default_ printing and
  reads as "that's not my card". Name resolution is only the fallback for
  rows with no stored image (and for `WelcomeHero`'s hardcoded guest pool,
  where no copy is owned).
- **The brand fallback never floats behind content, and never flashes.**
  `HomeHero`'s empty state is an **empty sleeve** — the same 4:3 frame with
  a dashed `--border-strong` outline and the brand mark centered, no tape —
  never a mark floating behind interactive content. And it renders only for
  a **settled** empty collection: while the IDB hydrate or a first-device
  sync pull is in flight (`hydrating` / `getSyncState() === 'syncing'` with
  no pick), the frame shows the loading shimmer — an indeterminate
  collection must not flash brand chrome that art is about to replace.
- **Guests have no collection, so the hero art rotates a hardcoded pool.**
  Unlike `HomeHero`'s collection-derived pick, `WelcomeHero`'s backdrop
  rotates a small const list of iconic, evergreen Commander staples
  (`lib/welcome-hero.ts`'s `EVERGREEN_COMMANDERS`) by the same day-key
  rotation idiom as `home-hero.ts` (`pickWelcomeHeroCard` reuses its exported
  `epochDay`). Never wire personal/collection data into this hero — it must
  render identically for every guest.
- **Hero CTAs: Import (primary) + Browse public decks (secondary).** The
  hero's own two calls to action are `<Link>`s (not `onClick`+`navigate`
  buttons) so cmd/ctrl/middle-click still work — "Import your collection"
  (`/collection?add=list`, calls `markEverVisited()` on click) and "Browse
  public decks" (`/decks/discover`, no side effect). The hero also carries a
  single Discover-scoped search (submits to `/decks/discover?commander=…`) —
  the one search a guest can use meaningfully, no "my decks" scope toggle
  (there's nothing to search yet).
- **Live rails are ghost-town-proofed — absence over an empty shell.** "Fresh
  public decks" (`FreshDecksRail`, `listDiscoverDecks({sort:'newest'})`
  rendered with the exact same `DiscoverDeckTile` grid `/decks/discover`
  uses) renders **nothing** below 3 returned decks — never a near-empty grid
  on the page a cold platform and search crawlers land on. "Trending
  commanders" reuses `TrendingRail` as-is (it already owns its own loading/
  error/empty states); only a trailing "View all public decks" link is new
  around it, since none of `TrendingRail`'s own tiles link back to
  `/decks/discover` itself.
- **The remaining onboarding doors move below the rails, tightened.** "Try
  sample cards" (needs this page's own async load state) and "Sign in" (no
  side effect — a plain `<Link to="/auth">`) survive as a compact two-button
  row below the live rails, followed by the original feature grid and legal
  footer — additive restructure, never a content purge. The feature grid now
  goes to 4 columns at `≥1024px` (there are exactly four blocks; the wider
  shell fits them in one row).
- **No exit animation.** The welcome is a one-shot surface that replaces itself
  immediately when any door is chosen. Instant replacement via React state is the
  symmetric exit — it reads as deliberate action, not a vanish.
- **Entrance animation, now on the whole shell.** `welcome-rise`: opacity 0→1
  - translateY 12px→0 over `--motion-gentle` (320ms) `--ease-out-soft`,
    applied to `.welcome-shell` (was `.welcome-card`). No exit needed (see
    above). The `prefers-reduced-motion: reduce` block sets `animation: none`
    — not a 0.001ms backstop (infinite loops don't apply here, but the
    reduced-motion gate still must be explicit per the Motion [§ Reduced-motion](../STYLE_GUIDE.md#motion)
    rule).
- **Dismissal on the Import CTA & Try-samples door only; Sign-in defers to
  AuthPage.** Both call `markEverVisited()` immediately (the user has made
  their activation choice). "Sign in" navigates to `/auth` without marking —
  the auth store calls `markEverVisited()` on any auth completion, so if the
  user abandons /auth the welcome reappears on next boot.
- **Sample load reuses the existing path.** "Try sample cards" calls
  `importText` → `loadSampleBinders` exactly as BindersIndexPage does (same
  CSV, same store action). No fork of sample data; the import appears as the
  normal deletable "Sample: starter pack" entry in import history.
- **Disabled-scope matches the interaction, not the page.** When one door runs
  an async op, only _that_ door is `disabled`. The sample load must not
  disable the hero's Import CTA or Sign in — they're independent `<Link>`s
  (no `disabled` concept at all) to independent routes, and locking them
  removes every exit during the wait.
- **Every step of the auth funnel carries the `BrandMark`.** AuthPage and
  ChooseUsernamePage (and any future step) open with
  `<div className="auth-brand-hero" aria-hidden="true"><BrandMark size={48} /></div>`
  before the `<h1>`, so a mid-funnel screen reads as the same branded flow rather
  than a disconnected utility form.

## Guest gates — every "Sign in" door carries `returnTo`

A gated surface (Friends, Trades, Pods, Online play, game nights, Saved decks,
a deck's share dialog, the feedback sheet, the friends-only shared view, the
header's own Sign in) links to `useSignInPath()` from `lib/sign-in-path.ts`,
never a bare `/auth`. AuthPage already honours `?returnTo=` (same-origin
relative paths only — `safeReturnTo`), so a finished sign-in — and "Continue
without an account" — lands the person back on the page they were gated from.
Before this, tapping Sign in on Friends and creating an account dropped a new
player on Home, where Friends is one more tap away on a phone; the first thing
the app taught them was that doors don't lead back. `/` and the auth pages
themselves get a bare `/auth` (nothing to return to, and no redirect loop).
`GuestActionPopover` was the reference implementation; the helper just makes
it the only way to build the link.

**A refused door is a state, not an error (2026-09-19, playtest batch 11).**
When a gate turns someone away on purpose — a signed-in stranger on a
friends-only share (403), a guest on the same (401), an invite-only night — the
page renders that outcome under its own heading ("Friends only") with the
next door (Sign in with `returnTo`, or Friends), never the generic "Something
went wrong" + "Go to SpellControl". Nothing went wrong; the gate did its job,
and an error heading teaches the reader the app is broken. `share-client.ts`
throws a typed error per outcome (`ShareAuthRequiredError`,
`ShareForbiddenError`, `ShareNotFoundError`) so a view can branch on the
outcome rather than on a message string. The same rule closes a surface that
has _ended_: a game night past its reply window says "This game night has
already happened" up front instead of offering Going / Maybe / Can't and
refusing after the tap.

**A share door says "Sharing" on its face.** The deck editor's visibility
chip is the page's only share entry ([§ Overlays](../STYLE_GUIDE.md#overlays) keeps it that way — no second
Share button to compete with it), so it reads `Sharing: Private`, not just the
state word: a first-time user looking for "share" has to be able to find it
without hovering for the aria-label. The state word still leads visually — the
prefix is muted (`.deck-visibility-chip-prefix`).

**A value in the deck hero's meta line that can change is a link to its own
sheet (E465).** Sharing opens ShareDialog from its status; the format opens
`DeckFormatSheet` from its label (`DeckFormatLink`). Both wear the
`.deck-meta-link` family (`deck-builder-editor.css`): the line's voice, the
accent on the value, underline on hover, and an accessible name that says the
verb (`Format: Commander. Change format`). A fact that can't change there
(the count, the value) stays plain text. The line starts below the name's
0.22em slack, so the format link never takes the name's bottom edge. On a
coarse pointer the line's `line-height` is the 44px touch target and each
link inherits it, so a link is exactly as tall as its own line box. No meta
link grows a `::after` ghost: an inline link can't know which line it wrapped
onto, and every pixel above or below its line belongs to the name or to the
other line's links (`styles/touch-ghost-clearance.test.ts`).

**A format switch shows what it does before it commits, and doesn't confirm.**
The sheet lists the formats as a `ChoiceList`; picking one shows the lines
that are true for THIS deck (`describeFormatSwitch`: the commander moving
into the deck, cards the new format flags, the sideboard starting or
stopping to count, a sideboard over the new format's 15-card cap,
Commander-only tools going away). The switch is one
`replaceDeck` inside one `recordEdit`, removes no card (a commander the new
format can't have moves into the deck with its copy), and its toast offers
Undo, so it follows [§ Verbs](../STYLE_GUIDE.md#verbs-one-behaviour-per-action-t157-2026-09-27): undoable, so no confirm. Never promise a rule
nothing enforces. The 60-card formats' 15-card sideboard cap is enforced
since E468 (`validateSideboardSize`: the legality banner, the deck checks'
"Sideboard size" row, the complete seal), so the sheet names an overrun the
switch starts flagging. Commander's sideboard stays an uncapped holding pile
and Considering never counts; the deck list's badge counts flagged cards
only, so neither size overrun shows there.

**New deck starts at a page of doors, not a form** (T168). `/decks/new`
asks one question, how to start, and each answer is a door
(`.deck-new-door`): Generate a deck (the featured, full-width door with a
drawn primary call to action), Brew it slot by slot, Empty deck, Import a
list, Add a product. Format sits above them because it decides which doors
apply: a format without a commander keeps only Empty and Import and says why
in one line; Pauper Commander drops Brew (EDHREC has no PDH data); Add a
product shows only under Commander, whose precons it builds. A door that goes
somewhere is a link, one that acts here is a button, and its accessible name
is its title with the description attached by `aria-describedby`. The format
rides in `?format=` (written with `replace`), so Back, a reload and the
generator's "Change format" link all land on the same pill. Nothing on the
page asks for a commander. No wizard: each door leads to one existing flow.

**The empty start is an open slot** (E465). Its door is dashed
(`--border-strong`, transparent, the BinderStartChooser Blank idiom). One tap
creates a deck with no commander in the selected format and opens it,
**Private**: an empty "Untitled deck" never publishes itself; the editor's
Sharing chip publishes it later. The ⌘K "Empty deck" command is the same start.

**The generator keeps its build actions in a sticky bar** (`/decks/new/generate`,
`.deck-generate-bar`). Generate and Start blank sit in a sticky footer
(`bottom: 0`, `--z-popover`, opaque `--surface-raised`) with a one-line recap
of the choices above them. The bar is the page's last child, so at the end of
the page it sits in flow and covers nothing. Visibility stays a full
`VisibilityChoice` section in the page (every hint visible, including why
Public is unavailable) and the bar only echoes the pick. On a phone the recap
hides and the two buttons split the row, unless the recap is the reason the
buttons are disabled (a choose-a-color commander).

## The You page — one page, one name, precise doors

The phone tab bar's fifth tab is **You**, it opens `/you`, and the page's hero
says **You** — to a guest and to a signed-in player alike. The page is not
called Settings anywhere a user can read: Settings is the part of You that
starts below Identity, not the page's name. The hero's meta line names only
what _this_ reader will find on the page ("Profile, account, appearance, and
data tools." signed in; "Account, appearance, and data tools." as a guest —
a guest has no Profile card, and [§ Voice](../STYLE_GUIDE.md#voice--copy)'s first-time-state rule says never
point at a thing the reader hasn't got). Rulings, with the reasoning that
picked each over its alternatives:

- **The page takes the tab's name, not the other way round.** The tab wears
  the player's own avatar once signed in, the route is `/you`, the command
  palette entry is "You", and the first tier is who you are (Profile,
  Account, Sign-in methods, the Friends pointer). An avatar under a tab that
  says "Settings" reads wrong, and a name that switches with sign-in ("You"
  for players, something else for guests) breaks the one thing the page has
  to do: read the same to a first-time guest, a signed-in player, and someone
  arriving from a header menu item. Before this a first-time guest tapped
  "You" and landed on a page called "Settings".
- **The header's Profile, Settings and Shared links stay three menu items
  landing on one page** — three different jobs on one scroll — and each is a
  `?section=` jump that puts its promised heading at the top of the viewport:
  Profile → `?section=profile` (the Profile card), Settings →
  `?section=settings` (the **Preferences tier header**, where everything
  below Identity starts), Shared links → `?section=sharing`. A menu item that
  landed on the page top would show the hero "You" under a label that said
  "Settings" — the exact mismatch the rename removes. Every other door into
  the page names what it lands on the same way: the header sync pill →
  `?section=account` ("Tap for sync details", the Account card holds the full
  indicator and retries), the auto-link banner → `?section=sign-in` ("Manage
  sign-in methods"). A door's copy names the control or card it lands on,
  never "Settings" as a place ([§ Voice](../STYLE_GUIDE.md#voice--copy): a hint names the control).
- **A guest sees the sign-in card first, preferences below.** Under Identity,
  "Not signed in" with "Sign in to sync" (carrying `returnTo`, § Guest gates)
  answers "who am I here" honestly in one row, and sign-in is the one action
  that changes everything else on the page (Profile, Sharing, sync). It is
  not a wall: the Theme grid is the next thing on screen, and every
  preference and data tool works without an account.
- **Profile sits above Account for a signed-in player.** The tab's avatar is
  the door; the page opens on the same face, editable. Account (signed in
  as, Sign out, Sync status) is administrative and follows.

**Every `?section=` value must resolve to a heading id that exists.**
`SECTION_HEADING_IDS` in `pages/YouPage.tsx` is the vocabulary (the door's
own words: `profile`, `account`, `sign-in`, `settings`, `appearance`,
`sharing`, …), and a value whose id isn't rendered is a silent no-op — four
of them (`profile`, `account`, `collection`, `danger`) shipped that way,
pointing at `-group-title` ids the page never had. The three tier headers
carry ids (`settings-identity-tier-title`, `settings-preferences-tier-title`,
`settings-your-data-tier-title`) so a tier can be a target.

**A deep-link landing is re-pinned while late cards arrive.** One
`scrollToHeading` on mount is not a landing when cards above the target
render after their fetches (Sign-in methods after the identities call, the
share-link list after its own): the target ends up a card's height below the
top — "Settings" used to land a signed-in phone on the Friends card, 230px
short of Appearance. `YouPage` observes its own root with a `ResizeObserver`
for a short settle window (`SECTION_SETTLE_MS`) and re-scrolls the same
heading on every layout change, focusing it exactly once — on the first pass
that actually finds it, which for a target that is itself a late card
(`sign-in`) is not the mount. The first pointer, wheel or key from the user
ends the window early, so a late resize never yanks a page they have started
reading. `scrollToHeading` returns whether it found the heading and takes
`{ focus: false }` for the re-pin passes; it focuses with `preventScroll`,
because a bare `focus()` runs its own scroll-if-needed and in Chromium that
cancels the smooth scroll just started whenever the heading is already
inside the viewport (the heading took focus and stayed mid-screen).

**`/settings` is an alias that keeps its query string.** The header sync
pill, the auto-link banner and the backend's OAuth link callback still send
`/settings…`; `SettingsRedirect` in `App.tsx` forwards to `/you` with the
search intact, because `/settings?linked=google` is how the "Google account
linked." toast reaches the page — a bare `<Navigate to="/you">` dropped it
and the toast never fired.

**A landed heading sits one step in, not flush.** `scrollIntoView` aligns
the heading to the scrollport's top edge and ignores the container's
padding, so the first landings sat pressed against the header on desktop
and the screen edge on a phone. Every heading the link map can target
(`.settings-tier-header`, `.settings-section-header`, `.settings-card-title`
inside `.settings-page`) carries `scroll-margin-top: var(--space-4)` — one
rule, one value, no per-heading offsets.

**The desktop guest's door is the Settings gear.** A guest has no avatar
menu and the tab bar doesn't render at ≥1024px, so the header shows a gear
`NavLink` labelled "Settings" beside "Sign in", making the same
`?section=settings` jump the menu's item makes (theme, typeface, currency
and backup all work without an account). Signed in, the gear gives way to
the avatar menu — the `.site-nav-settings` gear was the original door and
the avatar menu replaced it for players only. Before this a signed-out
desktop user could reach those preferences only by URL or the command
palette.

**The profile round trip closes in both directions.** The Profile card's
hint links "public profile" to `/u/:username`; on your own public profile
the brand bar's action is "Edit profile" (→ `?section=profile`) instead of
Report — the server's `isOwner` flag decides, and nobody reports
themselves.

## Command palette (⌘K) — desktop-only by design

The palette (`components/CommandPalette.tsx`, model in `lib/commands.ts`) is
reachable by **⌘K / Ctrl+K** anywhere outside a text input and is listed in
the `?` shortcuts overlay. That is its whole entry surface: **no header
button, no tab-bar trigger, no touch affordance**, on purpose. Its value is
keyboard velocity (type three letters, Enter, you're there), not reach.
A phone already has the tab bar for navigation and the `/search` utility for
cards, and a tap-to-open palette on a 360px screen is a slower version of
both. Don't add a visible trigger to "make it discoverable" on touch; if a
phone needs a shortcut to something, it goes in the tab bar or a page's own
action row ([§ Toolbars & action rows](components.md#toolbars--action-rows-responsive)). Settled 2026-09-07 (sweep-3, E262).

## Keyboard shortcuts — discoverability pattern (UX-334)

**One global overlay, one registry.** The `?` key opens a single
`KeyboardShortcutsOverlay` (a shared `Modal`) from anywhere outside a text
input. Pages/components contribute their section via
`useRegisterShortcuts(sectionTitle, shortcuts)` from `lib/shortcut-registry`.
The overlay renders all mounted sections in registration order ("Global" always
first, since Layout mounts it first). Do NOT wire a local `?` listener in a
page — the global listener in Layout handles it.

**`shortcuts` must be stable.** Pass a module-level constant or `useMemo` array
— never an inline array literal. An inline literal creates a new reference on
every render, causing `useRegisterShortcuts`'s effect to re-register
repeatedly (an infinite render loop).

**Input guard.** The `?` key is suppressed when focus is inside any
`<input>`, `<textarea>`, `<select>`, or `contentEditable`. The guard is
`isTypingTarget` from `lib/shortcut-registry`.

**Footer chip.** A `<button className="footer-shortcuts-chip">` in `Footer.tsx`
calls `show()` from `useShortcutRegistry`. It is `display:none` by default and
revealed only at `≥1024px` + `(hover:hover) and (pointer:fine)` — i.e. desktop
fine-pointer only. Do NOT add similar chips to page headers/toolbars.

**`kbd` styling.** The overlay uses `.shortcuts-overlay-kbd` (from `styles/modals-dialogs.css`).
The footer chip uses `.footer-shortcuts-kbd`, and the command palette's
`.cmdk-footer kbd` now matches them. All three share one visual treatment
(mono, `--text-primary` on `--surface-raised`, `--border-strong` box) — don't
hand-roll a fourth variant (the palette shipped as a divergent third and was
re-aligned in sweep 3).

---
