import { describe, expect, it } from 'vitest';
import type { EnrichedCard } from '@/types/index';
import { dominantColors } from './dominant-colors';

const card = (name: string, colorIdentity: string[]) => ({ name, colorIdentity }) as EnrichedCard;

describe('dominantColors', () => {
  it('names the colors most of the cards play, strongest first', () => {
    const cards = [
      ...Array.from({ length: 6 }, (_, i) => card(`g${i}`, ['G'])),
      ...Array.from({ length: 3 }, (_, i) => card(`b${i}`, ['B'])),
      card('r', ['R']),
    ];
    expect(dominantColors(cards)).toEqual(['G', 'B']);
  });

  it('is empty for no cards and for colorless ones', () => {
    expect(dominantColors([])).toEqual([]);
    expect(dominantColors([card('x', [])])).toEqual([]);
  });
});
