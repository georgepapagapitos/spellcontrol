import { describe, expect, it } from 'vitest';
import { thumbSrcSet } from './thumb-srcset';

describe('thumbSrcSet', () => {
  it('offers the thumb WebP beside the grid one', () => {
    const grid = 'https://cards.scryfall.io/grid/front/6/8/68dad9ea.webp?1790743605';
    expect(thumbSrcSet(grid)).toBe(
      'https://cards.scryfall.io/thumb/front/6/8/68dad9ea.webp?1790743605 146w, ' + `${grid} 488w`
    );
  });

  it('reads a stored normal JPEG URL as its WebP twin', () => {
    const stored = 'https://cards.scryfall.io/normal/front/6/8/68dad9ea.jpg?1790743605';
    expect(thumbSrcSet(stored)).toBe(
      'https://cards.scryfall.io/thumb/front/6/8/68dad9ea.webp?1790743605 146w, ' +
        'https://cards.scryfall.io/grid/front/6/8/68dad9ea.webp?1790743605 488w'
    );
  });

  it('gives no srcset for a URL that is not a Scryfall normal image', () => {
    expect(thumbSrcSet('https://cards.scryfall.io/large/front/6/8/x.jpg')).toBeUndefined();
    expect(thumbSrcSet('blob:http://localhost/abc')).toBeUndefined();
  });
});
