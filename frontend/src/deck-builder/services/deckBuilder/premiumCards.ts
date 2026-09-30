/**
 * Premium cards: the ones Coach never offers as a cut.
 *
 * Every Coach cut surface (the optimizer's removals, the cardFit misfits, the
 * replace-when-full prompt) ranked candidates by this commander's EDHREC
 * inclusion, and protection came only from stamps generation writes
 * (`isGameChanger`, combo, synergy, lift). A hand-built or imported deck has
 * none of those stamps, and a premium card can have a low inclusion on one
 * commander's page, so Path to Exile read as "Excess Removal" and Fierce
 * Guardianship, The One Ring and Imperial Seal as misfits (T171 lane L).
 *
 * A card is premium when any of these holds, each read from data the card or
 * the analysis already carries:
 *  - a Game Changer, by name as well as by stamp (an imported deck has no stamp);
 *  - a staple mana rock (Sol Ring, Arcane Signet), by name;
 *  - a staple of this commander: on its EDHREC page at 40% or more;
 *  - a staple of the format: a spell among the 100 most played Commander
 *    cards (Scryfall's `edhrec_rank`);
 *  - a tutor the bracket estimator counts (tagger), at any cost;
 *  - an efficient answer or piece of protection, from the card facts: a
 *    tutor at 2 mana or less, a protection spell or equipment at 2 or less,
 *    an instant-speed removal spell or counterspell at 2 or less, any of
 *    these that can be cast for free (a pitch cost, or "if you control a
 *    commander, you may cast this spell without paying its mana cost"), or a
 *    board wipe at 4 or less.
 *
 * The card-facts rules need the snapshot loaded; without it they stay silent
 * and the other rules still hold.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { frontFaceName } from '@/lib/cards/card-text';
import { getCardFacts } from '@/deck-builder/services/cardFacts';
import { STAPLE_ROCK_NAMES } from './deckGeneration/phaseStapleManaRocks';
import { isTutor } from './bracketEstimator';

/** On this commander's EDHREC page at or above this share: a staple here. */
export const COMMANDER_STAPLE_INCLUSION = 40;
/** Scryfall `edhrec_rank` at or below this: a staple of the whole format. */
export const FORMAT_STAPLE_RANK = 100;
/** Mana value at or below which a tutor, answer or protection piece is efficient. */
const EFFICIENT_MV = 2;
/** A board wipe at or below this mana value is an efficient one (Supreme Verdict, Damnation). */
const EFFICIENT_WIPE_MV = 4;
/** An alternative cost that skips the mana: pitch spells, "if you control a commander". */
const FREE_CAST =
  /rather than pay (?:this spell's|its) mana cost|cast this spell without paying its mana cost/i;

export type PremiumReason =
  | 'game-changer'
  | 'staple-rock'
  | 'commander-staple'
  | 'format-staple'
  | 'tutor'
  | 'protection'
  | 'interaction';

export interface PremiumContext {
  /** EDHREC inclusion % on this commander's page, when the analysis has it. */
  inclusion?: number | null;
  /** The live Game Changers list, when fetched; the shared list is the floor. */
  gameChangerNames?: ReadonlySet<string>;
}

function oracleText(card: ScryfallCard): string {
  return card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '';
}

/** Whether `name` is a Game Changer, by exact or front-face name. */
export function isGameChangerName(name: string, extra?: ReadonlySet<string>): boolean {
  const front = frontFaceName(name);
  return (
    HARDCODED_GAME_CHANGERS.has(name) ||
    HARDCODED_GAME_CHANGERS.has(front) ||
    !!extra?.has(name) ||
    !!extra?.has(front)
  );
}

function factsReason(card: ScryfallCard): PremiumReason | null {
  const facts = getCardFacts(card);
  if (!facts) return null;
  const mv = facts.mv ?? card.cmc ?? 99;
  const cheap = mv <= EFFICIENT_MV;
  const free = FREE_CAST.test(oracleText(card)) || (mv === 0 && !facts.types.includes('land'));
  for (const r of facts.roles) {
    if (r.tier !== 'primary') continue;
    if (r.role === 'tutor' && cheap) return 'tutor';
    if (r.role === 'protection' && (cheap || free)) return 'protection';
    const instant = r.speed === 'instant' || r.speed === 'flash';
    if ((r.role === 'removal' || r.role === 'counterspell') && instant && (cheap || free)) {
      return 'interaction';
    }
    if (r.role === 'boardwipe' && mv <= EFFICIENT_WIPE_MV) return 'interaction';
  }
  return null;
}

/** Why `card` is premium, or null when it is an ordinary cut candidate. */
export function premiumReason(card: ScryfallCard, ctx: PremiumContext = {}): PremiumReason | null {
  if (card.isGameChanger || isGameChangerName(card.name, ctx.gameChangerNames))
    return 'game-changer';
  if (card.isStapleRock || STAPLE_ROCK_NAMES.has(frontFaceName(card.name))) return 'staple-rock';
  if ((ctx.inclusion ?? 0) >= COMMANDER_STAPLE_INCLUSION) return 'commander-staple';
  const land = /\bland\b/i.test(card.card_faces?.[0]?.type_line ?? card.type_line ?? '');
  // A land's play rank says it is cheap and common (Evolving Wilds is rank
  // 19), not that it is good here: the land engines judge lands on merit.
  if (!land && card.edhrec_rank != null && card.edhrec_rank <= FORMAT_STAPLE_RANK)
    return 'format-staple';
  // A tutor the bracket estimator counts (the tagger's reading) is premium at
  // any cost: Scheming Symmetry was cut from a Bracket 4 Yuriko (T171 re-gate).
  if (!land && isTutor(card.name)) return 'tutor';
  return factsReason(card);
}

export function isPremiumCard(card: ScryfallCard, ctx: PremiumContext = {}): boolean {
  return premiumReason(card, ctx) !== null;
}

/**
 * The deck's premium cards by name, for the cut engines that take a
 * protected-name set. `inclusionOf` reads this commander's page.
 */
export function premiumNames(
  cards: readonly ScryfallCard[],
  inclusionOf: (name: string) => number | undefined,
  gameChangerNames?: ReadonlySet<string>
): Set<string> {
  const out = new Set<string>();
  for (const card of cards) {
    if (isPremiumCard(card, { inclusion: inclusionOf(card.name), gameChangerNames }))
      out.add(card.name);
  }
  return out;
}
