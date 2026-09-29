import { describe, it, expect } from 'vitest';
import { buildAlternativeIndex } from './refine-alternatives';
import type { RefineCard } from './ai-refine';

function card(name: string): RefineCard {
  return { name, oracleId: '', qty: 1 };
}

describe('buildAlternativeIndex', () => {
  it('groups pool entries by role and excludes the card itself', () => {
    const pool = [card('Sol Ring'), card('Arcane Signet'), card('Swords to Plowshares')];
    const roleOf = (name: string) => (name === 'Swords to Plowshares' ? 'removal' : 'ramp');

    const index = buildAlternativeIndex(pool, roleOf);

    expect(index.get('Sol Ring')).toEqual(['Arcane Signet']);
    expect(index.get('Arcane Signet')).toEqual(['Sol Ring']);
    expect(index.get('Swords to Plowshares')).toEqual([]);
  });

  it('preserves pool order within a role group', () => {
    const pool = [card('C'), card('A'), card('B')];
    const roleOf = () => 'ramp';

    const index = buildAlternativeIndex(pool, roleOf);

    expect(index.get('C')).toEqual(['A', 'B']);
    expect(index.get('A')).toEqual(['C', 'B']);
    expect(index.get('B')).toEqual(['C', 'A']);
  });

  it('gives null-role cards an empty list and excludes them as candidates', () => {
    const pool = [card('Sol Ring'), card('Weird Land'), card('Arcane Signet')];
    const roleOf = (name: string) => (name === 'Weird Land' ? null : 'ramp');

    const index = buildAlternativeIndex(pool, roleOf);

    expect(index.get('Weird Land')).toEqual([]);
    expect(index.get('Sol Ring')).toEqual(['Arcane Signet']);
    expect(index.get('Arcane Signet')).toEqual(['Sol Ring']);
  });

  it('does not duplicate an alternative when a name appears twice in the pool', () => {
    const pool = [card('Sol Ring'), card('Arcane Signet'), card('Sol Ring')];
    const roleOf = () => 'ramp';

    const index = buildAlternativeIndex(pool, roleOf);

    expect(index.size).toBe(2);
    expect(index.get('Sol Ring')).toEqual(['Arcane Signet']);
    expect(index.get('Arcane Signet')).toEqual(['Sol Ring']);
  });

  it('returns an empty map for an empty pool', () => {
    expect(buildAlternativeIndex([], () => 'ramp').size).toBe(0);
  });
});
