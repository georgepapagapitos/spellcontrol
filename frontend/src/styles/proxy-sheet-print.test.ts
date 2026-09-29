/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guards the proxy sheet's print geometry (ProxySheetPage.css).
//
// A card prints at 63 × 88 mm, nine to a page. The first build gave each page
// box 267 mm of height; Chrome fits no more than about 266.3 mm on Letter
// inside the sheet's 5 mm @page margins (measured with printToPDF: 266 mm fit,
// 266.5 mm did not), so every Letter print ended on a blank page. The box now
// has to stay under that, hold the full 264 mm grid, and keep the grid and the
// row crop marks on the same top offset.

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../pages/ProxySheetPage.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The first declaration block whose selector list names `selector`. */
function block(selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) return m[2];
  }
  throw new Error(`no rule for ${selector}`);
}

/** A declaration's first millimetre value. */
function mm(body: string, prop: string): number {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:[^;]*?([\\d.]+)mm`).exec(body);
  if (!m) throw new Error(`no ${prop} in mm`);
  return Number(m[1]);
}

const LETTER_FIT_MM = 266;

describe('proxy sheet print geometry', () => {
  const page = block('.proxy-print-page');
  const grid = block('.proxy-print-grid');
  const card = block('.proxy-print-card');

  it('prints each card at 63 × 88 mm, three by three', () => {
    expect(mm(card, 'width')).toBe(63);
    expect(mm(card, 'height')).toBe(88);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(3,\s*63mm\)/);
    expect(mm(grid, 'grid-auto-rows')).toBe(88);
  });

  it('fits a page box on Letter, so the last sheet is not followed by a blank page', () => {
    expect(mm(page, 'height')).toBeLessThanOrEqual(LETTER_FIT_MM);
  });

  it('holds the whole grid inside the page box, centred, with its crop marks aligned', () => {
    const top = mm(grid, 'top');
    expect(top + 3 * 88 + top).toBeCloseTo(mm(page, 'height'), 5);
    expect(block('.proxy-print-tick.is-row')).toContain(`calc(${top}mm + var(--edge) * 88mm)`);
  });
});
