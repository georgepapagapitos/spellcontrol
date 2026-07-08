import { describe, it, expect } from 'vitest';
import { DECK_CARD_TAGS, MAX_CARD_TAGS, tagCounts, sectorForPoint } from './deck-card-tags';

describe('DECK_CARD_TAGS palette', () => {
  it('is exactly the 8 fixed functional tags (one per radial sector)', () => {
    expect(DECK_CARD_TAGS).toEqual([
      'Ramp',
      'Draw',
      'Interaction',
      'Removal',
      'Wincon',
      'Synergy',
      'Setup',
      'Payoff',
    ]);
  });

  it('caps tags per card at 4', () => {
    expect(MAX_CARD_TAGS).toBe(4);
  });
});

describe('tagCounts', () => {
  it('returns an empty map for no cards / untagged cards', () => {
    expect(tagCounts([]).size).toBe(0);
    expect(tagCounts([{}, { tags: [] }]).size).toBe(0);
  });

  it('counts each tag across slots', () => {
    const counts = tagCounts([
      { tags: ['Ramp'] },
      { tags: ['Ramp', 'Draw'] },
      {},
      { tags: ['Draw'] },
      { tags: ['Wincon'] },
    ]);
    expect(counts.get('Ramp')).toBe(2);
    expect(counts.get('Draw')).toBe(2);
    expect(counts.get('Wincon')).toBe(1);
    expect(counts.size).toBe(3);
  });

  it('tolerates (and counts) tags outside the palette', () => {
    const counts = tagCounts([{ tags: ['Ramp', 'Stax'] }, { tags: ['Stax'] }]);
    expect(counts.get('Stax')).toBe(2);
    expect(counts.get('Ramp')).toBe(1);
  });
});

describe('sectorForPoint', () => {
  const N = 8;
  const DEAD = 24;

  it('returns null inside the dead zone (strictly), a sector at its edge', () => {
    expect(sectorForPoint(0, 0, N, DEAD)).toBeNull();
    expect(sectorForPoint(10, -10, N, DEAD)).toBeNull();
    expect(sectorForPoint(0, -23.9, N, DEAD)).toBeNull();
    // Exactly at the dead-zone radius counts as outside it.
    expect(sectorForPoint(0, -DEAD, N, DEAD)).toBe(0);
  });

  it('maps the four cardinal directions to their sector centers', () => {
    expect(sectorForPoint(0, -100, N, DEAD)).toBe(0); // 12 o'clock
    expect(sectorForPoint(100, 0, N, DEAD)).toBe(2); // 3 o'clock
    expect(sectorForPoint(0, 100, N, DEAD)).toBe(4); // 6 o'clock
    expect(sectorForPoint(-100, 0, N, DEAD)).toBe(6); // 9 o'clock
  });

  it('maps the diagonals to the in-between sectors', () => {
    expect(sectorForPoint(100, -100, N, DEAD)).toBe(1); // 1:30
    expect(sectorForPoint(100, 100, N, DEAD)).toBe(3); // 4:30
    expect(sectorForPoint(-100, 100, N, DEAD)).toBe(5); // 7:30
    expect(sectorForPoint(-100, -100, N, DEAD)).toBe(7); // 10:30
  });

  it('resolves a boundary between sectors to the clockwise (higher) index', () => {
    // Exactly 22.5° clockwise of 12 o'clock — the sector 0 / sector 1 edge.
    const edge = (22.5 * Math.PI) / 180;
    const dx = 100 * Math.sin(edge);
    const dy = -100 * Math.cos(edge);
    expect(sectorForPoint(dx, dy, N, DEAD)).toBe(1);
    // Just inside sector 0's half.
    expect(sectorForPoint(dx - 0.5, dy, N, DEAD)).toBe(0);
  });

  it('wraps just counterclockwise of 12 o’clock back to sector 0', () => {
    // -10°: still within sector 0's half-sector on the counterclockwise side.
    const a = (-10 * Math.PI) / 180;
    expect(sectorForPoint(100 * Math.sin(a), -100 * Math.cos(a), N, DEAD)).toBe(0);
    // -30°: past the sector 7/0 boundary (-22.5°) → sector 7.
    const b = (-30 * Math.PI) / 180;
    expect(sectorForPoint(100 * Math.sin(b), -100 * Math.cos(b), N, DEAD)).toBe(7);
  });

  it('honors other sector counts', () => {
    expect(sectorForPoint(100, 0, 4, DEAD)).toBe(1); // right = sector 1 of 4
    expect(sectorForPoint(0, 100, 4, DEAD)).toBe(2);
    expect(sectorForPoint(-100, 0, 4, DEAD)).toBe(3);
  });

  it('returns null for a degenerate sector count', () => {
    expect(sectorForPoint(100, 0, 0, DEAD)).toBeNull();
  });
});
