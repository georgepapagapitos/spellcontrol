/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(src, f), 'utf8');

/**
 * The online host form (UX pass PS-01, DK-07):
 *  - On the desktop grid every direct child of the form needs a grid-area, or
 *    it auto-places ahead of the areas and visual order stops matching the
 *    DOM and tab order (Visibility rendered above Format and Name).
 *  - Format and Name share one label-above pattern; Format used to be inline
 *    beside its label while Name wrapped under its own.
 */
describe('online host form', () => {
  const tsx = read('pages/play/OnlineSetup.tsx');
  const css = read('styles/play-setup.css');

  it('places the visibility section in a named grid area', () => {
    expect(tsx).toMatch(/play-setup-row play-setup-visibility/);
    const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
    expect(desktop).toMatch(
      /\.play-setup-form-grid > \.play-setup-visibility\s*\{[^}]*grid-area:\s*rules/
    );
  });

  it('stacks the Format and Name labels the same way', () => {
    const game = tsx.slice(tsx.indexOf('play-setup-game'), tsx.indexOf('play-setup-visibility'));
    expect(game).toContain('<span>Format</span>');
    expect(game).toContain('<span>Name</span>');
    expect(game).not.toContain('play-field-inline');
  });
});
