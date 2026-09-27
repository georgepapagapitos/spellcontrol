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
 * The Retry is a `Button` now (T152 W8f), so its look and its floor come from
 * `.btn`, which declares the coarse floor itself (shared-control-floors.test.ts).
 * What this pins: every Retry in the strip renders as `Button`, never a raw
 * `<button>` that would fall back to a bare 32px box, and the class that seats
 * it in the strip lives in the global shared.css only, so it can't drift back
 * into one page's chunk.
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('load-failure strip touch floor', () => {
  it('renders every Retry as Button, which carries the 44px coarse floor', () => {
    const raw: string[] = [];
    let seen = 0;
    for (const path of tsxFiles(srcRoot)) {
      const src = readFileSync(path, 'utf8');
      for (const m of src.matchAll(/className="discover-decks-error-retry"/g)) {
        seen++;
        const open = src.lastIndexOf('<', m.index);
        if (!src.startsWith('<Button', open))
          raw.push(path.slice(srcRoot.length + 1).replace(/\\/g, '/'));
      }
    }
    expect(seen, 'the scan found no Retry at all').toBeGreaterThan(0);
    expect(raw, 'render the strip Retry as Button').toEqual([]);
  });

  it('declares the Retry pill in no stylesheet but shared.css', () => {
    const owners = cssFiles(srcRoot)
      .filter((path) => readFileSync(path, 'utf8').includes('.discover-decks-error-retry'))
      .map((path) => path.slice(srcRoot.length + 1).replace(/\\/g, '/'));
    expect(owners).toEqual(['styles/shared.css']);
  });
});
