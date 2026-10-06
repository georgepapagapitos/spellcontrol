/**
 * Coach's cut protections, as ONE set (E540 S3).
 *
 * Every Coach path that cuts a card (the optimizer's excess cuts, the cardFit
 * misfits, the replace-when-full prompt and its overlap and combo cuts, the
 * budget downgrades) used to keep its own list of what it never touches, and
 * the lists drifted: the excess cutter kept engine pieces but not finishers,
 * the misfit pass kept neither, the replace prompt kept finishers only when
 * they were unflagged. A rule that guarantees something ("every combo gets a
 * cut") then reopened every hole the other paths had closed (T171 v4b, 46/1/3
 * to 30/5/8). This is the one set they all read, and the one the whole-deck
 * objective reads for a saved deck: `buildCoachObjective` hands it to the
 * context's `extraProtections`, so `judgeMove` refuses the same cuts the
 * paths do (deckObjective/protections.ts).
 *
 * A card is held when it is:
 *  - premium (premiumCards.ts): a Game Changer, a staple rock, a 40% staple
 *    of this commander, a format staple, a tutor, efficient interaction;
 *  - on the commander's plan: it feeds the commander's own abilities
 *    (`whyCardMatches`);
 *  - an engine piece: load-bearing for an axis the deck is invested in;
 *  - a finisher: the card facts' counted finisher, or an alt-win card;
 *  - a survival piece: protection that keeps the deck's permanents, its
 *    commander included;
 *  - one Coach would suggest straight back: a staple the analysis still lists
 *    as missing (just added), or an unflagged card played here at least as
 *    much as the least-played missing staple.
 *
 * Two classes carry an `exempt` rule, because a card that does the same job
 * is a like-for-like swap rather than a loss: a commander-plan card may leave
 * for one that feeds the commander, an engine piece for one on its own axis.
 * Nothing else has an exemption, and a path with no incoming card of that
 * kind (a combo completion) offers neither.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { countsAsFinisher, getCardFacts } from '@/deck-builder/services/cardFacts';
import {
  premiumReason,
  type PremiumReason,
} from '@/deck-builder/services/deckBuilder/premiumCards';
import {
  buildCommanderProfile,
  whyCardMatches,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { isSurvivalPiece } from '@/deck-builder/services/deckBuilder/deckObjective/factsReading';
import type { Protection } from '@/deck-builder/services/deckBuilder/deckObjective/types';
import { isLoadBearing, type DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { axisKeys, sharedAxisNames } from './axis-overlap';

export interface CoachProtectionInputs {
  /** The commander(s): their abilities mark the plan, and survival pieces must reach them. */
  commanders: readonly ScryfallCard[];
  /** The axes the deck is invested in (`DeckSynergy.invested`). */
  invested: DeckSynergy['invested'];
  /** The card's play rate on this commander's page, when it has one. */
  inclusionOf: (name: string) => number | undefined;
  /** The live Game Changers list; the shared list is the floor. */
  gameChangerNames?: ReadonlySet<string>;
  /** Cards the deck's win paths name as its alt win. */
  altWinNames?: ReadonlySet<string>;
  /**
   * The staples the analysis lists as missing, with their play rate. Present
   * only for a deck whose analysis already ran: Coach would suggest the card
   * back if it were cut.
   */
  gaps?: readonly { name: string; inclusion: number }[];
  /** Lowercased names of the cards Coach already flags as weak: they are not held by the missing-staple floor. */
  flagged?: ReadonlySet<string>;
}

/**
 * The play rate of the least-played staple the analysis lists as missing: a
 * card played here at least that much would join the list the moment it's
 * cut, and Coach would suggest adding it straight back. A 0% row (an off-meta
 * pick) isn't listed for its play rate, so it sets no floor. Undefined when
 * the list has no played staple.
 */
export function missingStapleFloor(
  gaps: readonly { inclusion: number }[] | undefined
): number | undefined {
  const played = (gaps ?? []).map((g) => g.inclusion).filter((i) => i > 0);
  return played.length > 0 ? Math.min(...played) : undefined;
}

/** Whether a card played here at `played`% would head the missing staples if it were cut. */
export function wouldBeSuggestedBack(
  played: number | undefined,
  gaps: readonly { inclusion: number }[] | undefined
): boolean {
  const floor = missingStapleFloor(gaps);
  return floor !== undefined && played !== undefined && played >= floor;
}

const PREMIUM_WHY: Record<PremiumReason, string> = {
  'game-changer': 'a Game Changer',
  'staple-rock': 'a staple mana rock',
  'commander-staple': "a staple of this commander's decks",
  'format-staple': 'a staple of the format',
  tutor: 'a tutor',
  protection: 'a protection piece',
  interaction: 'efficient interaction',
};

type Exempt = (incoming: ScryfallCard) => boolean;

const nameKey = (name: string): string => frontFaceName(name).toLowerCase();

/** What holds a card in the deck, or null: the set every Coach cut path reads. */
export type CoachProtection = (card: ScryfallCard) => Protection | null;

/** Build the protection set once per deck; the answer for a card is cached by name. */
export function createCoachProtections(inputs: CoachProtectionInputs): CoachProtection {
  const profile =
    inputs.commanders.length > 0
      ? buildCommanderProfile(inputs.commanders[0], inputs.commanders[1])
      : null;
  const feedsCommander = (card: ScryfallCard): boolean =>
    !!profile && whyCardMatches(card, profile).length > 0;
  const deck = { invested: inputs.invested };
  const justAdded = new Set((inputs.gaps ?? []).map((g) => nameKey(g.name)));
  const cache = new Map<string, Protection | null>();

  const read = (card: ScryfallCard): Protection | null => {
    const played = inputs.inclusionOf(card.name);
    const premium = premiumReason(card, {
      inclusion: played,
      gameChangerNames: inputs.gameChangerNames,
    });
    if (premium) return { cls: 'premium', why: PREMIUM_WHY[premium] };

    // Held unless the incoming card does the same job. A card can be both: it
    // leaves only for one that is an exempt swap for every reason it is held.
    const soft: Array<{ cls: 'commander plan' | 'engine piece'; why: string; exempt: Exempt }> = [];
    if (feedsCommander(card)) {
      soft.push({
        cls: 'commander plan',
        why: "on the commander's plan, since it feeds the commander's own abilities",
        exempt: feedsCommander,
      });
    }
    if (isLoadBearing(card, deck)) {
      const own = axisKeys(card);
      soft.push({
        cls: 'engine piece',
        why: 'an engine piece the deck is built on',
        exempt: (incoming) => sharedAxisNames(axisKeys(incoming), own).length > 0,
      });
    }

    const facts = getCardFacts(card);
    if (inputs.altWinNames?.has(card.name) || (facts && countsAsFinisher(facts))) {
      return { cls: 'finisher', why: 'what the deck wins with' };
    }
    if (facts && isSurvivalPiece(card, facts, inputs.commanders)) {
      return {
        cls: 'survival piece',
        why: "a survival piece that keeps the deck's permanents alive",
      };
    }

    if (justAdded.has(nameKey(card.name))) {
      return { cls: 'suggested back', why: 'just added, and cutting it undoes that' };
    }
    if (
      wouldBeSuggestedBack(played, inputs.gaps) &&
      !inputs.flagged?.has(card.name.toLowerCase())
    ) {
      return { cls: 'suggested back', why: 'a card Coach would suggest adding straight back' };
    }
    if (soft.length > 0) {
      return {
        cls: soft[0].cls,
        why: soft[0].why,
        exempt: (incoming) => soft.every((s) => s.exempt(incoming)),
      };
    }
    return null;
  };

  return (card) => {
    if (cache.has(card.name)) return cache.get(card.name)!;
    const p = read(card);
    cache.set(card.name, p);
    return p;
  };
}
