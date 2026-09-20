import { describe, expect, it } from 'vitest';
import { tokensFromParts } from './card-tokens';

describe('tokensFromParts', () => {
  it('keeps only the token components', () => {
    expect(
      tokensFromParts([
        { component: 'combo_piece', name: 'Some Combo Card', type_line: 'Creature' },
        { component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' },
        { component: 'meld_result', name: 'Melded Thing', type_line: 'Creature' },
      ])
    ).toEqual([{ name: 'Goblin', typeLine: 'Token Creature — Goblin' }]);
  });

  // The card's own `all_parts` entry names the card itself; without the
  // component filter every token-maker would list itself as a token.
  it('never lists the card itself', () => {
    expect(
      tokensFromParts([{ component: 'token', name: 'Goblin' }, { name: 'Dragon Fodder' }])
    ).toEqual([{ name: 'Goblin' }]);
  });

  it('dedupes by name and type line, but keeps two tokens that differ', () => {
    expect(
      tokensFromParts([
        { component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' },
        { component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' },
        { component: 'token', name: 'Goblin', type_line: 'Token Artifact Creature — Goblin' },
      ])
    ).toEqual([
      { name: 'Goblin', typeLine: 'Token Creature — Goblin' },
      { name: 'Goblin', typeLine: 'Token Artifact Creature — Goblin' },
    ]);
  });

  it('omits the type line rather than storing an empty one', () => {
    expect(tokensFromParts([{ component: 'token', name: 'Treasure' }])).toEqual([
      { name: 'Treasure' },
    ]);
  });

  // Absent, not `[]`: ~90% of cards make no tokens, and an empty array on
  // every one of them is pure cache weight.
  it('is undefined when the card makes no tokens', () => {
    expect(tokensFromParts(undefined)).toBeUndefined();
    expect(tokensFromParts([])).toBeUndefined();
    expect(tokensFromParts([{ component: 'combo_piece', name: 'Nope' }])).toBeUndefined();
  });

  it('skips a token entry with no name', () => {
    expect(tokensFromParts([{ component: 'token', type_line: 'Token Creature' }])).toBeUndefined();
  });
});
