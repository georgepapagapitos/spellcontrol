/**
 * The bracket side of the upgrade plan (E458), built once per deck state and
 * injected into `planUpgrades`: which cards raise the bracket, which are Game
 * Changers, and the Estimate with a plan applied.
 */
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { estimateBracket } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { isPowerSignal } from '@/deck-builder/services/deckBuilder/bracketFit';
import { comboMatchesToDetected } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch, ComboMatchResponse } from '@/types/combos';
import type { Change } from './deck-change';

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
}

export interface UpgradePlanTools {
  estimate: number;
  /** The bracket "Stay at" names: the stated one, else the Estimate. */
  current: number;
  gameChangersInDeck: number;
  isGameChanger: (name: string) => boolean;
  raisesBracket: (c: Change) => boolean;
  /** The Estimate with these adds and cuts applied. */
  estimateAfter: (addNames: string[], cutNames: string[]) => number;
}

const GAME_CHANGERS = new Set<string>(HARDCODED_GAME_CHANGERS);

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

  // Report the change against the persisted Estimate, so "before" is the
  // number the Power tab shows even where this recompute's inputs differ.
  const base = raw([], []);
  return {
    estimate: input.estimate,
    current: input.stated ?? input.estimate,
    gameChangersInDeck: [...deckCards.map((c) => c.name), ...commanderNames].filter(isGameChanger)
      .length,
    isGameChanger,
    raisesBracket: (c) =>
      c.isGameChanger === true || c.lane === 'combos' || isPowerSignal(c.name, GAME_CHANGERS),
    estimateAfter: (addNames, cutNames) =>
      Math.min(5, Math.max(1, input.estimate + raw(addNames, cutNames) - base)),
  };
}
