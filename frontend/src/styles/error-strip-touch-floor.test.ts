/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

/**
 * The load-failure strip (`.discover-decks-error` + its Retry pill) is shared
 * by Discover, Saved decks, the Trending rail, Play, game nights, both combo
 * surfaces and more. Its Retry pill is a fixed 2rem (32px), so it needs the
 * coarse-pointer 44px floor, and that floor lived in DiscoverDecksPage.css.
 * Every surface whose page never loaded Discover's stylesheet (the Welcome
 * page's Trending rail, Play, game nights) shipped a 32px touch target.
 *
 * The floor belongs with the strip, in the global shared.css, and nowhere
 * else, so it can't drift back into one page's chunk.
 */

/** Bodies of every `@media (pointer: coarse)` block in the sheet, joined. */
function coarseBlocks(sheet: string): string {
  const out: string[] = [];
  const re = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sheet))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < sheet.length && depth > 0) {
      if (sheet[i] === '{') depth++;
      else if (sheet[i] === '}') depth--;
      i++;
    }
    out.push(sheet.slice(start, i - 1));
  }
  return out.join('\n');
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('load-failure strip touch floor', () => {
  it('floors the Retry pill at 44px on touch, in shared.css', () => {
    const shared = readFileSync(join(here, 'shared.css'), 'utf8');
    expect(coarseBlocks(shared)).toMatch(
      /\.discover-decks-error-retry\s*\{[^}]*min-height:\s*44px/
    );
  });

  it('declares the Retry pill in no stylesheet but shared.css', () => {
    const owners = cssFiles(srcRoot)
      .filter((path) => readFileSync(path, 'utf8').includes('.discover-decks-error-retry'))
      .map((path) => path.slice(srcRoot.length + 1).replace(/\\/g, '/'));
    expect(owners).toEqual(['styles/shared.css']);
  });
});
