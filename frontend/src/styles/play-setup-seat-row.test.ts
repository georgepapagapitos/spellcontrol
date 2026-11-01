/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const setup = readFileSync(join(here, 'play-setup.css'), 'utf8');

/** The body of the `@container seat-roster (…)` block, braces balanced. */
function narrowBlock(): string {
  const start = setup.search(/@container\s+seat-roster\s*\(max-width:[^)]*\)\s*\{/);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = setup.indexOf('{', start); i < setup.length; i++) {
    if (setup[i] === '{') depth++;
    else if (setup[i] === '}' && --depth === 0) return setup.slice(start, i + 1);
  }
  throw new Error('unbalanced @container block');
}

/** Every quoted row of every grid-template-areas in the block. */
function areaRows(block: string): string[][] {
  return [...block.matchAll(/grid-template-areas:([^;]*);/g)].map((m) =>
    [...m[1].matchAll(/'([^']*)'/g)].map((r) => r[1])
  );
}

/**
 * A phone-width seat row (who + name + deck + remove) used to be one wrapping
 * flex line, so a seat with a picked deck pushed the remove × onto a line of
 * its own (reported 2026-10-16 off a Galaxy S25+). Narrow rosters now lay the
 * seat out as two fixed rows: these pin that the × shares the top row with
 * the name and the deck always takes the second.
 */
describe('play setup seat row at narrow widths', () => {
  it('the roster is the size container the seat row queries', () => {
    expect(setup).toMatch(
      /\.play-setup-roster\s*\{[^}]*container:\s*seat-roster\s*\/\s*inline-size/
    );
  });

  it('every narrow layout puts remove beside the name and the deck on its own row', () => {
    const layouts = areaRows(narrowBlock());
    // Signed in (who picker) and signed out.
    expect(layouts).toHaveLength(2);
    for (const [top, bottom] of layouts) {
      expect(top.split(/\s+/)).toEqual(expect.arrayContaining(['num', 'name', 'remove']));
      expect(top).not.toMatch(/\bdeck\b/);
      expect(bottom).toMatch(/\bdeck\b/);
      expect(bottom).not.toMatch(/\bremove\b/);
    }
  });

  it('each seat control is placed in a named area', () => {
    const block = narrowBlock();
    for (const [sel, area] of [
      ['.play-setup-seat-num', 'num'],
      ['.play-setup-seat-who', 'who'],
      ['.play-setup-seat-name', 'name'],
      ['.play-setup-seat-deck-add', 'deck'],
      ['.play-setup-seat-remove', 'remove'],
    ]) {
      const escaped = sel.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&');
      expect(block, sel).toMatch(
        new RegExp(`${escaped}\\s*(?:,[^{}]*)?\\{[^}]*grid-area:\\s*${area}\\b`)
      );
    }
  });
});
