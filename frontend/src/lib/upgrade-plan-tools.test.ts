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
  it('holds the stated bracket, unless the list already estimates higher', () => {
    expect(buildUpgradePlanTools(input()).current).toBe(2);
    expect(buildUpgradePlanTools(input({ stated: 3 })).current).toBe(3);
    expect(buildUpgradePlanTools(input({ stated: 2, estimate: 4 })).current).toBe(4);
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

  it('offers the weakest cards as cuts, never a basic or a combo piece', () => {
    const match = {
      combo: {
        id: 'c',
        cards: [{ cardName: 'Hill Giant', oracleId: 'h' }],
        produces: [],
        templateQueries: [],
      },
      missingOracleIds: [],
    } as unknown as ComboMatch;
    const tools = buildUpgradePlanTools(
      input({
        deckCards: [
          card('Island', 'Basic Land — Island', 0),
          card('Grizzly Bears'),
          card('Hill Giant'),
          card('Staple'),
          card('Tapland', 'Land', 0),
        ],
        combos: { inDeck: [match], oneAway: [] },
        cardInclusionMap: { 'Grizzly Bears': 20, Staple: 80, Tapland: 5, 'Hill Giant': 0 },
      })
    );
    expect(tools.weakestCuts.map((c) => c.name)).toEqual(['Tapland', 'Grizzly Bears']);
    expect(tools.weakestCuts[0]).toMatchObject({ type: 'cut', typeLine: 'Land', inclusion: 5 });
  });

  it('names why a card moves the bracket', () => {
    const tools = buildUpgradePlanTools(input());
    expect(tools.bracketReason(add('Cyclonic Rift'))).toBe('Game Changer');
    expect(tools.bracketReason(add('Kiki-Jiki', { lane: 'combos' }))).toBe('Completes a combo');
    expect(tools.bracketReason(add('Grizzly Bears'))).toBe('Raises the bracket');
  });

  it('counts the basics and the lands that fetch them', () => {
    const tools = buildUpgradePlanTools(
      input({
        deckCards: [
          card('Island', 'Basic Land — Island', 0),
          card('Forest', 'Basic Land — Forest', 0),
          card('Evolving Wilds', 'Land', 0),
          card('Grizzly Bears'),
        ],
      })
    );
    expect(tools.basics).toBe(2);
    expect(tools.fetchers).toBe(1);
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
