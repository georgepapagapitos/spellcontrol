import { describe, expect, it } from 'vitest';
import type { CardToken, ScryfallCard } from '@/deck-builder/types';
import { aggregateDeckTokens } from './deck-tokens';

/** Minimal ScryfallCard — aggregateDeckTokens only reads `name` + `tokens`. */
function card(name: string, tokens?: CardToken[]): ScryfallCard {
  return { name, tokens } as unknown as ScryfallCard;
}

const GOBLIN: CardToken = { name: 'Goblin', typeLine: 'Token Creature — Goblin' };
const TREASURE: CardToken = { name: 'Treasure', typeLine: 'Token Artifact — Treasure' };

describe('aggregateDeckTokens', () => {
  it('returns an empty list for an empty deck', () => {
    expect(aggregateDeckTokens([])).toEqual([]);
  });

  it('ignores cards that make no tokens', () => {
    expect(aggregateDeckTokens([card('Forest'), card('Llanowar Elves', [])])).toEqual([]);
  });

  it('lists a single token with its producer', () => {
    const result = aggregateDeckTokens([card('Krenko, Mob Boss', [GOBLIN])]);
    expect(result).toEqual([
      { name: 'Goblin', typeLine: 'Token Creature — Goblin', producers: ['Krenko, Mob Boss'] },
    ]);
  });

  it('merges producers for the same token across cards', () => {
    const result = aggregateDeckTokens([
      card('Krenko, Mob Boss', [GOBLIN]),
      card('Goblin Rabblemaster', [GOBLIN]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].producers).toEqual(['Goblin Rabblemaster', 'Krenko, Mob Boss']);
  });

  it('counts a card listed multiple times (deck copies) as one producer', () => {
    const result = aggregateDeckTokens([
      card('Lightning Coils', [GOBLIN]),
      card('Lightning Coils', [GOBLIN]),
      card('Lightning Coils', [GOBLIN]),
    ]);
    expect(result[0].producers).toEqual(['Lightning Coils']);
  });

  it('dedupes a token repeated within one card', () => {
    const result = aggregateDeckTokens([card('Doubling Token', [GOBLIN, { ...GOBLIN }])]);
    expect(result).toHaveLength(1);
    expect(result[0].producers).toEqual(['Doubling Token']);
  });

  it('keeps tokens with the same name but different type lines separate', () => {
    const result = aggregateDeckTokens([
      card('Weird Maker', [
        { name: 'Spirit', typeLine: 'Token Creature — Spirit' },
        { name: 'Spirit', typeLine: 'Token Enchantment Creature — Spirit' },
      ]),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.typeLine)).toEqual([
      'Token Creature — Spirit',
      'Token Enchantment Creature — Spirit',
    ]);
  });

  it('orders by producer count desc, then name', () => {
    const result = aggregateDeckTokens([
      card('A', [TREASURE]),
      card('B', [TREASURE]),
      card('C', [GOBLIN]),
    ]);
    // Treasure (2 producers) before Goblin (1 producer).
    expect(result.map((t) => t.name)).toEqual(['Treasure', 'Goblin']);
  });

  it('breaks producer-count ties alphabetically by name', () => {
    const result = aggregateDeckTokens([card('X', [GOBLIN]), card('Y', [TREASURE])]);
    expect(result.map((t) => t.name)).toEqual(['Goblin', 'Treasure']);
  });

  it('handles a token entry with no type line', () => {
    const result = aggregateDeckTokens([card('Mystery Maker', [{ name: 'Clue' }])]);
    expect(result).toEqual([{ name: 'Clue', typeLine: undefined, producers: ['Mystery Maker'] }]);
  });

  it('trims whitespace in names and skips empty token/producer names', () => {
    const result = aggregateDeckTokens([
      card('  Spacey Card  ', [{ name: '  Soldier  ', typeLine: '  Token Creature — Soldier  ' }]),
      card('  ', [GOBLIN]), // blank producer name → skipped
      card('Blank Token Maker', [{ name: '   ' }]), // blank token name → skipped
    ]);
    expect(result).toEqual([
      { name: 'Soldier', typeLine: 'Token Creature — Soldier', producers: ['Spacey Card'] },
    ]);
  });
});
