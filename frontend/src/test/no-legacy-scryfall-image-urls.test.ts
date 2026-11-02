import { describe, expect, it } from 'vitest';

/**
 * Guard: no frontend source may carry a Scryfall card-image URL with a legacy
 * size segment. Scryfall retires the small / large / border_crop / art_crop
 * JPEGs on 2027-01-01 (E1088), so a literal like `cards.scryfall.io/art_crop/…`
 * is a URL that goes 404, and the horde catalog and its deck JSON are exactly
 * where one hides: they are data, read by no resolver.
 *
 * The size-segment knowledge lives in ONE place, `modernScryfallImage` in
 * `@spellcontrol/deck-metrics`; stored and fetched URLs go through it at
 * ingress (`lib/cards/normalize-card-images.ts`, `card-image-versions.ts`).
 * To test the mapping, write the old URL in a `*.test.ts(x)` file or a
 * `__fixtures__` / `*.fixtures.ts` file (a persisted row is a legitimate old
 * shape); both are skipped here.
 */
const LEGACY_SEGMENT = /cards\.scryfall\.io\/(small|normal|large|border_crop|art_crop)\//;

const sources = import.meta.glob('../**/*.{ts,tsx,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const isFixture = (path: string) =>
  /\.test\.tsx?$/.test(path) || /__fixtures__\//.test(path) || /\.fixtures?\.(ts|json)$/.test(path);

describe('no legacy Scryfall image segments in frontend source', () => {
  it('no non-test source or data file names a retired size segment on the card CDN', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !isFixture(path))
      .filter(([, content]) => LEGACY_SEGMENT.test(content))
      .map(([path]) => path);
    expect(offenders, 'Use modernScryfallImage (@spellcontrol/deck-metrics) instead').toEqual([]);
  });

  it('sees the horde deck JSON, so the committed art URLs stay on WebP', () => {
    const horde = Object.entries(sources).filter(([path]) => /horde\/decks\/.*\.json$/.test(path));
    expect(horde.length).toBeGreaterThan(0);
    for (const [, content] of horde) expect(content).toContain('cards.scryfall.io/grid/');
  });
});
