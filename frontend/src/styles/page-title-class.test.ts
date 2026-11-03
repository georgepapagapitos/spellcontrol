/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(src, f), 'utf8');

/**
 * A page's h1 is the shared page title (`.binder-hero-name`, STYLE_GUIDE §
 * Rulings for --font-display). Card search and Compare decks shipped with
 * bold body text while every sibling page used the display face (UX pass
 * SHS-08 / DK-13).
 */
describe('page h1s use the shared page-title class', () => {
  for (const [file, h1] of [
    ['pages/SearchPage.tsx', /<h1 className="binder-hero-name"[^>]*>Card search<\/h1>/],
    ['pages/DeckComparePage.tsx', /<h1 className="binder-hero-name deck-compare-heading">/],
  ] as const) {
    it(`${file} h1 carries .binder-hero-name`, () => {
      expect(read(file)).toMatch(h1);
    });
  }

  it('neither page restyles the h1 font size or color', () => {
    expect(read('pages/SearchPage.css')).not.toMatch(/search-page-head h1\s*\{/);
    const compare = /\.deck-compare-heading[^{]*\{([^}]*)\}/.exec(
      read('pages/DeckComparePage.css')
    );
    expect(compare?.[1]).not.toMatch(/font-size|color:/);
  });
});
