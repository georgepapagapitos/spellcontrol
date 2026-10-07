// E532: which combo lines count as assemblable. Real combos from the E532
// panel (Muldrotha, the Gravetide; Sivitri, Dragon Master).
import { describe, it, expect } from 'vitest';
import type { EDHRECCard, EDHRECCombo } from '@/deck-builder/types';
import { achievableComboPieces, winCombos } from './comboLines';

const combo = (...names: string[]): EDHRECCombo => ({
  comboId: names.join('+'),
  cards: names.map((name) => ({ name, id: name })),
  results: ['Win the game'],
  deckCount: 1000,
  rank: 1,
  bracket: 4,
  prereqCount: 0,
  cardCount: names.length,
  href: null,
});
// Commander Spellbook 864-2596-4050 (the v4 Coach corpus, 2026-10-06): loops
// mana and blinks, and never ends the game on its own.
const LOOP_RESULTS = [
  'Infinite blinking',
  'Infinite colored mana',
  'Infinite death triggers',
  'Infinite creature ETB',
];
const loopCombo = (...names: string[]): EDHRECCombo => ({
  ...combo(...names),
  results: LOOP_RESULTS,
});
const ec = (name: string, inclusion: number): EDHRECCard => ({
  name,
  sanitized: name.toLowerCase(),
  primary_type: 'Creature',
  inclusion,
  num_decks: 100,
});

describe('achievableComboPieces', () => {
  it('keeps a line whose every piece is in the pool or the deck', () => {
    const pieces = achievableComboPieces(
      [combo('Hermit Druid', "Thassa's Oracle")],
      [ec('Hermit Druid', 30.9), ec("Thassa's Oracle", 12.6)],
      () => false
    );
    expect([...pieces].sort()).toEqual(['Hermit Druid', "Thassa's Oracle"]);
  });

  it('counts a piece already in the deck, but only returns pool pieces', () => {
    const pieces = achievableComboPieces(
      [combo('Hullbreaker Horror', 'Sol Ring')],
      [ec('Hullbreaker Horror', 8.2)],
      (n) => n === 'Sol Ring'
    );
    expect([...pieces]).toEqual(['Hullbreaker Horror']);
  });

  it('drops a line with a piece the deck cannot reach', () => {
    const pieces = achievableComboPieces(
      [combo('Hullbreaker Horror', 'Mox Amber')],
      [ec('Hullbreaker Horror', 8.2)],
      () => false
    );
    expect(pieces.size).toBe(0);
  });

  it('ignores a loop that only makes mana and blinks (E540 S8)', () => {
    const pieces = achievableComboPieces(
      [loopCombo('Living Death', 'Eternal Witness', 'Phyrexian Altar')],
      [ec('Living Death', 20), ec('Eternal Witness', 40), ec('Phyrexian Altar', 30)],
      () => false
    );
    expect(pieces.size).toBe(0);
  });
});

describe('winCombos', () => {
  it('keeps the lines that end the game and drops the loops that do not', () => {
    const win = combo('Hermit Druid', "Thassa's Oracle");
    const loop = loopCombo('Living Death', 'Eternal Witness', 'Phyrexian Altar');
    expect(winCombos([loop, win])).toEqual([win]);
  });
});
