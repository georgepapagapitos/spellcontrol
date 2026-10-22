// @vitest-environment node
/**
 * Guard: the "Fight a horde" sheet shows every horde's name on a phone on its
 * side (E1035).
 *
 * At 844x390 the sheet's body is ~150px between its header and the sticky
 * footer. Three 16:9 tiles a row put each tile's art at ~147px, so every name
 * sat below the fold and the sheet read as six pictures. The short-landscape
 * tier puts the tiles in one row with a shorter crop: measured, all six names
 * and the first row's tile bottoms (309px) clear the footer (321px).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'HordeSetupSheet.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/** The body of the short-landscape @media block (one level of nested rules). */
function shortLandscape(): string {
  const m =
    /@media \(max-height: 500px\) and \(orientation: landscape\) \{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/.exec(
      css
    );
  expect(m, 'HordeSetupSheet.css has a (max-height: 500px) landscape tier').not.toBeNull();
  return m![1];
}

function rule(body: string, selector: string): string {
  const m = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].trim() === selector);
  expect(m, `${selector} has a rule in the short-landscape tier`).toBeTruthy();
  return m![2];
}

describe('Fight a horde sheet on a phone on its side', () => {
  it('crops the tile art shorter than the 16:9 default', () => {
    const banner = rule(shortLandscape(), '.horde-setup-sheet .horde-tile-banner');
    const m = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(banner);
    expect(m, 'the banner sets an aspect-ratio').not.toBeNull();
    // Width over height: at least 2:1, against the default 16:9 (1.78).
    expect(Number(m![1]) / Number(m![2])).toBeGreaterThanOrEqual(2);
  });

  it('lays the tiles out narrower than three a row, so one row holds them all', () => {
    const grid = rule(shortLandscape(), '.horde-setup-sheet .horde-tile-grid');
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
  });

  it("wraps a five-color tile's badge under its pips instead of clipping it", () => {
    expect(rule(shortLandscape(), '.horde-setup-sheet .horde-tile-meta')).toMatch(
      /flex-wrap:\s*wrap/
    );
  });
});
