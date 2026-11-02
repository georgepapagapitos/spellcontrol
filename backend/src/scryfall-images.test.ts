import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScryfallCache } from './cache';
import { projectBulkCard } from './scryfall-bulk';
import {
  modernFeedbackSuggestions,
  normalizeCardImages,
  normalizeCardsImages,
  storedImageUrl,
} from './scryfall-images';
import type { ScryfallCard } from './types';

const ID = 'fc817e07-c1f3-469f-9cf7-0945dea7400f';
const legacy = (seg: string) => `https://cards.scryfall.io/${seg}/front/f/c/${ID}.jpg?1793021181`;
const modern = (seg: string) => `https://cards.scryfall.io/${seg}/front/f/c/${ID}.webp?1793021181`;

/** Scryfall's payload once the JPEG keys are gone: ONLY the new keys. */
const NEW_KEYS_ONLY = {
  thumb: modern('thumb'),
  grid: modern('grid'),
  display: modern('display'),
  crop: modern('crop'),
  art: modern('art'),
};

describe('normalizeCardImages', () => {
  it('fills the legacy keys on a card that has only the new keys', () => {
    const card = normalizeCardImages({ image_uris: { ...NEW_KEYS_ONLY } });
    expect(card.image_uris).toMatchObject({
      small: modern('thumb'),
      normal: modern('grid'),
      large: modern('display'),
      art_crop: modern('art'),
    });
  });

  it('rewrites present legacy JPEG URLs to WebP, on each face too', () => {
    const card = normalizeCardImages({
      image_uris: { small: legacy('small') },
      card_faces: [{ image_uris: { normal: legacy('normal') } }, null, { name: 'no art' }],
    });
    expect(card.image_uris.small).toBe(modern('thumb'));
    expect(card.card_faces[0]?.image_uris?.normal).toBe(modern('grid'));
  });

  it('tolerates cards with no images and non-objects', () => {
    expect(normalizeCardImages({ name: 'x' })).toEqual({ name: 'x' });
    expect(normalizeCardImages(null)).toBeNull();
    expect(
      normalizeCardsImages([{ image_uris: { art: modern('art') } }])[0]?.image_uris
    ).toMatchObject({
      art_crop: modern('art'),
    });
  });
});

describe('storedImageUrl', () => {
  it('rewrites a stored URL on read and maps empty to null', () => {
    expect(storedImageUrl(legacy('art_crop'))).toBe(modern('art'));
    expect(storedImageUrl(modern('art'))).toBe(modern('art'));
    expect(storedImageUrl(null)).toBeNull();
    expect(storedImageUrl(undefined)).toBeNull();
  });
});

describe('modernFeedbackSuggestions', () => {
  it('rewrites imageUrl and the embedded card, leaving the rest', () => {
    const out = modernFeedbackSuggestions([
      {
        id: 's1',
        type: 'add',
        cardName: 'Sol Ring',
        imageUrl: legacy('small'),
        card: { image_uris: { normal: legacy('normal') } },
      },
      { id: 's2', type: 'cut', cardName: 'Island' },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]).toMatchObject({
      id: 's1',
      imageUrl: modern('thumb'),
      card: { image_uris: { normal: modern('grid') } },
    });
    expect(out[1]).toMatchObject({ id: 's2', cardName: 'Island' });
  });

  it('passes a non-list through', () => {
    expect(modernFeedbackSuggestions(null)).toBeNull();
  });
});

describe('ingress: a card with ONLY the new keys still yields the legacy image_uris', () => {
  const bulk = {
    id: 's-1',
    oracle_id: 'o-1',
    name: 'Sol Ring',
    set: 'cmr',
    collector_number: '1',
    games: ['paper'],
  };

  it('projectBulkCard (bulk ingest)', () => {
    const card = projectBulkCard({ ...bulk, image_uris: { ...NEW_KEYS_ONLY } } as never);
    expect(card?.image_uris).toMatchObject({
      small: modern('thumb'),
      normal: modern('grid'),
      large: modern('display'),
      art_crop: modern('art'),
    });
  });

  it('projectBulkCard fills a double-faced card face by face', () => {
    const card = projectBulkCard({
      ...bulk,
      card_faces: [{ name: 'A', image_uris: { ...NEW_KEYS_ONLY } }],
    } as never);
    expect(card?.card_faces?.[0]?.image_uris?.normal).toBe(modern('grid'));
  });

  describe('cache read', () => {
    let dir: string;
    let cache: ScryfallCache;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scryfall-images-'));
      cache = new ScryfallCache(path.join(dir, 'cards.db'));
    });
    afterEach(() => {
      cache.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('serves stored JPEG-era and new-keys-only rows as WebP legacy keys', () => {
      const base = { rarity: 'common', set: 'cmr', set_name: 'CL', collector_number: '1' };
      cache.setMany([
        { ...base, id: 'old', name: 'Old', image_uris: { normal: legacy('normal') } },
        { ...base, id: 'new', name: 'New', image_uris: { ...NEW_KEYS_ONLY } },
      ] as ScryfallCard[]);
      const got = cache.getMany(['old', 'new']);
      expect(got.get('old')?.image_uris?.normal).toBe(modern('grid'));
      expect(got.get('new')?.image_uris?.normal).toBe(modern('grid'));
      expect(got.get('new')?.image_uris?.art_crop).toBe(modern('art'));
    });
  });
});
