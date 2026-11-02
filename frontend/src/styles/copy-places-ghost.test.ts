/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// E1079: the copy-places trigger on a collection tile is 24px tall, and its
// 44px touch target is an ::after ghost. The ghost was centered on the
// trigger, so it overhung the trigger by 10px on every side; the tile foot
// sits only --space-1-5 (6px) above the tile edge and the tile is
// overflow:hidden, so 4px of the ghost was clipped and the journey measured
// the hit area at 41px. The ghost may hang below the trigger by no more than
// the foot's own inset; the rest of the 44px has to grow upward.
//
// Read off disk: CSS `?raw` imports come back empty under this setup.
const read = (rel: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );
const rulesOf = (css: string) =>
  [...css.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);

const places = rulesOf(read('components/shared/CopyPlaces.css'));
const collection = rulesOf(read('styles/collection.css'));

const ghost = places.find(([s]) => s === '.copy-places-trigger--art::after')?.[1] ?? '';
const foot = collection.find(([s]) => s === '.collection-grid-foot')?.[1] ?? '';

describe('the copy-places touch-target ghost on a tile foot', () => {
  it('finds both rules', () => {
    expect(ghost, 'the coarse-pointer ghost rule').not.toBe('');
    expect(foot, 'the tile foot rule').not.toBe('');
  });

  it('is not centered on the trigger, which overhangs the foot inset on both sides', () => {
    expect(ghost).not.toMatch(/translate\(\s*-50%\s*,\s*-50%\s*\)/);
    expect(ghost).not.toMatch(/\btop:\s*50%/);
  });

  it('hangs below the trigger by no more than the foot inset, where the tile clips', () => {
    const footBottom = foot.match(/\bbottom:\s*([^;]+);/)?.[1].trim();
    expect(footBottom).toBe('var(--space-1-5)');
    const ghostBottom = ghost
      .match(/\bbottom:\s*([^;]+);/)?.[1]
      .replace(/\s+/g, ' ')
      .trim();
    expect(ghostBottom, 'anchored to the trigger bottom, overhanging by the inset').toBe(
      `calc(${footBottom} * -1)`
    );
  });

  it('is still 44px tall', () => {
    expect(ghost).toMatch(/height:\s*max\([^;]*44px\)/);
  });
});
