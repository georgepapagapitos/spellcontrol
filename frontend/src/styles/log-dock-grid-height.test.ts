/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../playtest/components/LogDock.css'), 'utf8');

function block(header: string): string {
  const start = css.indexOf(header);
  expect(start, `${header} is missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

/**
 * The seat grid caps the log dock at a quarter-table height because in a 2x2
 * your quadrant is half as tall. A two-seat table is one row: your half is the
 * whole height, and the quarter cap left the log about 40px of feed under its
 * header, phase strip, chips and composer (seen live, 2026-09-24, with the
 * Table view open on Maya's first play and a chat line). The two-seat rule
 * must restore the full height, and must come AFTER the grid rule so it wins
 * at equal specificity.
 */
describe('log dock height in the seat grid', () => {
  it('keeps the quarter-height cap for the 2x2', () => {
    expect(block('.playtest-board:has(.playtest-main--grid) .playtest-log-dock {')).toContain(
      'max-height: min(26vh, 16rem)'
    );
  });

  it('gives a two-seat table the full-height dock back, after the grid rule', () => {
    const grid = css.indexOf('.playtest-board:has(.playtest-main--grid) .playtest-log-dock {');
    const two = css.indexOf('.playtest-board:has(.playtest-main--seats-2) .playtest-log-dock {');
    expect(two, 'two-seat rule is missing').toBeGreaterThan(-1);
    expect(two).toBeGreaterThan(grid);
    expect(block('.playtest-board:has(.playtest-main--seats-2) .playtest-log-dock {')).toContain(
      'max-height: min(60vh, 640px)'
    );
  });
});
