/**
 * Types for the whole-deck objective (E513). See `./index.ts` for the design.
 */
import type {
  Customization,
  DetectedCombo,
  LiftEntry,
  Pacing,
  ScryfallCard,
} from '@/deck-builder/types';
import type { CardFacts } from '@/deck-builder/services/cardFacts';
import type { ManaCard } from '@/lib/mana-sim';

/** A deck as the objective reads it: the command zone and the 99. */
export interface ObjectiveDeck {
  /** The commander, partners, a commander and its Background. */
  commanders: readonly ScryfallCard[];
  /** Every other card, one entry per copy (basics repeat). */
  cards: readonly ScryfallCard[];
}

/** One EDHREC row of the page(s) the deck is built from. */
export interface EdhrecRow {
  /** Share of this page's decks that play the card, in percent (0-100). */
  inclusion: number;
  /** EDHREC synergy as a fraction: this page's rate minus its colours', / 100. */
  synergy?: number;
  /** Decks on this page that could play the card (the sample behind `inclusion`). */
  potential_decks?: number;
  num_decks?: number;
}

/** The deck roles with a target. Counterspells are NOT removal (E486). */
export const OBJECTIVE_ROLES = ['ramp', 'cardDraw', 'removal', 'boardwipe'] as const;
export type ObjectiveRole = (typeof OBJECTIVE_ROLES)[number];

/** Per-card lookups the objective needs, injected so the module stays pure. */
export interface ObjectiveTags {
  isExtraTurn(name: string): boolean;
  isMassLandDenial(name: string): boolean;
  isStaxPiece(name: string): boolean;
}

/** Everything a score depends on besides the deck itself. Build with `createObjectiveContext`. */
export interface ObjectiveContextInput {
  /** The deck's colour identity (the commanders'). */
  colorIdentity: readonly string[];
  /** What the deck was built under: constraints and a few preferences. */
  customization: Partial<Customization>;
  /**
   * EDHREC rows of the page(s) the deck is built from: the commander page, or
   * its theme/budget/bracket page, whichever the generator read. Keyed by the
   * EDHREC card name; deck cards are looked up with `getByCardName`, so a DFC
   * finds its front-face row.
   */
  edhrec: ReadonlyMap<string, EdhrecRow>;
  /** Role targets the deck is built toward (the generator's `roleTargets`). */
  roleTargets: Partial<Record<ObjectiveRole, number>>;
  /** The plan's pacing, fixed per context so the curve target never moves with the deck. */
  pacing?: Pacing;
  /**
   * Combos relevant to this commander (the matcher's output: complete and
   * near-miss). Only combos whose every card is named count; the rest are
   * templates the objective can't check.
   */
  combos?: readonly DetectedCombo[];
  /** E71 card-page lift pools, keyed by seed card name. A seed counts only while it is in the deck. */
  liftPools?: ReadonlyMap<string, readonly LiftEntry[]>;
  /**
   * EDHREC's global rank by card name (Scryfall `edhrec_rank`) for the PAGE's
   * cards: the off-page quality fallback reads an off-page card (which carries
   * its own `edhrec_rank`) against on-page cards of similar rank.
   */
  globalRank?: ReadonlyMap<string, number>;
  /** The user's owned card names, for owned-share constraints. */
  ownedNames?: ReadonlySet<string>;
  /** Game Changer names (bracket ceilings and the user's limit). */
  gameChangerNames?: ReadonlySet<string>;
  /** Tag lookups for the bracket ceilings. Omitted: no card reads as an extra turn, MLD or stax. */
  tags?: Partial<ObjectiveTags>;
  /**
   * Card facts for a card. Default: the loaded card-facts snapshot, falling
   * back to extracting them from the card's own oracle text.
   */
  factsOf?: (card: ScryfallCard) => CardFacts;
  /** Goldfish settings. Fixed seed = common random numbers across compared decks. */
  manaSim?: { games?: number; seed?: number };
  /**
   * A reference library order (card names, one per copy): the deck the
   * compared decks descend from (a gate's baseline, a search's seed). Each
   * scored deck's library is laid out in these slots, a swapped-in card
   * taking a vacated slot, so the goldfish plays the same shuffled positions
   * for both and a one-card swap moves only the games that card changes.
   * Omitted: name order, which is deterministic but shares no games.
   */
  slotOrder?: readonly string[];
  /** Term weight overrides (multipliers on DEFAULT_WEIGHTS). */
  weights?: Partial<Record<TermKey, number>>;
}

/** A read of one card on this context's page. */
export interface CardQuality {
  /** The card's quality prior in [0, 1] (an inclusion share). */
  q: number;
  /** Where q came from. */
  source: 'page' | 'off-page' | 'basic';
  /** EDHREC inclusion percent (on-page) or null. */
  inclusionPct: number | null;
  /** E510 synergy strength (on-page rows with synergy), or null. */
  strength: number | null;
  /** Human-readable reason. */
  note: string;
}

/** The context after derivation: caches and page statistics. */
export interface ObjectiveContext extends Omit<
  ObjectiveContextInput,
  'factsOf' | 'weights' | 'tags' | 'gameChangerNames'
> {
  factsOf: (card: ScryfallCard) => CardFacts;
  weights: Record<TermKey, number>;
  tags: ObjectiveTags;
  gameChangerNames: ReadonlySet<string>;
  /** Lowest inclusion on the page: absence from the page means below this. */
  pageFloorPct: number;
  /** Cached per-card quality read. */
  qualityOf: (card: ScryfallCard) => CardQuality;
  /** Cached mana-sim classification. */
  manaCardOf: (card: ScryfallCard) => ManaCard;
  /** Seed and games for the goldfish. */
  sim: { games: number; seed: number };
}

export const TERM_KEYS = [
  'quality',
  'signature',
  'roles',
  'interaction',
  'curve',
  'mana',
  'combos',
  'synergy',
  'lift',
  'nonbo',
  'winline',
  'ownership',
] as const;
export type TermKey = (typeof TERM_KEYS)[number];

/** A card a term names, with its share of the term's value and why. */
export interface CardNote {
  name: string;
  /** This card's signed share of the term's value (before the weight). */
  value: number;
  note: string;
}

export interface TermResult {
  /** The term's value in card-equivalents, before the weight. Higher is better. */
  value: number;
  weight: number;
  /** value × weight: the term's share of `total`. */
  contribution: number;
  detail: {
    /** One line on what the value is made of. */
    summary: string;
    /** The cards behind the value, largest |value| first. Never empty when value ≠ 0. */
    cards: CardNote[];
  };
}

export type ConstraintCheck =
  | 'size'
  | 'singleton'
  | 'identity'
  | 'dead-in-identity'
  | 'commander-in-99'
  | 'legality'
  | 'banned'
  | 'must-include'
  | 'max-price'
  | 'budget'
  | 'rarity'
  | 'tiny-leaders'
  | 'arena'
  | 'game-changers'
  | 'bracket-ceiling'
  | 'collection'
  | 'owned-share';

/** A broken hard constraint. `magnitude` counts how far (cards, or currency for budget). */
export interface ConstraintViolation {
  check: ConstraintCheck;
  magnitude: number;
  cards: string[];
  detail: string;
}

export interface ObjectiveScore {
  /** Σ contributions. Only comparable between decks scored under the same context. */
  total: number;
  terms: Record<TermKey, TermResult>;
  /** Hard constraints, kept out of `total`: a deck that breaks one is infeasible. */
  violations: ConstraintViolation[];
  feasible: boolean;
}
