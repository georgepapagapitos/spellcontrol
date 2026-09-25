/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The cube store loads at boot. A VALUE import of the cube generator from it
 * puts the generator, its mined targets, the refiner and the objective into
 * the entry's boot graph: +16 KB gzipped the one time it happened (board T150),
 * well inside the boot budget's headroom, so the budget alone would not catch
 * it. Shared classifiers come from the leaf `lib/cube/core`; the generator's
 * types are fine (erased at compile time).
 */
describe('the cube store keeps the generator out of the boot graph', () => {
  it('imports lib/cube/generate for types only', () => {
    const src = readFileSync(join(here, 'cube.ts'), 'utf8');
    const valueImports = src
      .split('\n')
      .filter(
        (l) => /^import\s+(?!type\b)/.test(l) && /lib\/cube\/(generate|refine|objective)'/.test(l)
      );
    expect(valueImports).toEqual([]);
  });
});
