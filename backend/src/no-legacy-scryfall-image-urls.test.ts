import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: no backend source may carry a Scryfall card-image URL with a legacy
 * size segment. Scryfall removes the small / large / border_crop / art_crop
 * JPEGs on 2027-01-01 (and renames normal to jpeg), so a literal like
 * `cards.scryfall.io/art_crop/...` is a URL that goes 404.
 *
 * The size-segment knowledge lives in ONE place, `modernScryfallImage` in
 * `packages/deck-metrics/src/scryfall-images.ts`; every backend path gets its
 * URLs through `scryfall-images.ts` (ingress) or reads them off the card. To
 * test the mapping, write the URL in a `*.test.ts` file (tests are skipped).
 */
const LEGACY_SEGMENT = /cards\.scryfall\.io\/(small|normal|large|border_crop|art_crop)\//;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('no legacy Scryfall image segments in backend source', () => {
  it('no non-test source file names a retired size segment on the card CDN', () => {
    const root = path.join(__dirname);
    const offenders = sources(root)
      .filter((f) => LEGACY_SEGMENT.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(offenders, 'Use modernScryfallImage (@spellcontrol/deck-metrics) instead').toEqual([]);
  });

  it('the committed daily pool carries no retired-segment URL', () => {
    const pool = fs.readFileSync(path.join(root(), 'data', 'daily', 'pool.json'), 'utf8');
    expect(LEGACY_SEGMENT.test(pool)).toBe(false);
    expect(pool).toContain('cards.scryfall.io/art/');
  });
});

function root(): string {
  return path.join(__dirname, '..');
}
