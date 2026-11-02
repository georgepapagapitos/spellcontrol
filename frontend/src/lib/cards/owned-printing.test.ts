import { describe, expect, it } from 'vitest';
import type { EnrichedCard } from '@/types';
import { ownedCopyImage } from './owned-printing';

const ID = 'fc817e07-c1f3-469f-9cf7-0945dea7400f';
const copy = (over: Partial<EnrichedCard>) =>
  ({ scryfallId: ID, finish: 'nonfoil', ...over }) as EnrichedCard;

describe('ownedCopyImage (E1088)', () => {
  it('re-sizes a stored WebP URL', () => {
    const stored = `https://cards.scryfall.io/grid/front/f/c/${ID}.webp?1`;
    expect(ownedCopyImage(copy({ imageNormal: stored }), 'art_crop')).toBe(
      `https://cards.scryfall.io/art/front/f/c/${ID}.webp?1`
    );
    expect(ownedCopyImage(copy({ imageNormal: stored }), 'small')).toBe(
      `https://cards.scryfall.io/thumb/front/f/c/${ID}.webp?1`
    );
  });

  it('reads a row persisted with a JPEG URL as its WebP twin', () => {
    const stored = `https://cards.scryfall.io/normal/front/f/c/${ID}.jpg?1`;
    expect(ownedCopyImage(copy({ imageNormal: stored }), 'large')).toBe(
      `https://cards.scryfall.io/display/front/f/c/${ID}.webp?1`
    );
  });

  it('builds a WebP path from the printing id when no image is stored', () => {
    expect(ownedCopyImage(copy({}), 'normal')).toBe(
      `https://cards.scryfall.io/grid/front/f/${'c'}/${ID}.webp`
    );
  });
});
