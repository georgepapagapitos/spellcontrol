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
5. **Use contractions** — "Couldn't add {card}", not "Could not add". They match
   the human register everywhere user-facing (errors, confirms, hints).

**Primary empty states are two parts: tagline + hint.** A short tagline naming
the state ("No decks yet."), then ONE hint sentence giving the reason and the
action that changes it ("Build a deck from scratch…"). Never a bare line, never
an exclamation. Use the shared `.empty-state` + `.empty-state-tagline` +
`.empty-state-hint` markup (don't hand-roll a per-page empty class). This is for
**primary** (page/section-level) empties. A small **inline sub-panel
placeholder** (a sideboard slot list, a mini-chart's no-data line) may stay a
single concise line — the two-part pattern would read visually heavy there.

**Lift/co-play explanations (E71):** evidence phrasing is fixed vocabulary —
`Lifted by {A}, {B}` for cluster connectivity (up to 3 card names) and
`Pairs hard with {A}` for a single bomb pairing. Reuse these verbatim on any
surface explaining a lift-driven suggestion (Build Report hidden-synergy picks
and synergy fills, Coach fix-gaps rows); don't coin new synonyms ("synergizes
with", "co-played with"). Combine with other evidence using the mid-dot
separator: `Fits your deck's {tags} · Lifted by {A}, {B}`. Concrete card names
are the point — never replace them with a count or "AI" phrasing (rule 3).

**Confirm dialogs:** the title is the question ("Delete \"{name}\"?"); the body
is a declarative consequence ending in a period ("This cannot be undone."). The
body never re-asks the question.

**Toasts:** a status fragment takes no period ("Added Sol Ring", "Undone: cut
Llanowar Elves"); a complete sentence takes one ("Prices refreshed.", "Link
copied to clipboard."). Pick fragment for action confirmations, sentence for
state announcements.

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

**Punctuation:** complete sentences end with a period; a trailing `…` means
either "in progress" (loading) **or** a **picker/selector action** — one that
lets you choose an item from a list ("Move to another deck…", "Pick another
card…", the "Save As…" convention); never decorative. It does **not** extend
to general CRUD dialog openers — "Plan a game night", "Edit night", "New
deck" open a form, not a picker, and stay bare. One em-dash max per string.

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

**Page-hero CTAs are pills; below the hero, rectangles act and pills label.**

| Use                         | Radius                             | For                                                                                                                      |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Page-hero CTAs**          | `999px` pill (`.pill-btn`)         | Actions in a page hero (the `.binder-hero` row): Add cards, New deck, Share, Import deck… The deliberate hero signature. |
| **Action buttons**          | `var(--radius)` (8px) rounded-rect | Any other do-something button: toolbar, dialog/sheet, panel actions, Draw/Deal/Simulate.                                 |
| **Cards / panels / sheets** | `var(--radius-lg)` (12px)          | Container surfaces.                                                                                                      |
| **Pills (labels)**          | `999px`                            | **Non-actionable** chips, badges, counts, tags, color swatches/dots — things that _label_ state.                         |

**Hero CTAs are the one labelled-pill tier.** Outside a page hero, the only
pill-shaped button is a genuinely **circular icon-only** one (equal
width/height, no text) — e.g. the `⋮` overflow button, the round `+` add
button. Any other labelled button below the hero is a rect, never a pill.

Anti-patterns this rule kills:

- The same action rendered as two shapes across breakpoints (e.g. a pill on
  mobile, a rect on desktop).
- A non-hero text button styled as a pill — it reads as a tag.

**The one labelled-pill exception below the hero: toolbar controls.** Compact
toolbar _pickers and disclosures_ — Sort / Group / Show / the view-mode toggle /
the symbol **Key** — use the shared `.toolbar-pill` (`999px`, `--surface` bg,
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

**Documented exception — radial-menu sectors.** `.radial-tag-menu-item`
(the deck editor's quick-tag radial) is actionable yet keeps `999px`: the
sectors are chips arranged on a circle, and a rect doesn't sit naturally on
ring geometry. This exception is geometry-driven only — it is not precedent
for pill-shaping any other actionable chip (filter chips stay rects, e.g.
`.collection-filter-chip`, `.deck-tag-bar-chip`).

**Segmented controls split container vs option.** The wrapper
(`div[role="radiogroup"]`, e.g. `.binder-mode-toggle`) is a **container** →
`var(--radius-lg)`. Its inner option buttons are **rects** (`var(--radius)`)
unless the segmented control is a genuine _toolbar view-mode toggle_ that lives in
a control row (then the whole `.toolbar-pill` segmented family is `999px`, e.g.
`.pick-mode-toggle`). A radio/segmented selector inside a form or settings panel
is not that — its options are rects.

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

## Icon scale

App-wide `lucide-react` usage has ranged 11–18px / 1.6–3 stroke width with no
stated rule. These are the **defaults for new usage** — not a retrofit
obligation on existing icons:

| Context                                                           | Size | Stroke |
| ----------------------------------------------------------------- | ---- | ------ |
| Inline-with-text (leading glyph beside a label/word)              | 14px | 1.8    |
| Standalone trigger (a tappable icon-only or icon+chevron control) | 16px | 2      |
| Hero-adjacent (next to a page-hero heading/CTA)                   | 18px | 2      |

Pick by the icon's role, not the surface it happens to sit on — a leading
icon inside a button label is "inline-with-text" even if the button itself is
a hero CTA.

## Tabs / view switchers

- Page-level "distinct views" switcher → the `underline` variant of
  `components/Tabs.tsx` (accent underline tracks the active tab). It reads
  unambiguously as tabs; the soft `hub` nav-pill look does **not** and is
  reserved for the site/section nav (e.g. the Collection header).
- All tabbed surfaces go through the shared `components/Tabs.tsx` primitive
  (roving tabindex, arrow-key nav, `role=tablist`/`tab`/`tabpanel`). Don't
  hand-roll a tab strip. **This applies inside overlays, sheets, modals, editor
  panels, and admin/debug pages too** — an internal audience does not exempt a
  view from keyboard navigation. Partial ARIA (a hand-rolled `role="tab"` with
  no roving tabindex or arrow keys) is **worse** than none: it advertises a
  contract the component then fails to honor. Use the primitive.
- **`fitted` requires labels that are short AND equal**, never more than three
  tabs. The concrete test: at 320px and full panel width every label must render
  in full with no ellipsis (a 3-tab fitted strip gives each tab ~106px ≈ 10
  characters; a trailing count badge counts toward that width). If any label
  fails, use `variant="scrollable"` (tabs size to content, the strip scrolls).
  Four or more tabs always use `scrollable`. "In deck" vs "One card away (N)" and
  "Battlefield" both fail the test.
- **Pass `variant="underline"` explicitly on every page/section-level switcher.**
  `Tabs` defaults to `variant="fitted"` (equal-width segments, each label clipped
  with `text-overflow: ellipsis`). `fitted` is **only** for 2–3 short, equal-length
  labels inside a panel (combos/analysis; Play's Host/Join sub-switcher). Omitting
  the prop on a page-level switcher with unequal labels silently truncates them at
  every width — "Online"→"Onli…", "Create account"→"Create acc…" — because the
  segments are forced into equal fractions regardless of available room. This bit
  both the Play sections switcher and the Auth (Sign in / Create account) toggle.
  Compliant reference call sites: DeckEditor, Friends, Cube.

## Toolbars & action rows (responsive)

Horizontal strips of buttons/controls in a header are the app's most repeated
overflow bug: each time a new control is added, the row outgrows a phone and the
last item clips. There are **two kinds of strip**, each with one rule — and one
hard constraint they share.

**Hard constraint (both kinds):** a strip that can ever exceed the viewport must
**never** be `flex-shrink: 0` + no-wrap. That combination is exactly what clips
at 320px. If it can't shrink, it must wrap or collapse.

1. **Action rows** — a primary call-to-action plus secondary actions (the page
   heroes: Decks / Collection / Binders).
   - Keep the **primary CTA labelled and always visible.**
   - Collapse the **secondary actions into a `⋮` overflow at `≤600px`** using the
     shared `components/OverflowMenu.tsx` (kebab + popover, outside-click/Esc
     close; opens from its own wrapper — for **virtualized rows** use
     `CardRowMenu` instead, which portals out of the clipping row). The Decks
     hero is the reference: New deck stays a labelled pill, Import deck + Add
     precon move into the kebab on phones.
   - Don't "solve" crowding by going **icon-only on ambiguous glyphs** — a box
     for "Add precon" isn't legible without its label. Icon-only is only for
     universal glyphs (search, close, settings).

2. **Control rows** — pickers with no single primary action (Sort / Group /
   Filter / view-mode toggles; e.g. `.card-list-summary-actions`, the binder
   sort bar).
   - These **wrap** (`flex-wrap: wrap`) and may shrink — overflowing controls
     flow to a second line, never clip. Adding one more picker (this rule was
     written after "Group by" overflowed the collection toolbar) must stay safe
     by construction.
   - Keep each control compact: a `SelectMenu` shows its **current value** (icon
     - value), not a redundant static label.

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
   - **Multi-destination exports** (calendar, share targets) are **one labelled
     menu trigger** (`trigger` prop on `OverflowMenu`, e.g. "Add to calendar ▾"
     with a chevron), never one button per destination.

**Multi-destination exports are one labelled menu trigger — everywhere, not
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
- **Under the hub, pin below the tabs.** Any sticky row rendered inside the
  hub's outlet must offset by the tab strip via a `.collection-hub-tabs ~ *`
  scoped rule pinning at `calc(var(--hub-tabs-sticky-h) - 1px)` (see
  `.collection-toolbar-row`, `.binders-index-search-row`). A bare `top: 0`
  slides **over** the tab strip when scrolled — same z tier, later in DOM.

## Card-name chips

Card-name chips render the name on **one line with ellipsis truncation** and
never wrap. Put the truncating text node on the shared
`.card-name-chip-text` utility, and make sure any pill/chip flex item that must
shrink also has `max-width: 100%` and `min-width: 0` so the ellipsis can engage.

The full card name must remain reachable: expose it with `title` on the name
element for desktop hover, and keep any existing tap-to-preview/card carousel
affordance for touch. `title` is never the sole path to the full name.

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

## Overlays

- **Multi-destination exports/shares are one labelled menu trigger**, never
  one button per destination — see § Toolbars & action rows → Card action
  rows for the full rule. It's binding on any surface, not just card footers.
- On-demand panels that shouldn't live inline (Add cards, Test hand) use the
  shared **card-picker** pattern: `.card-picker-root` + `.card-picker-sheet` —
  a **bottom sheet on mobile, centered modal ≥1024px**. Dismiss via backdrop
  tap, a close button, and `Esc`.
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
  `window.confirm()`.** The native dialog can't be themed, freezes the event
  loop, loses focus on dismiss, and renders inconsistently in Capacitor
  WebViews. Use a two-step `<Modal dismissable={!busy}>` with a red confirm
  (reference: `ConfirmDialog.tsx`). Hand-rolled `.modal-backdrop` dialogs are
  also discouraged — route through `<Modal>` so the exit animation, focus-trap,
  and scroll-lock come for free (see § Motion).

## Index-page insight strips (UX-334)

An insight/advisor engine surfaced on an index page (readiness, coaching,
cross-entity suggestions) **collapses to a one-row summary strip that opens a
sheet on tap — it never displaces the page's primary content.** The first ship
of "Between your decks" (E90) rendered its full suggestion list inline above
the Decks Index grid, pushing every deck below the fold; the fix (`fix(decks):
Between your decks collapses to a one-row strip + sheet`) is the reference
implementation (`components/deck/BetweenYourDecks.tsx`):

- **Strip**: one toolbar-row tall, full-width, a real `<button>` (not a card),
  `min-height: 44px` on coarse pointers. Contents: a leading icon, a label, a
  small count pill (`999px`, `--surface` bg — a non-actionable label per the
  Pills rule), and space permitting a one-line teaser of the top item that
  truncates with ellipsis — **hide the teaser entirely below 600px rather than
  wrapping it**. Trailing chevron signals "opens something."
- **Zero visible items → render nothing.** No empty state on the index itself
  (a "you're all caught up" message, if ever needed, lives inside the sheet,
  not as a permanent fixture on the page).
- **Tap opens the existing `card-picker` sheet shell** (§ Overlays) with the
  full suggestion cards — same accept/dismiss/undo behavior, just re-housed.
  Dismissing the last item inside the sheet closes it and removes the strip.
- This is a re-housing pattern, not a new interaction: the sheet's contents
  should be near-identical to what an inline surface would have shown, just
  gated behind one tap instead of always-on real estate.

## Public shared views (/s/:token)

Public shared views wrap their content in `components/shared/SharedShell.tsx` — **not** the app
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

## Info tooltips

When a label needs a plain-language explainer for a concept not everyone knows
(jargon, a scoring formula), use the shared **`components/InfoTip.tsx`** — a
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

## Z-index / layering

- **Always use the `--z-*` tokens** (in `styles/tokens.css`), never raw integers:
  `--z-dropdown` (50) · `--z-popover` (60) · `--z-menu` (80) · `--z-panel` (100)
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
  3. `--z-menu` (80) — menus/popovers opened from a **header/hero that sits
     above sticky chrome** (e.g. a ⋮ overflow in the page hero). One tier above
     the sticky row so it floats over it instead of dropping behind.
  4. `--z-panel` (100) and up — fixed app frame (tab bar), sheets (`--z-sheet-*`),
     modals/overlays (`--z-modal`/`--z-overlay`), tooltips (`--z-tooltip`). These
     always sit above all of the above.
- **The recurring bug:** a sticky search/nav row at `--z-panel` swallows any menu
  opened from the hero above it. Two fixes are wrong (`calc(--z-panel + 1)` on the
  menu) and one is right (drop the sticky row to `--z-popover`, put the menu at
  `--z-menu`). Precedents that get it right: the deck editor's
  `.deck-editor-view-tabs` (`--z-popover`) + `.deck-editor-overflow-panel`
  (`--z-menu`); the decks/binders `…-index-search-row` (`--z-popover`) +
  `.overflow-menu-popover` (`--z-menu`).
- **Rule of thumb:** if A must paint over B, A's token must be strictly greater
  than B's — and B is whatever A physically overlaps, _not_ what's near it in the
  DOM. A sticky element creates its own stacking context, so its token wins
  against later siblings regardless of source order.

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

Don't invent a new bezier — if none of these reads right, that's a
STYLE_GUIDE discussion, not an inline constant.

**`--ease-pop`'s overshoot is scoped to numeric/counter pops** (a value tick,
a badge count bump) — a spring read that suits a number jumping. This is a
**documented decision, not an oversight**: `SealBurst` (§ Completion moments)
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

Gyro tilt is a foil-and-preview-only interaction — foil/etched cards only, in
the card-preview surface only. The listener attaches on preview open and detaches
on dismiss (zero idle battery cost).

**Mandatory gates (all must hold for the listener to attach):**

1. The card is foil or etched (`card.foil` truthy — `classifyFoil` returns a
   style other than `'none'`).
2. Touch device — NOT `(hover: none)`: Samsung WebViews report `hover: hover`
   on touch (the documented Galaxy trap), so the robust check is the inverse
   of the full desktop gate: `!matchMedia('(hover: hover) and (pointer: fine)')`.
3. `prefers-reduced-motion: reduce` is NOT set. Vestibular motion triggered by
   hand movement is exactly what that media feature is for — hard-disabled, not
   just reduced.
4. Swipe suppression: during a parent-owned swipe gesture, `shouldSuppressTilt`
   returns true and the tilt eases to neutral (same handshake as the cursor path).

**Baseline-delta mapping** — the first orientation sample captured at preview
open becomes the neutral reference. All subsequent samples map only the _delta_
from that baseline, so nobody needs to hold the phone flat for the effect to
work. The pure mapping math lives in `lib/tilt-mapping.ts` (unit-tested).

**No new settings UI.** The gyro interaction is gated by foil + preview-open
interaction context and disabled under OS reduced-motion — no additional toggle
needed.

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

## Color & spacing

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

- **Elevation tiers:** `--shadow-card` (lightest — centered auth/welcome cards),
  `--shadow-tooltip`, `--shadow-sheet`, `--shadow-modal`.
- **On-art scrims are an intentional non-themed exception:** elements that sit on
  card images (qty/set badges on grid tiles) use `--art-scrim` /
  `--art-scrim-text`, not inline `rgba`. Card art is theme-invariant, so these
  tokens are deliberately not themed; using them anywhere else is a smell.
- **Game-canonical colors** (counter gold, etc.) live in the `--mtg-*` block
  (`--mtg-counter-gold`) and are not themed — never hard-code a game-surface hex.
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
  `--space-8` = 4rem) lives in the `:root` token block of `styles/tokens.css`. New code
  uses these tokens for `margin`/`padding`/`gap` instead of freehand rems. Legacy
  off-scale values (0.35rem, 0.6rem, 0.85rem, …) are left alone and get snapped
  to the scale opportunistically — only when the surface is already being touched
  and visually verified, never as a blind find-and-replace. Never hardcode a new
  spacing rem that matches a scale step; write `var(--space-N)`.

## Responsive

### Device tiers (what to build + test against)

There are only **two viewport media-query boundaries** in the codebase — **600px**
and **1024px** (each used ~30× across many files). Everything else is refinement
_within_ a tier, not a tier wall. "XL desktop" is **not** a breakpoint: it's where
content hits its `max-width` cap and centers with side gutters (`--analysis-max:
1320px` for deck-analysis boards, `--page-max: 1400px` for page containers).

| Tier           | Viewport range | Test at (px)                    | What defines it                                                                                                                                                              |
| -------------- | -------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mobile**     | `≤ 600`        | **320** · 375 · 414 · 480 · 600 | base styles; phone layouts, bottom sheets. **320 = hard no-overflow floor.** 480 = cramped-phone refinement.                                                                 |
| **Tablet**     | `601 – 1023`   | 640 · 768 · 820 · 1023          | the gap between the two poles. 640 = deck-bento 2-col **container**-query trigger (not viewport).                                                                            |
| **Desktop**    | `1024 – 1399`  | **1024** · 1101 · 1280          | sticky panels, multi-column, hover-peek (`≥1024`). 1101 = deck-editor layout shift.                                                                                          |
| **XL desktop** | `≥ 1400`       | 1440 · 1920                     | content **stops growing** and centers: deck-analysis caps at `--analysis-max` (1320), pages at `--page-max` (1400). Test for balanced gutters / no dead space, not a reflow. |

- **The two real breakpoints:** `max-width: 600px` (mobile) and `min-width: 1024px`
  (desktop). Use **600**, not 599 — the codebase tolerates the 1px overlap with
  `min-width: 600px` rules. Tablet is the implied `601–1023` gap.
- **Secondary refinement widths** (reuse before inventing new): **480** (tight
  phone), **640** (bento container query + early tablet), **700** (Cost/Optimize/
  Substitution panels), **1101** (deck editor). Don't add bespoke widths casually —
  if you need one, prefer snapping to this set.
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
- **Width caps:** `--page-max: 1400px` (page containers), `--analysis-max: 1320px`
  (deck-analysis boards) — both `margin-inline: auto`. These define the XL tier.

### Other responsive rules

- **44px touch targets** on coarse pointers for anything tappable. The
  mechanism is an explicit `@media (pointer: coarse) { .my-btn { min-height: 44px } }`
  block, separate from the resting style — a button's desktop-density height
  (~2rem) cannot be assumed to meet the floor. **`.btn`/`.pill-btn` are NOT
  44px by default** — the shared base classes render at desktop density
  (`padding: 6px 14px`, no explicit height); every new usage on a touch
  surface needs its own coarse-pointer `min-height: 44px` block, scoped to
  the container/selector that identifies it (don't assume a sibling rule
  already covers it). For a small ✕/clear button inside
  a chip where growing it would distort the chip, expand the hit area with a
  centered `::after` ghost (`position: absolute; width/height: 44px;
transform: translate(-50%, -50%)` on a `position: relative` parent) rather
  than inflating the visible control — reference `.set-filter-chip-x`.
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
  short justified allowlist for base-class-covered variants).

- **`outline: none` inside a `:focus-visible` block is invalid.** A block that
  sets `outline: none` and relies only on a border-color or background shift
  does not meet WCAG 2.4.11's visible-ring requirement. The `outline` property
  is the mechanism — keep it.
- **On the always-dark game board / playtest surface, use a white ring**
  (`outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 3px`) rather
  than `--accent`, which can read poorly on the near-black board.
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

## CSS file layout

- **`src/styles/` holds the global (unscoped) stylesheets**, imported once in
  `main.tsx` in cascade order. The former 13k-line `global.css` was split into
  feature files — each is a contiguous slice of the original, so the cascade is
  byte-for-byte unchanged. Find rules by feature name: `tokens.css` (the only
  `:root` token block), `base-layout.css`, `import-upload.css`, `forms-banners.css`,
  `binder-hero.css`, `search-controls.css`, `stats-breakdown.css`, `tabs.css`,
  `binder-grid-slots.css`, `tooltip-legend.css`, `feedback-spinner.css`,
  `binder-nav.css`, `modals-dialogs.css`, `binder-rules-editor.css`,
  `footer-card-preview.css`, `binder-spread.css`, `responsive-nav.css`,
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
- **Deck components use co-located CSS:** a component in
  `src/components/deck/*` imports its own `./X.css` (e.g.
  `DeckColorPanel.css`), not the central `deck-builder-*.css` files. Shared
  layout/page styles live in the `deck-builder-*` slices; per-component rules
  belong with the component. Because CSS isn't typecheck/lint-gated, a rule put
  in the wrong file renders silently unstyled while CI stays green — verify
  visually or grep the class name.

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
through the shared `classifyInclusion` (`lib/inclusion-label.ts`), which
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

## Bars & meters

Every horizontal proportional bar goes through the shared
`components/shared/MeterBar.tsx` primitives — **never hand-roll a bar track**
(a `style={{ width: '…%' }}` fill div; a source-scan test,
`lib/no-handrolled-bar-tracks.test.ts`, enforces this):

- **`MeterBar`** — single fill: `value`/`max`, optional `color`,
  `size` (`sm` 6px meter / `md` 12px progress), `minPct` visual floor,
  `indeterminate` sweep.
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
(and must not) route through `MeterBar`; reference:
`BetweenYourDecks.tsx` `.between-decks-fit-pip`. Vertical charts (curve hero,
test-hand histogram) are charts, not meters, and stay bespoke. Radar/polar
charts also stay bespoke — see **"Radar / polar charts"** below.

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
  instead ("since Jun 7" via `lib/value-history.ts` `formatDayKey`).
- **Trend sparklines** are decorative reinforcement: small inline SVG
  polyline, line in the accent at reduced opacity with the latest point as a
  solid accent dot, `aria-hidden` with the delta text (plus an `.sr-only`
  prefix) as the accessible content. Render nothing below two data points —
  no empty state. Reference: `components/ValuePulse.tsx`.

## Radar / polar charts

A radar chart is permitted only when displaying **≥3 labeled dimensions of one
normalized measure** — where shape = balance, not absolute magnitude.

Rules (all mandatory):

- **Normalization must be stated in an adjacent caption.** Never imply an
  absolute scale. The caption reads "Engine balance, not power" with an
  InfoTip explaining that vertices are normalized to the busiest axis.
- **Every vertex carries its word + value** — label + count, no unlabeled
  vertices, ever. (The "charts say what they mean" obligation extends to polar
  geometry.)
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
  `lib/playstyle-radar.ts` + the co-located component; `radarLayout` is the
  single geometry source.

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

| Density            | Fields                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **List** (66px)    | thumb · name · foil · deck/binder badges · type glyph · rarity chip + set code + CN · mana · qty · value                                                                                                                                                             |
| **Compact** (32px) | name · type glyph · rarity chip · set code · mana · qty · value — CN returns ≥768px; foil/deck/binder badges return ≥1024px                                                                                                                                          |
| **Grid** (tile)    | art + qty badge + corner deck/binder badges + **rarity chip** (top-right corner, every tile); a **set-code chip** (bottom-left, next to qty) appears **only when the same card name has >1 printing** in the current rows — art is the identity until it's ambiguous |

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

---

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

## Full-viewport centered pages (scroll, don't clip)

**Load-bearing rule — any full-viewport centered card page (auth, the `/`
landing, future splash/onboarding surfaces) MUST be a self-scrolling viewport,
never `min-height: 100vh` + flex centering.** The app shell sets
`body { overflow: hidden }` and `#root` has no height cap, so a `min-height`
page that grows past the viewport spills into the clipped region with **no way
to scroll** — the bottom is silently cut off on short screens, native (under the
notch / home indicator), and any browser whose chrome eats height.
`align-items`/`justify-content: center` can't scroll into overflow; they strand it.

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
  home indicator on native. Add `--keyboard-inset` to the bottom padding only if
  the page has focusable text inputs (auth does; the landing doesn't).
- This is a real bug that has shipped twice (auth register mode; the `/` landing
  footer). Treat it as a hard constraint.

## First-run welcome / landing screen (UX-331)

The first-run gate routes a fresh visitor (and crawlers) to `/` — the public
marketing landing, which doubles as the first-run onboarding surface. It must
follow the full-viewport scroll pattern above. Design rulings settled here:

- **Three doors, two primary.** The hero presents exactly three CTAs: "Import
  my collection", "Try sample cards", and "Sign in". Doors 1–2 are the primary
  pair (pill-btn-primary, accent fill) because collection activation (getting
  cards in) is the event that makes the app useful. "Sign in" is secondary
  (default pill-btn surface) — it's present but not dominant.
- **Hero-class surface.** The landing card is hero-class: a self-scrolling
  centered viewport, `max-width: 560px`, brand eyebrow + serif headline
  (`--font-serif`), pill CTAs, then a feature grid and legal footer below the
  hero. All three doors are pill-shaped because they live in the page hero.
- **The hero is tight; the page can be long.** Above the fold is the headline +
  tagline + three doors. Below it the landing carries real, accurate feature
  prose (it's the only crawlable marketing content the gated app exposes) — but
  the page MUST scroll (see the rule above), and feature claims MUST match what
  ships (formats, generation scope).
- **No exit animation.** The welcome is a one-shot surface that replaces itself
  immediately when any door is chosen. Instant replacement via React state is the
  symmetric exit — it reads as deliberate action, not a vanish.
- **Entrance animation.** `welcome-rise`: opacity 0→1 + translateY 12px→0 over
  `--motion-gentle` (320ms) `--ease-out-soft`. No exit needed (see above). The
  `prefers-reduced-motion: reduce` block sets `animation: none` — not a 0.001ms
  backstop (infinite loops don't apply here, but the reduced-motion gate still must
  be explicit per the Motion § Reduced-motion rule).
- **Dismissal on doors 1 & 2 only; door 3 defers to AuthPage.** "Import" and
  "Try samples" call `markEverVisited()` immediately (the user has made their
  activation choice). "Sign in" navigates to `/auth` without marking — the auth
  store calls `markEverVisited()` on any auth completion, so if the user abandons
  /auth the welcome reappears on next boot.
- **Sample load reuses the existing path.** Door 2 calls `importText` →
  `loadSampleBinders` exactly as BindersIndexPage does (same CSV, same store
  action). No fork of sample data; the import appears as the normal deletable
  "Sample: starter pack" entry in import history.
- **Disabled-scope matches the interaction, not the page.** When one door runs
  an async op, only _that_ door is `disabled`. Door 2's sample load must not
  disable "Import" or "Sign in" — they navigate to independent routes and locking
  them removes every exit during the wait.
- **Every step of the auth funnel carries the `BrandMark`.** AuthPage and
  ChooseUsernamePage (and any future step) open with
  `<div className="auth-brand-hero" aria-hidden="true"><BrandMark size={48} /></div>`
  before the `<h1>`, so a mid-funnel screen reads as the same branded flow rather
  than a disconnected utility form.

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
The footer chip uses `.footer-shortcuts-kbd`. Both have the same visual treatment
(mono, small-caps-border box) — don't hand-roll a third variant.

---

## Extending this guide

When you and a reviewer settle a recurring visual question ("should X be a pill?",
"which radius?", "where does this overlay live?"), add the ruling here in a
sentence or two. Keep entries short and prescriptive — a rule, the rationale if
it's non-obvious, and the anti-pattern it prevents. This doc is only useful if it
stays current, so prefer editing it over re-deciding.

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

### Tiered ordering

The ranker (`lib/coach-rank.ts`) orders moves in three tiers, then by
`deltaScore` / `inclusion`, owned-first within each tier:

| Tier                        | Trigger                                                      | Examples                                        |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| **Tier 1 — severe deficit** | a gap/upgrade move whose target sub-score is < 60            | fill-gap adds when `roles` scores 45            |
| **Tier 2 — quality**        | move targets the weakest `PlanScore` sub-score and it's < 75 | ramp gap when `roles` is the weakest signal     |
| **Tier 3 — polish**         | everything else                                              | combo completions, budget swaps, bracket nudges |

(Deck-size and missing-win-condition _structural_ alerts have no concrete card
move, so they live in the NextBestMove headline above the feed, not as ranked
rows.)

Owned cards surface before unowned within each tier (the standing
`sortOwnedFirst` rule). **No raw score numbers in the UI** — the ordering is
felt, not displayed, to avoid implying false precision.

### Filter-chip row

A row of 999px-radius toggle chips (aria-pressed) sits above the feed. Rules:

- Chips wrap (`flex-wrap: wrap`), never clip — a narrow phone adds a second
  line, not horizontal overflow (control-row rule from the Toolbars section).
- A chip is hidden when its count is zero (except "All").
- Count badges inside chips are `--text-muted` when inactive, `--accent` when
  the chip is pressed.
- The `f` key cycles chips in order (All → first non-zero chip → … → wrap),
  guarded by `isTypingTarget`. Register it under the "Coach" section of the
  `?` overlay via `useRegisterShortcuts`.

### Cuts are separated

Cut suggestions **never interleave** with add/swap rows. They live in a
collapsed `<details>` disclosure at the feed's end ("Cuts (N)"), closed by
default. Opening it does not expand the feed inline — it appends beneath the
last add/swap row. Mixing cuts into an adds feed reads as noise and makes it
unclear whether a row is an opportunity or a warning.

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
- **No fabricated "% match".** The owned-substitute similarity heuristic tops out
  at ~0.44 nDCG@5, so rank order carries fit — never a false-precision percentage.

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

### Empty states

| Situation                                            | Copy                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| No suggestions at all (deck is tuned)                | "Nothing to coach — this deck looks tuned." + hint: "Your deck is well-covered. Try adjusting your bracket target or browsing themes below." |
| A filter chip returns zero rows but other rows exist | "No {filter} suggestions right now." (inline, no doors)                                                                                      |
| Analysis still pending and no changes yet            | Skeleton (`deck-analysis-skeleton` pattern — see Deck-analysis tabs section)                                                                 |

## Binder spread (≥1024px)

### When spreads render

The flipbook (`BinderPagePreview`) activates spread mode exclusively via a JS
`matchMedia('(min-width: 1024px)')` listener. The class `is-spread` is added to
`.binder-pages-backdrop` from JS — there is **no CSS `@media` duplicate**. This
is intentional: DOM and CSS must never disagree about which layout is active.
Spread mode only appears inside the flipbook overlay; the binder grid view is
single-column at all widths.

### Pairing convention

`buildSpreads(pageCount, doubleSided)` in `lib/binder-spreads.ts` owns the
pairing logic:

- **doubleSided (book/verso-recto):** The first spread always has a blank left
  side with page 0 on the right — matches physical book convention. Subsequent
  spreads pair pages as verso/recto pairs. A trailing odd page lands on the
  left of a final spread with a blank right.
- **Single-sided (simple pairs):** Pages pair sequentially: [0|1], [2|3], etc.
  A trailing odd page becomes the left of a final spread with a blank right.

### Spine

The `.binder-spread-spine` element is `aria-hidden` and purely decorative. Its
width is an exact fraction of `--slide-size` (set via `--spread-spine-frac` from
JS) so that pages + spine sum identically to `--slide-size` at every viewport —
no height overflow.

### Tab-divider rules

Physical index-tab dividers appear in the left/right gutters outside the spread
slide when the binder has more than 1 section. They are rendered only in spread
mode; nothing renders below 1024px.

**Side split:** a section's tab goes on the **left** when its first page's
spread index is ≤ the current spread index (passed / current sections). It goes
on the **right** when its first page is on a later spread (upcoming sections).

**Current section:** the last left-side tab in section order — the section whose
pages this spread is showing. It carries the `is-current` class and gets an
accent-tinted background and border.

**Compression ladder (per side, decided independently):**

1. If all tabs fit at the full-tab height (default 56px + 6px gap) →
   `variant: 'full'` for all tabs on that side: truncated label text in
   `writing-mode: vertical-rl` + a `ColorPip` when the section has one.
2. If all tabs fit at the mini height (default 30px + 6px gap) → all tabs go
   `variant: 'mini'`: pip if available, else the first character of the label.
3. Otherwise, **sample**: always keep the first tab, last tab, and (left side
   only) the current tab. Fill the remaining capacity with evenly-spaced picks
   from the middle range. Everything in the sampled set is mini.

The compression ladder is a **lib contract with unit tests** —
`layoutSectionTabs` in `lib/binder-spreads.ts` covers the containment
invariant (`top ≥ 0` and `top + height ≤ gutterHeight`) across 2/8/27/40 tabs
at gutter heights 300/600/900px. If you change default heights or the gap,
update the tests.

**A mini tab is a compressed state of a labeled control, not a new glyph.** The
full label is always present as the button's `title` attribute and
`aria-label`, so assistive technology and pointer hover always expose the real
name. There is no Key entry for mini tabs — they require no separate legend
entry because they reduce from full tabs, not from standalone glyphs.

### Exact-fraction geometry rule

The pages + spine already consume exactly `--slide-size` (the exact-fraction
contract from PR-1). Tab gutters live **outside** that budget:

- `--spread-tab-gutter: 30px` is set on the `.is-spread` track rule.
- When tabs actually render the backdrop also carries `is-tabbed`, and the
  `.is-spread.is-tabbed` track override subtracts both gutters from the
  `--slide-size` first min() term (`calc(100cqw - 2 * var(--spread-tab-gutter))`),
  so pages+spine still fit inside the available viewport width. A no-tab
  spread binder (≤1 section) keeps the plain `.is-spread` sizing — no width
  is reserved for gutters that don't exist.
- The slide's `.binder-pages-slide--tabbed` modifier widens its `flex-basis` to
  `calc(var(--slide-size) + 2 * var(--spread-tab-gutter))` so the slide
  envelope covers both gutters — applied to every slide (windowed or
  placeholder) so slide widths never change as spreads enter/leave the
  render window.
- The centering spacers (`::before/::after`) have an `.is-spread.is-tabbed`
  override that accounts for the extra gutter width so first/last spreads
  still center.

**Hard rule:** anything added to a spread slide must either live inside the
pages+spine fraction budget (touching `--spread-page-frac` / `--spread-spine-frac`)
or extend the slide's flex-basis explicitly (like the `--tabbed` modifier above).
Never let content push the pages' computed height past the track — the
exact-fraction contract is what eliminates height overflow at every viewport.
