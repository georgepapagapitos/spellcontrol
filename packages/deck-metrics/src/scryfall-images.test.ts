import { describe, expect, it } from 'vitest';
import {
  isLegacyScryfallImage,
  modernScryfallImage,
  normalizeImageUris,
  scryfallJpegImage,
  withLegacyImageKeys,
  withModernImageKeys,
} from './scryfall-images';

const ID = 'fc817e07-c1f3-469f-9cf7-0945dea7400f';
const legacy = (seg: string) => `https://cards.scryfall.io/${seg}/front/f/c/${ID}.jpg?1793021181`;
const modern = (seg: string) => `https://cards.scryfall.io/${seg}/front/f/c/${ID}.webp?1793021181`;

describe('modernScryfallImage', () => {
  it.each([
    ['small', 'thumb'],
    ['normal', 'grid'],
    ['large', 'display'],
    ['border_crop', 'crop'],
    ['art_crop', 'art'],
  ])('maps %s to %s, keeping path and stamp', (from, to) => {
    expect(modernScryfallImage(legacy(from))).toBe(modern(to));
  });

  it('keeps the back-face path and works without a stamp', () => {
    expect(modernScryfallImage(`https://cards.scryfall.io/large/back/a/b/${ID}.jpg`)).toBe(
      `https://cards.scryfall.io/display/back/a/b/${ID}.webp`
    );
  });

  it('is idempotent', () => {
    const once = modernScryfallImage(legacy('normal'));
    expect(modernScryfallImage(once)).toBe(once);
  });

  it.each([
    ['png', `https://cards.scryfall.io/png/front/f/c/${ID}.png?1`],
    ['a non-Scryfall host', `https://example.com/normal/front/f/c/${ID}.jpg?1`],
    ['a lookalike host', `https://cards.scryfall.io.evil.com/normal/front/f/c/${ID}.jpg?1`],
    ['an http URL', `http://cards.scryfall.io/normal/front/f/c/${ID}.jpg`],
    ['an unknown segment', `https://cards.scryfall.io/mystery/front/f/c/${ID}.jpg`],
    ['an empty string', ''],
  ])('leaves %s untouched', (_label, url) => {
    expect(modernScryfallImage(url)).toBe(url);
  });

  it('passes null and undefined through', () => {
    expect(modernScryfallImage(null)).toBeNull();
    expect(modernScryfallImage(undefined)).toBeUndefined();
  });
});

describe('scryfallJpegImage', () => {
  it.each(['thumb', 'grid', 'display', 'crop', 'art'])('maps %s to the normal JPEG', (seg) => {
    expect(scryfallJpegImage(modern(seg))).toBe(legacy('normal'));
  });

  it.each(['small', 'large', 'border_crop', 'art_crop'])(
    'maps the legacy %s JPEG to the normal JPEG, which survives the cutoff',
    (seg) => {
      expect(scryfallJpegImage(legacy(seg))).toBe(legacy('normal'));
    }
  );

  it('leaves the normal JPEG, other hosts and empties alone', () => {
    expect(scryfallJpegImage(legacy('normal'))).toBe(legacy('normal'));
    expect(scryfallJpegImage('https://example.com/art/x.webp')).toBe(
      'https://example.com/art/x.webp'
    );
    expect(scryfallJpegImage(undefined)).toBeUndefined();
  });
});

describe('isLegacyScryfallImage', () => {
  it('flags legacy JPEG URLs only', () => {
    expect(isLegacyScryfallImage(legacy('small'))).toBe(true);
    expect(isLegacyScryfallImage(modern('thumb'))).toBe(false);
    expect(isLegacyScryfallImage(42)).toBe(false);
  });
});

describe('withLegacyImageKeys', () => {
  it('fills every legacy key from the WebP keys', () => {
    const out = withLegacyImageKeys({
      thumb: modern('thumb'),
      grid: modern('grid'),
      display: modern('display'),
      crop: modern('crop'),
      art: modern('art'),
    });
    expect(out).toMatchObject({
      small: modern('thumb'),
      normal: modern('grid'),
      large: modern('display'),
      border_crop: modern('crop'),
      art_crop: modern('art'),
    });
  });

  it('keeps legacy keys that are present and returns the same reference when nothing to fill', () => {
    const uris = { normal: legacy('normal'), grid: modern('grid') };
    expect(withLegacyImageKeys(uris)).toBe(uris);
  });

  it('does not invent a key with no source', () => {
    expect(withLegacyImageKeys({ grid: modern('grid') })).not.toHaveProperty('art_crop');
  });

  it('passes non-objects through', () => {
    expect(withLegacyImageKeys(undefined)).toBeUndefined();
    expect(withLegacyImageKeys(null)).toBeNull();
  });
});

describe('withModernImageKeys', () => {
  it('fills WebP keys from legacy JPEG keys, rewritten', () => {
    expect(
      withModernImageKeys({ small: legacy('small'), art_crop: legacy('art_crop') })
    ).toMatchObject({
      thumb: modern('thumb'),
      art: modern('art'),
    });
  });
});

describe('normalizeImageUris', () => {
  it('rewrites legacy values to WebP and keeps other keys', () => {
    const out = normalizeImageUris({
      normal: legacy('normal'),
      png: 'https://cards.scryfall.io/png/x.png',
    });
    expect(out.normal).toBe(modern('grid'));
    expect(out.png).toBe('https://cards.scryfall.io/png/x.png');
  });

  it('serves a card with ONLY the WebP keys under the legacy names', () => {
    const out = normalizeImageUris<Record<string, string>>({
      thumb: modern('thumb'),
      grid: modern('grid'),
      art: modern('art'),
    });
    expect(out.small).toBe(modern('thumb'));
    expect(out.normal).toBe(modern('grid'));
    expect(out.art_crop).toBe(modern('art'));
  });

  it('returns the same reference when already normalized', () => {
    const uris = normalizeImageUris({ normal: legacy('normal') });
    expect(normalizeImageUris(uris)).toBe(uris);
  });
});
