import { describe, expect, it } from 'vitest';
import { normalizeCardImages } from './normalize-card-images';

const ID = 'fc817e07-c1f3-469f-9cf7-0945dea7400f';
const at = (seg: string, ext: string) =>
  `https://cards.scryfall.io/${seg}/front/f/c/${ID}.${ext}?1`;

// What Scryfall serves once the JPEGs are gone: the WebP keys and `jpeg` only.
const modernOnly = {
  thumb: at('thumb', 'webp'),
  grid: at('grid', 'webp'),
  display: at('display', 'webp'),
  art: at('art', 'webp'),
  crop: at('crop', 'webp'),
  jpeg: at('normal', 'jpg'),
};

describe('normalizeCardImages', () => {
  it('fills the legacy keys the app reads from a card that has only the WebP keys', () => {
    const out = normalizeCardImages({ id: ID, image_uris: modernOnly });
    expect(out.image_uris).toMatchObject({
      small: at('thumb', 'webp'),
      normal: at('grid', 'webp'),
      large: at('display', 'webp'),
      art_crop: at('art', 'webp'),
      border_crop: at('crop', 'webp'),
    });
  });

  it('rewrites a legacy JPEG block to WebP', () => {
    const out = normalizeCardImages({
      image_uris: {
        small: at('small', 'jpg'),
        normal: at('normal', 'jpg'),
        art_crop: at('art_crop', 'jpg'),
      },
    });
    expect(out.image_uris).toMatchObject({
      small: at('thumb', 'webp'),
      normal: at('grid', 'webp'),
      art_crop: at('art', 'webp'),
    });
  });

  it('reaches both faces, a list, and a bare array', () => {
    const card = { card_faces: [{ image_uris: modernOnly }, { image_uris: modernOnly }] };
    const list = normalizeCardImages({ object: 'list', data: [card] });
    expect(list.data[0].card_faces[1].image_uris).toHaveProperty('normal', at('grid', 'webp'));
    expect(normalizeCardImages([card])[0].card_faces[0].image_uris).toHaveProperty(
      'art_crop',
      at('art', 'webp')
    );
  });

  it('returns the same reference when there is nothing to change', () => {
    const done = normalizeCardImages({ image_uris: modernOnly });
    expect(normalizeCardImages(done)).toBe(done);
    const plain = { name: 'x', cmc: 1 };
    expect(normalizeCardImages(plain)).toBe(plain);
    expect(normalizeCardImages(null)).toBeNull();
    expect(normalizeCardImages('s')).toBe('s');
  });
});
