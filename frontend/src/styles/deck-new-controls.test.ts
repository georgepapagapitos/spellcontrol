/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Two new-deck controls, measured in a real browser at 390px and by keyboard:
 *
 * - The build-method cards sat two to a row on a phone, so their titles broke
 *   mid-phrase ("By / art") against their SCRYFALL tags. One column below the
 *   tablet tier, two from 600px.
 * - The customizer's sliders showed focus only as the thumb growing 10%, the
 *   same as hover, and Firefox had no focus rule at all. Focus is a ring on the
 *   thumb, in both engines.
 * - The generator's build bar is sticky chrome at the foot of `.app-main`:
 *   `bottom: 0` (the scroller already ends at the tab bar's top; a tab-bar
 *   offset double-counts it, see OnlineGameView.css `.ogv-you`), the sticky
 *   chrome z-token, and an opaque surface the settings scroll under.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  readFileSync(join(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('new-deck controls', () => {
  it('stacks the build-method cards on phones', () => {
    const css = read('../components/deck/GenerationModePicker.css');
    const base = css.match(/(^|\n)\.gen-mode-grid\s*\{([^}]*)\}/)?.[2] ?? '';
    expect(base).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    const tablet = css.match(
      /@media\s*\(min-width:\s*600px\)\s*\{\s*\.gen-mode-grid\s*\{([^}]*)\}/
    )?.[1];
    expect(tablet).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('rings the focused slider thumb in both engines', () => {
    const css = read('deck-builder-customizer.css');
    for (const thumb of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      const sel = `.deck-customizer-range:focus-visible${thumb}`.replace(/[.:]/g, (c) => `\\${c}`);
      const body = css.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(body, thumb).toMatch(/box-shadow:[^;]*var\(--accent\)/);
    }
  });

  it('pins the build bar to the scroller foot as opaque sticky chrome', () => {
    const css = read('../pages/DeckGeneratePage.css');
    const bar = css.match(/(^|\n)\.deck-generate-bar\s*\{([^}]*)\}/)?.[2] ?? '';
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/bottom:\s*0\s*;/);
    expect(bar).toMatch(/z-index:\s*var\(--z-popover\)/);
    expect(bar).toMatch(/background:\s*var\(--surface-raised\)/);
  });
});
