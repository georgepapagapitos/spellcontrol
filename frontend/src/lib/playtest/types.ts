/**
 * Solo playtest state machine.
 *
 * The reducer is intentionally decoupled from `ScryfallCard`/`DeckCard` — UI
 * layers convert their richer card shapes down to `PlaytestCard` (instance id +
 * minimal display fields) when initializing a session. Battlefield positions
 * are stored as 0–1 fractions of the battlefield box (see `BattlefieldCard.x`),
 * not pixels — that's what lets the same board render into differently-sized
 * containers (a full board, a rail slot, a phone strip) without translation.
 */

export type Zone = 'library' | 'hand' | 'graveyard' | 'exile' | 'command';

export interface PlaytestCard {
  /** Unique per instance — two physical copies of the same Scryfall card get distinct ids. */
  id: string;
  name: string;
  oracleId?: string;
  scryfallId?: string;
  imageUrl?: string;
  /** Back-face art for a genuine two-faced card (transform/MDFC), resolved once
   *  at deck-to-playtest time. Presence of this field is also how the UI knows
   *  a card is real-DFC-eligible for the "Transform" context-menu action —
   *  tokens and single-faced cards never have one. */
  backImageUrl?: string;
  manaValue?: number;
  /** Scryfall mana-cost payload ("{2}{R}{R}") for the hand fan's cost badge.
   *  Optional, and absent from every snapshot saved before the badge existed,
   *  which is exactly why the badge falls back to the bare `manaValue`. */
  manaCost?: string;
  typeLine?: string;
  /** Printed power/toughness, verbatim from Scryfall — so they carry `*`,
   *  `1+*` and the rest unparsed. Present only for cards that have them
   *  (and absent from every snapshot saved before the P/T badge existed),
   *  which is exactly why `BattlefieldCard.pt` renders as a bare modifier
   *  when they're missing rather than guessing a base. */
  power?: string;
  toughness?: string;
  isToken?: boolean;
}

export interface BattlefieldCard {
  card: PlaytestCard;
  tapped: boolean;
  counters: Record<string, number>;
  /** Free-text labels stuck on the card (e.g. "flying", "6/6"). */
  stickers: string[];
  /** Fraction (0..1) of the battlefield box's width, from the left edge, at
   *  which the card's own left edge sits — 0 = flush left, 1 = flush right
   *  (i.e. the UI positions with `left: x * (100% - cardWidth)`, so the card
   *  never renders partway off either edge). Always clamped to [0, 1]. */
  x: number;
  /** Same contract as `x`, vertically (0 = flush top, 1 = flush bottom). */
  y: number;
  faceDown: boolean;
  /** Which face's art is showing for a two-faced card. Independent of
   *  `faceDown` — a transformed card can also be turned face-down. */
  showBackFace?: boolean;
  /** Instance id of the battlefield permanent this card is attached to — an
   *  aura, Equipment, or Fortification. Purely a bookkeeping relation: nothing
   *  checks that the attachment is legal, and nothing decides what happens
   *  when the host dies. The reducer only guarantees the reference is never
   *  dangling (a host leaving the battlefield detaches everything on it) and
   *  never cyclic, so the board can't point at a card that isn't there.
   *  Optional by design — its absence IS "not attached", which is also what
   *  makes it back-compatible with snapshots saved before it existed. */
  attachedTo?: string;
  /** Phased out (rule 702.26) — purely a "remember this doesn't interact
   *  right now" flag for the player's own bookkeeping. Independent of
   *  `faceDown`/`tapped`: nothing stops a phased-out card from also being
   *  tapped, and nothing auto-untaps it when it phases back in — the reducer
   *  enforces no rules here, same as everywhere else in this state. Optional
   *  so it's absent (= not phased) on every snapshot saved before it existed. */
  phased?: boolean;
  /** Power/toughness MODIFIER on this permanent — a running total of the
   *  pumps and shrinks the player has applied by hand (Alt+1..4, or the
   *  card menu), not an absolute P/T. Kept apart from `counters` because a
   *  +1/+1 counter and a turn's worth of Giant Growth are different objects
   *  at a real table: one stays, one wears off, and only the player knows
   *  which is which. The face adds it to `PlaytestCard.power`/`toughness`
   *  when those are numeric, and shows it alone when they aren't. Optional
   *  so it's absent (= no modifier) on every older snapshot; a modifier
   *  that returns to 0/0 is deleted rather than stored. */
  pt?: { power: number; toughness: number };
}

/** Table designations. Monarch/initiative are vocabulary-matched to
 *  game-core's `DesignationKind` (the multiplayer GameBoard); City's Blessing
 *  has no game-core equivalent (it's a permanent per-player status, not a
 *  table-transferable one — Ascend doesn't apply to a multiplayer table the
 *  way Monarch/Initiative do). Solo play has no opponent entities to hold the
 *  other side of a designation, so each collapses to a boolean: true = you
 *  currently hold it. */
export type Designation = 'monarch' | 'initiative' | 'citysBlessing';

/** WUBRG plus colorless — the six buckets a floating-mana tally tracks.
 *  Deliberately no `X`/hybrid/phyrexian bucket: those are cost-side notation,
 *  not a color a coin in your pool can actually be. */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaColor = (typeof MANA_COLORS)[number];

export const MANA_COLOR_LABEL: Record<ManaColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

export interface PlaytestState {
  zones: Record<Zone, PlaytestCard[]>;
  battlefield: BattlefieldCard[];
  rngSeed: number;
  turn: number;
  /** Casts-from-command count per commander card id (keyed by `PlaytestCard.id`).
   *  Display tax is `count * 2` (MTG rule 903.10); incremented only when a card
   *  moves command → battlefield, never decremented (undo restores it via the
   *  normal snapshot mechanism). */
  commanderTax: Record<string, number>;
  /** Your life total. Goldfishing tracks nobody else's: there are no virtual
   *  opponents, no commander damage dealt outward and no table to sweep. A
   *  real table's seats live on the online `GameState`, not here. */
  life: number;
  /** Starting value, remembered so RESET can restore it (format-aware — see
   *  `playtestLifeConfig`). */
  startingLife: number;
  /** Table designations you currently hold (E-123-ish playtest badges). See
   *  `Designation` for the model. Monarch/initiative reset with RESET (a new
   *  game); City's Blessing does too — it's permanent only *for the game it
   *  was achieved in*. */
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  /** Your own player-scoped counters — energy, experience, and anything else
   *  a deck tracks on the player rather than on a permanent. Optional for
   *  snapshot back-compat; absent === empty. */
  playerCounters?: Record<string, number>;
  /** Floating mana, by color (E-goldfish-wave-3) — display/tracking only, the
   *  same bookkeeping-not-rules-engine model as everything else here: the
   *  player increments/decrements it by hand, nothing here ever auto-taps a
   *  land or spends it against a cost. See NEXT_TURN in reducer.ts for when
   *  it empties. Optional for snapshot back-compat; absent === all-zero. */
  manaPool?: Record<ManaColor, number>;
  /**
   * Battlefield permanents currently marked as waiting to resolve, bottom
   * of the stack first — so the LAST id is the top, which is what
   * RESOLVE_STACK takes by default.
   *
   * Being on the stack is a MARK ON A CARD THAT IS ALREADY IN PLAY, not a
   * zone that holds it: the permanent keeps its position, its counters and
   * its place on the battlefield, and simply renders a ribbon while it is
   * listed here. That is why this is a plain id list rather than a list of
   * card objects — there is no second copy of the card anywhere.
   *
   * A card that leaves the battlefield drops off this list, so it can never
   * name something that is not there. Optional for snapshot back-compat;
   * absent === empty.
   */
  stack?: string[];
  /** Ids of cards in hand you are currently showing the table (R). Hand is
   *  otherwise hidden information, so this is the one list that lets a
   *  specific card out of it without moving zones — the projection reads it
   *  to decide what an opponent may see. Optional for snapshot
   *  back-compat; absent === nothing revealed. A card leaving hand drops
   *  off this list. */
  revealed?: string[];
  /**
   * How much of the library its owner is currently showing the table. The
   * library is MTG's other private zone, so like `revealed` this is the one
   * thing that lets its contents out without a zone change, and the
   * projection reads it to decide what an opponent may see.
   *
   * `top` is the persistent Future Sight / Bolas's Citadel mode — the card
   * on top is played with face up and stays revealed as it changes. `all`
   * is a whole-library reveal. Optional for snapshot back-compat; absent
   * reads as `none`, which keeps a library that predates this private.
   */
  libraryReveal?: LibraryReveal;
  /**
   * Ids of cards in exile that were put there FACE DOWN. Exile is otherwise
   * a fully public zone, so this is the one thing that keeps a card in it
   * hidden: the projection redacts these to a bare masked id, the way a
   * face-down permanent is redacted. Their owner still sees them — you know
   * what you exiled — which is the asymmetry the flag exists to create.
   *
   * A card leaving exile drops off this list. Optional for snapshot
   * back-compat; absent means nothing in exile is hidden.
   */
  faceDownExile?: string[];
  /** Snapshots of prior states (cap kept inside reducer). UNDO pops the head. */
  past: Omit<PlaytestState, 'past'>[];
}

/** Scry, surveil, and mill are the same operation — look at the top N of the
 *  library and redistribute it — differing only in where the cards you don't
 *  keep on top are allowed to go (bottom for scry, graveyard for the other
 *  two) and, for mill, in nothing going back on top by default. */
/**
 * How much of the library its owner is showing, and to whom.
 *
 * `top` and `all` are shown to the table. `top-me` is the SAME face-up pile
 * shown only to the player whose library it is: the projection leaves it out
 * entirely, so "Me" is private at the wire and not merely hidden in an
 * opponent's UI. There is deliberately no `all-me` — you can already read
 * your own library with the viewer, so revealing it to yourself would be a
 * second way to do nothing.
 */
export type LibraryReveal = 'none' | 'top' | 'top-me' | 'all';

export type ScryMode = 'scry' | 'surveil' | 'mill';

export type PlaytestAction =
  | { type: 'DRAW'; n?: number }
  | { type: 'SHUFFLE_LIBRARY' }
  /** Elixir of Immortality / Feldon's Cane style effect: moves every card
   *  currently in `zone` into the library and shuffles (same seeded RNG as
   *  SHUFFLE_LIBRARY). No-op if the zone is already empty. */
  | { type: 'SHUFFLE_ZONE_INTO_LIBRARY'; zone: 'graveyard' | 'exile' }
  | { type: 'MULLIGAN'; handSize?: number }
  | { type: 'MOVE_TO_ZONE'; cardId: string; to: Zone; toIndex?: number }
  /** Empty one zone into another, in the order the cards already sit in —
   *  or in a random one, which is what a move INTO the library means: a
   *  pile whose order the table watched must not become a known deck order.
   *  `random` shuffles only the moved block and advances the seed.
   *  `toIndex: 0` puts them on top of the destination, anything else (or
   *  nothing) under it. No-op when the source is empty or the two zones are
   *  the same. The battlefield is deliberately not a destination: N cards
   *  would all land on one point, and there is no sensible layout for it. */
  | { type: 'MOVE_ALL_TO'; from: Zone; to: Zone; toIndex?: number; random?: boolean }
  /** Take the top `n` off the library and put them in `to`, in order — mill
   *  and bulk-exile. `faceDown` only means anything for exile (it is what
   *  `faceDownExile` records) and is ignored anywhere else. No-op for n <= 0,
   *  an empty library, or a move back into the library. */
  | { type: 'MOVE_TOP_N'; n: number; to: Zone; faceDown?: boolean }
  /** Show the table the top of your library, all of it, or none of it. See
   *  `PlaytestState.libraryReveal`. */
  | { type: 'SET_LIBRARY_REVEAL'; reveal: LibraryReveal }
  /** Show the table the card on top of your library, once. Changes nothing —
   *  it is an event, not a state: the log line naming the card IS the whole
   *  effect, and it rides the public ticker out to the table. Distinct from
   *  `SET_LIBRARY_REVEAL`, which is the standing "play with it face up". */
  | { type: 'REVEAL_TOP_CARD' }
  | {
      /** Resolve a look-at-the-top-N. Ids not currently in the library — and
       *  repeats across the three lists — are ignored; `top` keeps cards on
       *  top in the given order, `bottom` puts them under the library in the
       *  given order, `graveyard` mills them, `hand` draws them (Impulse, Dig
       *  Through Time). Cards in the peeked window that
       *  appear in none of the lists simply stay where they were. `mode` is
       *  carried for the game log only — the reducer treats all three the
       *  same way. `shuffle` shuffles the library after the cards are placed
       *  (Ponder's "you may shuffle"). */
      type: 'RESOLVE_TOP';
      mode: ScryMode;
      top: string[];
      bottom?: string[];
      graveyard?: string[];
      hand?: string[];
      shuffle?: boolean;
    }
  | {
      type: 'MOVE_TO_BATTLEFIELD';
      cardId: string;
      x: number;
      y: number;
      tapped?: boolean;
      faceDown?: boolean;
    }
  | { type: 'MOVE_BF_POSITION'; cardId: string; x: number; y: number }
  /** Arranges the hand: moves one card to a position among the others. The
   *  order is yours alone — nobody else ever sees your hand — but it lives in
   *  the state so it survives a reload of the session. */
  | { type: 'REORDER_HAND'; cardId: string; toIndex: number }
  | { type: 'TAP'; cardId: string; tapped?: boolean }
  | { type: 'UNTAP_ALL' }
  | { type: 'SET_COUNTER'; cardId: string; counter: string; delta: number }
  /** Step every counter already on a permanent at once — the bulk form of
   *  SET_COUNTER, for the boards where a dozen chargers or chapters move
   *  together. Never CREATES a counter kind: a card with none is untouched,
   *  because "add one to every counter" has no answer on a card with no
   *  counters. Floors at zero and drops a kind that reaches it, same as
   *  SET_COUNTER. */
  | { type: 'ADJUST_ALL_COUNTERS'; cardId: string; op: 'inc' | 'dec' | 'double' | 'clear' }
  /** Adjust the running power/toughness modifier on a permanent (see
   *  `BattlefieldCard.pt`). Deltas, not absolutes; a modifier back at 0/0
   *  is removed rather than stored. */
  | { type: 'ADJUST_PT'; cardId: string; power?: number; toughness?: number }
  | { type: 'ADD_STICKER'; cardId: string; text: string }
  | { type: 'REMOVE_STICKER'; cardId: string; index: number }
  | { type: 'CREATE_TOKEN'; card: PlaytestCard; x: number; y: number }
  | {
      /** Token-copy one or more battlefield cards (the Ctrl+C / Ctrl+V group
       *  clone, and the context menu's Duplicate). Copies are tokens — MTG
       *  rule 707.2 — so they cease to exist when they leave the battlefield,
       *  which `MOVE_TO_ZONE` already handles.
       *
       *  Only printed characteristics are copied: counters, stickers, tapped
       *  and face-down state are not (rule 707.2 again — a copy has none of
       *  the original's non-copiable state). Each clone lands at its source's
       *  position plus a cascading offset so a pasted group never hides
       *  underneath the originals.
       *
       *  The caller supplies the new instance ids so the reducer stays pure;
       *  sources that aren't on the battlefield are skipped. */
      type: 'CLONE_BF_CARDS';
      clones: Array<{ sourceId: string; id: string }>;
    }
  | {
      /** Attach `cardId` to the battlefield permanent `targetId`, or detach it
       *  entirely with `targetId: null`. Rejected (no-op) if either card isn't
       *  on the battlefield, if a card is attached to itself, or if the link
       *  would close a cycle — an unreachable pair of mutually-attached cards
       *  is worse than no attachment at all. Legality is NOT checked: you can
       *  attach anything to anything, exactly as you could physically lay one
       *  card across another. */
      type: 'ATTACH';
      cardId: string;
      targetId: string | null;
    }
  /** Show or stop showing a card in your hand to the table (see
   *  `PlaytestState.revealed`). No-op for a card that isn't in hand. */
  | { type: 'TOGGLE_REVEAL'; cardId: string }
  /** Mark a battlefield permanent as waiting to resolve. No-op for a card
   *  that isn't on the battlefield or is already marked — the card does not
   *  move, so there is nothing to do twice. */
  | { type: 'PUT_ON_STACK'; cardId: string }
  /** Take a card off the stack (the top one when `cardId` is omitted). The
   *  permanent stays exactly where it is, because it was never anywhere
   *  else — except an instant or sorcery, which has finished doing its job
   *  and goes to the graveyard. */
  | { type: 'RESOLVE_STACK'; cardId?: string }
  | { type: 'FLIP_FACE'; cardId: string }
  | { type: 'TRANSFORM'; cardId: string }
  | { type: 'TOGGLE_PHASED'; cardId: string }
  /** Adjust one color's floating mana by `delta`. Floors at zero — same
   *  "healing out means none, not a debt" rule as SET_PLAYER_COUNTER. */
  | { type: 'ADJUST_MANA'; color: ManaColor; delta: number }
  /** Manual "spend it all down" — see the NEXT_TURN comment in reducer.ts for
   *  why this exists alongside the automatic per-turn empty. */
  | { type: 'EMPTY_MANA_POOL' }
  | {
      /** Cosmetic-only art arriving after the fact (async token-art
       *  resolution) — not a player action, so the reducer never pushes it
       *  onto the undo stack. */
      type: 'SET_CARD_IMAGE';
      cardId: string;
      imageUrl: string;
    }
  | { type: 'NEXT_TURN' }
  | { type: 'RESET' }
  | { type: 'UNDO' }
  | { type: 'ADJUST_LIFE'; delta: number }
  /** Adjust a player-scoped counter (poison/energy/experience/…). Mirrors
   *  `SET_COUNTER`'s shape for permanents; floors at zero, and hitting zero
   *  removes the key rather than storing a 0. */
  | { type: 'SET_PLAYER_COUNTER'; counter: string; delta: number }
  /** Claim/clear a table designation. City's Blessing is one-way in the UI
   *  (only ever dispatched with `held: true`) but the reducer itself doesn't
   *  enforce that — see `Designation`. */
  | { type: 'SET_DESIGNATION'; designation: Designation; held: boolean };

export interface PlaytestInit {
  library: PlaytestCard[];
  command?: PlaytestCard[];
  seed?: number;
  openingHandSize?: number;
  /** Format-aware starting life — see `playtestLifeConfig`. Optional so
   *  existing callers (tests, ad-hoc inits) default to a 20-life game. */
  life?: number;
}
