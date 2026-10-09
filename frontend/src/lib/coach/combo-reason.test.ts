// @vitest-environment node
//
// Guards (E625, E624) for the sentence a combo completion row and Next best move
// speak: the results that END the game lead, and a one-card combo says it needs
// no partner. The result lists are Commander Spellbook's own.
import { describe, expect, it } from 'vitest';
import { buildNextBestMoves } from '@/deck-builder/services/deckBuilder/nextBestMove';
import type { DeckPayoffs } from '@/deck-builder/services/winConditions/comboPayoffs';
import { winningResultsFirst } from '@/deck-builder/services/winConditions/detect';
import type { ComboMatch } from '@/types/combos';
import { winningCombos } from './coach-changes';
import { fromComboCompletion } from './deck-change';

const match = (produces: string[], cards: string[], missing: string, id = 'x'): ComboMatch =>
  ({
    combo: {
      id,
      produces,
      popularity: 500,
      bracket: null,
      cardCount: cards.length,
      cards: cards.map((cardName) => ({ oracleId: cardName, cardName })),
    },
    presentOracleIds: cards.filter((c) => c !== missing),
    missingOracleIds: [missing],
  }) as unknown as ComboMatch;

// Spellbook 2292-3139--5
const HENGE = match(
  [
    'Infinite scry 1',
    'Infinite creature ETB',
    'Infinite creature LTB',
    'Infinite death triggers',
    'Infinite creature sacrifice triggers',
  ],
  ['The Great Henge', 'Viscera Seer'],
  'The Great Henge'
);
// Spellbook 7443--88
const EMERITUS = match(
  ['Return all cards from your graveyard to your hand', 'Infinite turns', 'Lock'],
  ['Emeritus of Abundance // Regrowth'],
  'Emeritus of Abundance // Regrowth'
);
const DEATH: DeckPayoffs = new Set(['death']);

describe('winning results lead (E625)', () => {
  it('moves the result the deck converts ahead of the ones that do not win', () => {
    expect(winningResultsFirst(HENGE.combo.produces, DEATH).slice(0, 2)).toEqual([
      'Infinite death triggers',
      'Infinite creature sacrifice triggers',
    ]);
    expect(winningResultsFirst(HENGE.combo.produces, DEATH)).toHaveLength(5);
  });

  it('puts a result that wins on its own ahead of one that does not', () => {
    expect(winningResultsFirst(['Infinite mana', 'Win the game'])[0]).toBe('Win the game');
  });

  it('keeps Spellbook order when nothing wins', () => {
    expect(winningResultsFirst(['Infinite mana', 'Infinite scry 1'])).toEqual([
      'Infinite mana',
      'Infinite scry 1',
    ]);
  });

  it('the combos lane row names the winning results, with an honest +N more', () => {
    const [m] = winningCombos({ oneAway: [HENGE] }, DEATH);
    const c = fromComboCompletion(m, 'The Great Henge', undefined, DEATH);
    expect(c.reason).toBe(
      'Completes Viscera Seer → Infinite death triggers + Infinite creature sacrifice triggers +3 more'
    );
    expect(c.reason).not.toContain('scry');
  });

  it('Next best move leads with the winning result', () => {
    const [move] = buildNextBestMoves({
      roleCounts: {},
      roleTargets: {},
      cardCount: 99,
      deckTarget: 100,
      oneAwayCombos: [HENGE],
      deckPayoffs: DEATH,
    }).filter((x) => x.cardName === 'The Great Henge');
    expect(move.detail).toContain('Infinite death triggers');
    expect(move.detail).not.toContain('scry');
  });
});

describe('a one-card combo says it needs no partner (E624)', () => {
  it('the combos row reads as the card doing it alone', () => {
    const c = fromComboCompletion(EMERITUS, 'Emeritus of Abundance // Regrowth');
    expect(c.reason).toBe(
      'Does it alone: Infinite turns + Return all cards from your graveyard to your hand +1 more'
    );
    expect(c.reason).not.toMatch(/Completes\s*→/);
  });

  it('Next best move says the same', () => {
    const [move] = buildNextBestMoves({
      roleCounts: {},
      roleTargets: {},
      cardCount: 99,
      deckTarget: 100,
      oneAwayCombos: [EMERITUS],
    }).filter((x) => x.cardName === 'Emeritus of Abundance // Regrowth');
    expect(move.detail).toBe('Emeritus of Abundance // Regrowth does it alone: Infinite turns.');
  });
});
