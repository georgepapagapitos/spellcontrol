/**
 * Types for the goldfish manabase simulator. See `./index.ts` for the model,
 * its assumptions and the API contract.
 */

import type { SimCard } from './opening-hand-sim';

/**
 * A set of mana types as bits: W U B R G, then C for colourless-specific mana
 * ({C} costs and the {C} a Wastes or Sol Ring makes). A land that taps for
 * {W} or {U} is `W | U`; a hybrid {W/U} pip is `W | U` too.
 */
export type ManaMask = number;

export const MANA_W = 1;
export const MANA_U = 2;
export const MANA_B = 4;
export const MANA_R = 8;
export const MANA_G = 16;
export const MANA_C = 32;
/** Every colour (a Treasure, Birds of Paradise). Not {C}. */
export const ANY_COLOR = 31;
/** Every mana type, colourless included. */
export const ALL_MANA = 63;

/** The mana symbols a mask is built from, in bit order. */
export const MANA_SYMBOLS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaSymbol = (typeof MANA_SYMBOLS)[number];

/** One Hall's-theorem condition of a cost: at least `need` units must be able to make a mana in `mask`. */
export interface CostCheck {
  mask: ManaMask;
  need: number;
}

/** A castable face's mana cost, reduced to what paying it requires. */
export interface ManaCost {
  /** The printed cost, `{2}{W}{W}`. */
  text: string;
  /** Mana value of this face, X counted as 0. */
  mv: number;
  /** Generic mana (numbers, snow), payable by any unit. */
  generic: number;
  /** One entry per coloured or {C} pip: the mask of mana that can pay it. */
  pips: readonly ManaMask[];
  /** Units needed to pay the cost: `generic + pips.length` (Phyrexian pips are paid with life). */
  units: number;
  /** Every union of the pips' masks with the pips it must cover, for the Hall check. */
  checks: readonly CostCheck[];
  /** Canonical identity of the cost: two cards with the same key are equally castable. */
  key: string;
}

/**
 * How a land enters. Every conditional wording the simulator recognises has its
 * own kind; an `unless` clause it does not recognise is `conditional` and is
 * treated as tapped (the conservative reading).
 */
export type LandEntry =
  | { kind: 'untapped' }
  | { kind: 'tapped' }
  /** "you may pay 2 life. If you don't, it enters tapped": a goldfish always pays. */
  | { kind: 'shock' }
  /** "unless you control a Plains or an Island" (check lands, castles). */
  | { kind: 'check'; types: ManaMask }
  /** "unless you control two or fewer other lands". */
  | { kind: 'fast' }
  /** "unless you control two or more other lands". */
  | { kind: 'slow' }
  /** "unless you control two or more basic lands". */
  | { kind: 'basics'; count: number }
  /** "unless you have two or more opponents": untapped in multiplayer. */
  | { kind: 'bond' }
  /** "you may reveal a Plains or Island card from your hand" (snarls). */
  | { kind: 'reveal'; types: ManaMask }
  /** "unless you control a legendary creature". */
  | { kind: 'legendary' }
  | { kind: 'conditional' };

/** A library search that puts lands onto the battlefield (a fetch land, Cultivate). */
export interface LandSearch {
  /** Only basic lands qualify ("basic land card", "basic Forest card"). */
  basicOnly: boolean;
  /** Basic land types that qualify, as colour bits (Plains = W). ANY_COLOR for "basic land card". */
  types: ManaMask;
  /** Lands put onto the battlefield. */
  count: number;
  /** Further lands put into the hand (Cultivate, Kodama's Reach). */
  toHand: number;
  /** "put it onto the battlefield tapped". */
  tapped: boolean;
  /** Fabled Passage: the land untaps if you control this many lands. 0 = never. */
  untapAtLands: number;
}

/** Choose-on-entry production: Thriving lands, Pathways, Coldsteel Heart. */
export interface ManaChoice {
  /** Always produced (Thriving Isle's {U}). */
  fixed: ManaMask;
  /** The colours one may be chosen from. */
  options: ManaMask;
}

/** The playable land side of a card: a land, or the back of a spell//land MDFC. */
export interface LandFace {
  /** One entry per mana the land makes when tapped (Ancient Tomb: `[C, C]`). Empty for a land that makes none. */
  units: readonly ManaMask[];
  entry: LandEntry;
  /** Basic land types on its type line, as colour bits. */
  types: ManaMask;
  /** Has the Basic supertype. */
  basic: boolean;
  /** A fetch land: sacrificed on entry for the searched land(s). */
  fetch: LandSearch | null;
  /** Karoo: returns a land you control to hand on entry. */
  bounce: boolean;
  /** Its mana ability needs this many lands in play (Temple of the False God: 5). 0 = none. */
  minLands: number;
  choice: ManaChoice | null;
}

/** What casting a nonland card does to the mana supply. */
export type RampEffect =
  /** A mana rock or dork. `delay` 1 = usable from next turn (summoning sick, enters tapped). */
  | {
      kind: 'source';
      units: readonly ManaMask[];
      delay: 0 | 1;
      /** Doesn't untap (Mana Vault): its units are spent once. */
      oneShot: boolean;
      choice: ManaChoice | null;
    }
  /** Puts lands from the library onto the battlefield (Cultivate, Wood Elves). */
  | { kind: 'search'; search: LandSearch; sacrificeLand: boolean }
  /** Makes Treasures once (Big Score). */
  | { kind: 'treasure'; count: number };

/** A card reduced to what the simulator reads. Built once by `classifyManaCard`. */
export interface ManaCard {
  name: string;
  /** Front face is a land (a land drop, never cast). */
  landCard: boolean;
  /** The land it can be played as (front land, or MDFC back). */
  land: LandFace | null;
  /** Spell front with a land back: played as whichever the turn needs. */
  mdfc: boolean;
  /** Cost of the castable front face; null for lands and cards with no mana cost. */
  cost: ManaCost | null;
  ramp: RampEffect | null;
  /** Legendary creature (turns on "unless you control a legendary creature"). */
  legendaryCreature: boolean;
  /** The reduction `isKeepableHand` reads, so the keep rule matches the app's panels. */
  sim: SimCard;
}

/** A deck ready to simulate. Build with `buildManaDeck` or `compileManaDeck`. */
export interface ManaDeck {
  /** The command zone, in canonical (name) order. */
  commanders: readonly ManaCard[];
  /** The library in canonical (name) order, so input order never moves a result. */
  library: readonly ManaCard[];
}

export interface ManaSimOptions {
  /** Games to simulate. Default 1000. */
  games?: number;
  /** PRNG seed. Default: derived from the card names, so the same list always gives the same numbers. */
  seed?: number;
  /** Last turn simulated. Default 10. Castability is measured for mana values up to this turn. */
  maxTurn?: number;
  /**
   * Keep rule. `app` (default) keeps by `isKeepableHand`, the rule the deck
   * view's test hand and the playtest sheet use. `karsten` is Frank Karsten's
   * land-count rule from his 2022 colour-source article, for reproducing his
   * tables.
   */
  mulligan?: 'app' | 'karsten';
  /** The first mulligan is free (CR 103.4c, multiplayer). Default true. */
  freeMulligan?: boolean;
  /** Counted mulligans allowed after the free one. Default 2 (`app`) or 3 (`karsten`, down to four cards). */
  mulliganDepth?: number;
  /** The starting player draws on turn 1 (CR 800.7, multiplayer). Default true. */
  drawOnTurnOne?: boolean;
  /** Opponents at the table (bond lands). Default 3. */
  opponents?: number;
}

/** Castability of one cost across the simulated games. Rates are 0–1; null when never measurable. */
export interface CastRates {
  /** P(castable on the turn equal to its mana value). */
  onCurve: number | null;
  /**
   * P(castable on curve | the mana amount was there). Only colour can fail
   * this: the Karsten measure, with ramp counted as mana.
   */
  onCurveGivenMana: number | null;
  /** P(castable by the turn after). */
  nextTurn: number | null;
  nextTurnGivenMana: number | null;
  /**
   * Per mana type, the share of on-curve games with enough mana where that
   * type was short. A two-colour shortfall blames both.
   */
  shortBy: Partial<Record<ManaSymbol, number>>;
}

export interface CardCastability extends CastRates {
  name: string;
  mv: number;
  cost: string;
  /** Copies in the library. */
  copies: number;
  /** Karsten's bar for this mana value: (89 + mv)%, mv clamped to 1–7. */
  karstenBar: number;
}

export interface ManaSimResult {
  games: number;
  seed: number;
  maxTurn: number;
  mulligan: {
    /** Share of games whose first seven was kept. */
    keepRate7: number;
    /** Mean size of the hand kept. */
    avgKeptSize: number;
    /** Share of games by kept hand size. */
    keptSizeShare: Record<number, number>;
  };
  landDrops: {
    /** Index = turn (0 unused): share of games that played a land from hand that turn. */
    hitRate: number[];
    /** Index = turn: share of games that had made every land drop through that turn. */
    onCurveRate: number[];
    /** Index = turn: mean lands on the battlefield at end of turn, ramped lands included. */
    avgLandsInPlay: number[];
  };
  /** Missed land drops: fewer than 3 lands played by the end of turn 3, fewer than 4 by turn 4. */
  screw: { missedDropBy3: number; missedDropBy4: number };
  /**
   * Flood, measured at the end of turn 6: `surplusLands` = at least two land
   * cards stuck in hand (drawn beyond the six drops); `rate` = that AND no
   * nonland card left in hand, so the extra mana has nothing to buy.
   */
  flood: { rate: number; surplusLands: number };
  mana: {
    /** Index = turn: mean mana available after the land drop (lands, rocks, dorks, Treasures). */
    average: number[];
    /** Index = turn: share of games with at least `turn` mana available that turn. */
    atLeastTurn: number[];
  };
  /** Deck-level castability: the per-card rates averaged over nonland spells, each copy weighing one. */
  castability: {
    onCurve: number | null;
    onCurveGivenMana: number | null;
    nextTurn: number | null;
    nextTurnGivenMana: number | null;
    /** Nonland spells with a measurable mana value (≤ maxTurn). */
    measured: number;
    /** Measured spells whose on-curve rate given the mana is below Karsten's (89 + mv)% bar. */
    belowKarstenBar: number;
  };
  commanders: CardCastability[];
  /** Every distinct nonland spell, hardest to cast on curve first. */
  cards: CardCastability[];
}
