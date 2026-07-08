import { describe, expect, it } from 'vitest';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { autoPlace, rowForCard } from './auto-place';

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: id, ...overrides };
}

function bf(c: PlaytestCard, x = 0, y = 0): BattlefieldCard {
  return { card: c, tapped: false, faceDown: false, counters: {}, stickers: [], x, y };
}

describe('rowForCard', () => {
  it.each([
    ['Land — Forest', 'lands'],
    ['Basic Land — Mountain', 'lands'],
    ['Land', 'lands'],
    ['Snow Land — Swamp', 'lands'],
    ['Artifact Land — Plains', 'lands'],
  ])('classifies "%s" as %s', (typeLine, row) => {
    expect(rowForCard(card('c', { typeLine }))).toBe(row);
  });

  it.each([
    ['Creature — Human Wizard', 'creatures'],
    ['Artifact Creature — Golem', 'creatures'],
    ['Legendary Creature — Elder Dragon', 'creatures'],
    ['Enchantment Creature — Spirit', 'creatures'],
  ])('classifies "%s" as %s', (typeLine, row) => {
    expect(rowForCard(card('c', { typeLine }))).toBe(row);
  });

  it.each([
    ['Artifact', 'permanents'],
    ['Enchantment — Aura', 'permanents'],
    ['Legendary Planeswalker — Teferi', 'permanents'],
    ['Battle — Siege', 'permanents'],
    ['Sorcery', 'permanents'],
    ['Instant', 'permanents'],
    ['', 'permanents'],
  ])('classifies "%s" as %s', (typeLine, row) => {
    expect(rowForCard(card('c', { typeLine }))).toBe(row);
  });

  it('treats tokens as creatures regardless of their type line', () => {
    // A copy of an enchantment-creature token still belongs in the creature row.
    expect(rowForCard(card('tok', { isToken: true, typeLine: 'Enchantment' }))).toBe('creatures');
  });

  it('handles missing typeLine as permanents (safest fallback)', () => {
    expect(rowForCard(card('c'))).toBe('permanents');
  });
});

describe('autoPlace', () => {
  const rect = { width: 800, height: 540 };

  it('places the first card of each row at a different y', () => {
    const land = card('l1', { typeLine: 'Land' });
    const creature = card('c1', { typeLine: 'Creature — Wizard' });
    const enchant = card('e1', { typeLine: 'Enchantment' });
    const placed = [
      autoPlace(land, [], rect),
      autoPlace(creature, [], rect),
      autoPlace(enchant, [], rect),
    ];
    const ys = placed.map((p) => p.y);
    // Lands should be lowest (largest y), permanents highest (smallest y).
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
  });

  it('cascades horizontally for siblings of the same row', () => {
    const creature1 = card('c1', { typeLine: 'Creature' });
    const first = autoPlace(creature1, [], rect);
    const second = autoPlace(card('c2', { typeLine: 'Creature' }), [bf(creature1)], rect);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y); // same sub-row
  });

  it('counts existing battlefield cards by row, not in total', () => {
    // Two lands and one creature on the field; a new creature should land
    // at column 1 of the creature row, not column 3.
    const existing = [
      bf(card('L1', { typeLine: 'Land' })),
      bf(card('L2', { typeLine: 'Land' })),
      bf(card('C1', { typeLine: 'Creature' })),
    ];
    const first = autoPlace(card('C0', { typeLine: 'Creature' }), [], rect);
    const next = autoPlace(card('C2', { typeLine: 'Creature' }), existing, rect);
    // X step matches the gap between col 0 and col 1.
    expect(next.x - first.x).toBeGreaterThan(0);
  });

  it('wraps to a sub-row when the row fills past battlefield width', () => {
    const narrow = { width: 360, height: 540 };
    const creatures = Array.from({ length: 12 }, (_, i) =>
      bf(card(`c${i}`, { typeLine: 'Creature' }))
    );
    const placed = autoPlace(card('extra', { typeLine: 'Creature' }), creatures, narrow);
    const first = autoPlace(card('first', { typeLine: 'Creature' }), [], narrow);
    // Y should differ — the extra card sits one sub-row away from the first.
    expect(placed.y).not.toBe(first.y);
  });

  it('clamps within battlefield bounds', () => {
    const placed = autoPlace(card('l', { typeLine: 'Land' }), [], { width: 200, height: 200 });
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.y).toBeGreaterThanOrEqual(0);
    expect(placed.x).toBeLessThanOrEqual(200);
    expect(placed.y).toBeLessThanOrEqual(200);
  });

  it('falls back to a sensible default when no rect is given', () => {
    const placed = autoPlace(card('l', { typeLine: 'Land' }), [], null);
    expect(Number.isFinite(placed.x)).toBe(true);
    expect(Number.isFinite(placed.y)).toBe(true);
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.y).toBeGreaterThanOrEqual(0);
  });

  it('returns the same position for identical inputs (pure)', () => {
    const a = autoPlace(card('c', { typeLine: 'Creature' }), [], rect);
    const b = autoPlace(card('c', { typeLine: 'Creature' }), [], rect);
    expect(a).toEqual(b);
  });

  it('places tokens in the creature row', () => {
    const tokenPos = autoPlace(card('tok', { isToken: true }), [], rect);
    const creaturePos = autoPlace(card('cr', { typeLine: 'Creature' }), [], rect);
    expect(tokenPos.y).toBe(creaturePos.y);
  });
});
