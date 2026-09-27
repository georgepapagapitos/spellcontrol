import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { buildUpgradePlanTools, type UpgradePlanToolsInput } from './upgrade-plan-tools';
import type { Change } from './deck-change';

const card = (name: string, type_line = 'Creature', cmc = 3): ScryfallCard =>
  ({ id: name, name, type_line, cmc }) as unknown as ScryfallCard;
const add = (name: string, extra: Partial<Change> = {}): Change => ({
  id: name,
  type: 'add',
  lane: 'fill-gaps',
  name,
  ...extra,
});

function input(over: Partial<UpgradePlanToolsInput> = {}): UpgradePlanToolsInput {
  return {
    deckCards: [
      card('Island', 'Basic Land — Island', 0),
      card('Grizzly Bears'),
      card('Hill Giant'),
    ],
    commanderNames: ['Zimone, Mystery Unraveler'],
    combos: null,
    roleCounts: {},
    estimate: 2,
    stated: null,
    ...over,
  };
}

describe('buildUpgradePlanTools', () => {
  it('names the stated bracket when one is set, else the Estimate', () => {
    expect(buildUpgradePlanTools(input()).current).toBe(2);
    expect(buildUpgradePlanTools(input({ stated: 1 })).current).toBe(1);
  });

  it('counts Game Changers already in the list', () => {
    const tools = buildUpgradePlanTools(
      input({ deckCards: [card('Rhystic Study'), card('Island')] })
    );
    expect(tools.gameChangersInDeck).toBe(1);
    expect(tools.isGameChanger('Cyclonic Rift')).toBe(true);
    expect(tools.isGameChanger('Grizzly Bears')).toBe(false);
  });

  it('treats Game Changers and combo completions as bracket raisers', () => {
    const tools = buildUpgradePlanTools(input());
    expect(tools.raisesBracket(add('Cyclonic Rift'))).toBe(true);
    expect(tools.raisesBracket(add('Anything', { isGameChanger: true }))).toBe(true);
    expect(tools.raisesBracket(add('Kiki-Jiki', { lane: 'combos' }))).toBe(true);
    expect(tools.raisesBracket(add('Grizzly Bears'))).toBe(false);
  });

  it('reports the Estimate a plan leaves, relative to the persisted one', () => {
    const tools = buildUpgradePlanTools(input());
    expect(tools.estimateAfter([], [])).toBe(2);
    expect(tools.estimateAfter(['Grizzly Bears'], ['Hill Giant'])).toBe(2);
    expect(tools.estimateAfter(['Cyclonic Rift'], ['Hill Giant'])).toBe(3);
  });

  it('sees a combo the plan completes', () => {
    const match = {
      combo: {
        id: 'c1',
        cards: [
          { cardName: 'Grizzly Bears', oracleId: 'a' },
          { cardName: 'Kiki', oracleId: 'b' },
        ],
        produces: ['Infinite damage'],
        popularity: 1,
        bracket: 4,
        bracketTag: 'R',
        cardCount: 2,
        templateQueries: [],
      },
      missingOracleIds: ['b'],
    } as unknown as ComboMatch;
    const tools = buildUpgradePlanTools(input({ combos: { inDeck: [], oneAway: [match] } }));
    expect(tools.estimateAfter(['Kiki'], ['Hill Giant'])).toBeGreaterThan(2);
    expect(tools.estimateAfter(['Kiki'], ['Grizzly Bears'])).toBe(2);
  });
});
