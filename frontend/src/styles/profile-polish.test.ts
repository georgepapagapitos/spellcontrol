// @vitest-environment node
/// <reference types="node" />
/**
 * Guards for the three profile defects the #2566 screenshot review found, so
 * they cannot come back as a stylesheet edit nobody eyeballs at the right width:
 *
 *  - the pinned deck rendered half-width with dead space beside it on desktop;
 *  - "Friends" beside Follow was drawn as a bordered pill, so it read as a
 *    second button though it does nothing;
 *  - five stats wrapped on a phone and orphaned the last ("37 copies").
 *
 * CSS `?raw` imports come back empty under this vite setup, so the sheets are
 * read off disk (spacing-ownership.test.ts does the same).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(src, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first rule whose selector list contains `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

/** The text of the first `@media` block whose query contains `query`. */
function media(css: string, query: string): string {
  const at = css.indexOf(`@media (${query})`);
  expect(at, `@media (${query}) exists`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', at) + 1, i);
  }
  throw new Error('unterminated @media');
}

describe('profile polish (T175)', () => {
  it('the pinned deck spans the row on desktop, art left and details right', () => {
    const desktop = media(read('components/decks/DeckLibrary.css'), 'min-width: 1024px');
    expect(desktop).toMatch(
      /deck-library-featured\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/
    );
    expect(desktop).toMatch(/is-featured \.decks-index-card-link\s*\{[^}]*display:\s*grid/);
    expect(desktop).toMatch(/is-featured \.decks-index-card-body\s*\{[^}]*grid-column:\s*2/);
  });

  it('the Friends label is a flat status: no border, no pill radius, no pointer', () => {
    const body = rule(read('components/profile/ProfileHeader.css'), '.public-profile-friend-chip');
    expect(body).not.toMatch(/\bborder\s*:/);
    expect(body).not.toMatch(/border-radius:\s*999px/);
    expect(body).toMatch(/cursor:\s*default/);
  });

  it('the phone stat line never wraps: one row of equal columns', () => {
    const phone = media(read('components/profile/ProfileHeader.css'), 'max-width: 599px');
    expect(phone).toMatch(/\.profile-stat-line\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(phone).toMatch(/\.profile-stat-line li\s*\{[^}]*flex:\s*1 1 0/);
  });
});
