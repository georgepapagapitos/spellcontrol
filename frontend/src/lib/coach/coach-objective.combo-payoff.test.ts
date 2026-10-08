// @vitest-environment node
//
// Guard (E578): Coach's combos term (comboCredit 'wins') credited only lines
// whose results win. Staff of Domination + Priest of Titania lists infinite
// untap / mana / draw / lifegain, so a Lathril deck lost the credit for the line
// that wins through Lathril's own tap ability. The cards below carry their real
// Scryfall oracle text; their facts are extracted from it (no snapshot loaded).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { combosTerm } from '@/deck-builder/services/deckBuilder/deckObjective/terms/combos';
import { merenCtx } from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import { buildNextBestMoves } from '@/deck-builder/services/deckBuilder/nextBestMove';
import { deckComboPayoffs } from '@/deck-builder/services/winConditions/comboPayoffs';
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { coachCombos } from './coach-objective';
import { winningCombos } from './coach-changes';

const real = (name: string, type_line: string, oracle_text: string, extra = {}) =>
  ({ name, type_line, oracle_text, keywords: [], ...extra }) as unknown as ScryfallCard;

const LATHRIL = real(
  'Lathril, Blade of the Elves',
  'Legendary Creature — Elf Noble',
  'Menace\nWhenever Lathril, Blade of the Elves deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.',
  { power: '2', toughness: '3' }
);
const STAFF = real(
  'Staff of Domination',
  'Artifact',
  '{1}: Untap Staff of Domination.\n{2}, {T}: You gain 1 life.\n{3}, {T}: Untap target creature.\n{4}, {T}: Tap target creature.\n{5}, {T}: Draw a card.'
);
const PRIEST = real(
  'Priest of Titania',
  'Creature — Elf Druid',
  '{T}: Add {G} for each Elf on the battlefield.',
  { power: '1', toughness: '1' }
);
const GRIZZLY = real('Grizzly Bears', 'Creature — Bear', '', { power: '2', toughness: '2' });

const line: DetectedCombo = {
  comboId: 'staff-priest',
  cards: ['Staff of Domination', 'Priest of Titania'],
  results: [
    'Infinite untap of creatures you control',
    'Infinite mana',
    'Infinite card draw',
    'Infinite lifegain',
  ],
  isComplete: true,
  missingCards: [],
  deckCount: 2000,
  bracket: null,
  bracketTag: null,
  cardCount: 2,
};

beforeAll(() => {
  setCardFactsSnapshot(
    JSON.parse(readFileSync(join(__dirname, '../../../public/card-facts.json'), 'utf8'))
  );
});
afterAll(() => setCardFactsSnapshot(null));

const value = (commander: ScryfallCard) => {
  const ctx = merenCtx({ combos: [line], comboCredit: 'wins' });
  return combosTerm({ commanders: [commander], cards: [STAFF, PRIEST] }, ctx).value;
};

describe('Coach credits a loop the deck converts into a win', () => {
  it('Staff + Priest earns combo credit in a Lathril deck', () => {
    expect(value(LATHRIL)).toBeGreaterThan(0);
  });

  it('the same line earns nothing under a commander with no payoff', () => {
    expect(value(GRIZZLY)).toBe(0);
  });

  it('a one-away line counts as a Coach combo only with the payoff in the deck', () => {
    const resp = {
      inDeck: [],
      oneAway: [
        {
          combo: {
            id: 'x',
            produces: line.results,
            popularity: 2000,
            bracket: null,
            cardCount: 2,
            cards: [
              { oracleId: 'a', cardName: 'Staff of Domination' },
              { oracleId: 'b', cardName: 'Priest of Titania' },
            ],
          },
          missingOracleIds: ['a'],
        },
      ],
    } as never;
    expect(coachCombos(resp, [LATHRIL, PRIEST])).toHaveLength(1);
    expect(coachCombos(resp, [GRIZZLY, PRIEST])).toHaveLength(0);
  });

  it('Next best move offers the completion only with the payoff in the deck', () => {
    const match = {
      combo: {
        id: 'x',
        produces: line.results,
        popularity: 2000,
        cards: [
          { oracleId: 'a', cardName: 'Staff of Domination' },
          { oracleId: 'b', cardName: 'Priest of Titania' },
        ],
      },
      missingOracleIds: ['a'],
    } as unknown as ComboMatch;
    const moves = (cards: ScryfallCard[]) =>
      buildNextBestMoves({
        roleCounts: {},
        roleTargets: {},
        cardCount: 99,
        deckTarget: 100,
        oneAwayCombos: [match],
        deckPayoffs: deckComboPayoffs(cards),
      }).filter((m) => m.cardName === 'Staff of Domination');
    expect(moves([LATHRIL, PRIEST])).toHaveLength(1);
    expect(moves([GRIZZLY, PRIEST])).toHaveLength(0);
  });

  it('the combos lane keeps a converted line and drops it without the payoff', () => {
    const match = {
      combo: {
        id: 'x',
        produces: line.results,
        popularity: 2000,
        cards: [
          { oracleId: 'a', cardName: 'Staff of Domination' },
          { oracleId: 'b', cardName: 'Priest of Titania' },
        ],
      },
      missingOracleIds: ['a'],
    } as unknown as ComboMatch;
    const data = { oneAway: [match], inDeck: [] };
    expect(winningCombos(data, deckComboPayoffs([LATHRIL, PRIEST]))).toHaveLength(1);
    expect(winningCombos(data, deckComboPayoffs([GRIZZLY, PRIEST]))).toHaveLength(0);
    expect(winningCombos(data)).toHaveLength(0);
  });
});
