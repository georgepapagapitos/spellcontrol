/**
 * The bracket side of the upgrade plan (E458), built once per deck state and
 * injected into `planUpgrades`: which cards raise the bracket, which are Game
 * Changers, and the Estimate with a plan applied.
 */
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import {
  estimateBracket,
  isFastMana,
  isMassLandDenialFloor,
  isStaxPiece,
  isTutor,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { isPowerSignal } from '@/deck-builder/services/deckBuilder/bracketFit';
import { getCardRole, isExtraTurn } from '@/deck-builder/services/tagger/client';
import { comboMatchesToDetected } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch, ComboMatchResponse } from '@/types/combos';
import type { Change } from './deck-change';
import { isBasicFetcher, isBasicName } from './upgrade-plan';

export interface UpgradePlanToolsInput {
  /** The mainboard, commanders excluded. */
  deckCards: ScryfallCard[];
  commanderNames: string[];
  combos: { inDeck: ComboMatch[]; oneAway: ComboMatch[] } | null | undefined;
  roleCounts: Record<string, number>;
  /** The deck's persisted Estimate: the number the Power tab shows. */
  estimate: number;
  /** The owner's stated bracket, when set. */
  stated: number | null | undefined;
  /** EDHREC play-rate per deck card (the deck's persisted cardInclusionMap). */
  cardInclusionMap?: Record<string, number>;
}

export interface UpgradePlanTools {
  estimate: number;
  /**
   * The bracket a plan holds and "Stay at" names: the stated one, unless the
   * list already estimates higher. A deck stated at 2 that reads 4 can't be
   * promised a 2 by adding cards.
   */
  current: number;
  gameChangersInDeck: number;
  isGameChanger: (name: string) => boolean;
  raisesBracket: (c: Change) => boolean;
  /** The Estimate with these adds and cuts applied. */
  estimateAfter: (addNames: string[], cutNames: string[]) => number;
  /**
   * The deck's weakest cards by play-rate, weakest first. The optimizer's own
   * cut list is deliberately short (a tuned deck has few clear cuts), which
   * left a budget plan with money and nowhere to put it; these come after it.
   */
  weakestCuts: Change[];
  /** Why a card moves the bracket, in the player's words ("Tutor"). */
  bracketReason: (c: Change) => string;
  /** Basic lands in the list, and lands in it that fetch a basic. */
  basics: number;
  fetchers: number;
}

const GAME_CHANGERS = new Set<string>(HARDCODED_GAME_CHANGERS);
/** Play-rate at or under which a card is a cut candidate. A precon's own new
 *  cards sit near 0; its staples run far above this. */
const WEAK_INCLUSION = 35;

export function buildUpgradePlanTools(input: UpgradePlanToolsInput): UpgradePlanTools {
  const { deckCards, commanderNames, combos, roleCounts } = input;
  const isGameChanger = (name: string) => GAME_CHANGERS.has(name);
  const nonLand = deckCards.filter((c) => !/\bLand\b/.test(c.type_line ?? ''));
  const averageCmc =
    nonLand.length > 0 ? nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length : 0;

  function raw(addNames: string[], cutNames: string[]): number {
    const names = deckCards.map((c) => c.name);
    for (const cut of cutNames) {
      const i = names.indexOf(cut);
      if (i >= 0) names.splice(i, 1);
    }
    names.push(...addNames);
    const present = new Set([...names, ...commanderNames]);
    // A combo counts when every piece is present: cuts break in-deck combos,
    // and an add can complete a one-away combo.
    const live = [...(combos?.inDeck ?? []), ...(combos?.oneAway ?? [])].filter((m) =>
      m.combo.cards.every((c) => present.has(c.cardName))
    );
    const detected = comboMatchesToDetected(
      { inDeck: live } as unknown as ComboMatchResponse,
      deckCards
    );
    return estimateBracket(
      [...names, ...commanderNames],
      detected,
      averageCmc,
      undefined,
      roleCounts,
      GAME_CHANGERS,
      commanderNames
    ).bracket;
  }

  // Never a combo piece or a basic; the planner's role floor covers the rest.
  const comboPieces = new Set(
    (combos?.inDeck ?? []).flatMap((m) => m.combo.cards.map((c) => c.cardName))
  );
  const inclusion = input.cardInclusionMap ?? {};
  const weakestCuts: Change[] = deckCards
    .filter(
      (c) =>
        !/\bBasic\b/.test(c.type_line ?? '') &&
        !comboPieces.has(c.name) &&
        (inclusion[c.name] ?? 0) <= WEAK_INCLUSION
    )
    .sort((a, b) => (inclusion[a.name] ?? 0) - (inclusion[b.name] ?? 0))
    .map((c) => ({
      id: `plan:cut:${c.name}`,
      type: 'cut',
      lane: 'upgrade',
      name: c.name,
      role: getCardRole(c.name) ?? undefined,
      typeLine: c.type_line,
      inclusion: inclusion[c.name],
    }));

  // Report the change against the persisted Estimate, so "before" is the
  // number the Power tab shows even where this recompute's inputs differ.
  const base = raw([], []);
  return {
    estimate: input.estimate,
    current: Math.max(input.stated ?? 0, input.estimate),
    gameChangersInDeck: [...deckCards.map((c) => c.name), ...commanderNames].filter(isGameChanger)
      .length,
    isGameChanger,
    raisesBracket: (c) =>
      c.isGameChanger === true || c.lane === 'combos' || isPowerSignal(c.name, GAME_CHANGERS),
    weakestCuts,
    bracketReason: (c) =>
      c.isGameChanger || isGameChanger(c.name)
        ? 'Game Changer'
        : c.lane === 'combos'
          ? 'Completes a combo'
          : isTutor(c.name)
            ? 'Tutor'
            : isFastMana(c.name)
              ? 'Fast mana'
              : isExtraTurn(c.name)
                ? 'Extra turns'
                : isMassLandDenialFloor(c.name)
                  ? 'Mass land denial'
                  : isStaxPiece(c.name)
                    ? 'Stax'
                    : 'Raises the bracket',
    basics: deckCards.filter((c) => isBasicName(c.name)).length,
    fetchers: deckCards.filter((c) =>
      isBasicFetcher({ id: c.name, type: 'add', lane: 'lands', name: c.name, card: c })
    ).length,
    estimateAfter: (addNames, cutNames) =>
      Math.min(5, Math.max(1, input.estimate + raw(addNames, cutNames) - base)),
  };
}
