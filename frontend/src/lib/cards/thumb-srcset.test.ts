import { describe, expect, it } from 'vitest';
import { thumbSrcSet } from './thumb-srcset';

describe('thumbSrcSet', () => {
  it('offers the small Scryfall image beside the normal one', () => {
    const normal = 'https://cards.scryfall.io/normal/front/6/8/68dad9ea.jpg?1790743605';
    expect(thumbSrcSet(normal)).toBe(
      'https://cards.scryfall.io/small/front/6/8/68dad9ea.jpg?1790743605 146w, ' + `${normal} 488w`
    );
  });

  it('gives no srcset for a URL that is not a Scryfall normal image', () => {
    expect(thumbSrcSet('https://cards.scryfall.io/large/front/6/8/x.jpg')).toBeUndefined();
    expect(thumbSrcSet('blob:http://localhost/abc')).toBeUndefined();
  });
});
