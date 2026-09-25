/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'playtest.css'), 'utf8');

/**
 * Every card-menu row prints the key that does the same thing, which is how
 * the keyboard map is discovered. On a phone there is no keyboard, and the
 * bottom sheet carried "J", "+", "Ctrl 1" at the end of every row (the E361
 * phone sweep, 2026-09-24). Touch-only devices drop them; a touch laptop
 * still hovers, so it keeps them.
 */
describe('menu key hints on a touch-only device', () => {
  it('are hidden under (hover: none) and (pointer: coarse), and only there', () => {
    expect(css).toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*\.playtest-ctx-key\s*\{\s*display:\s*none;/
    );
    const base = /\n\.playtest-ctx-key\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).not.toMatch(/display:\s*none/);
  });
});
