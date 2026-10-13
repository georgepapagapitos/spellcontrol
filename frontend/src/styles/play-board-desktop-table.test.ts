/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DESKTOP_TABLE_QUERY } from '@/lib/play/desktop-table';

/**
 * Desktop is one device-sized table (STYLE_GUIDE play-table.md, "Play board:
 * desktop is one device-sized table"). GameBoard.tsx stops rotating seats
 * when DESKTOP_TABLE_QUERY matches and play-board.css caps the board's width
 * on the same query; if the two drift, the seats face the screen on a board
 * still stretched edge to edge, or rotate inside a narrow column.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-board.css'), 'utf8');

describe('desktop table query', () => {
  it('is textually identical in the CSS and the TS constant', () => {
    expect(css).toContain(`@media ${DESKTOP_TABLE_QUERY} {`);
  });

  it('caps the whole rotator, not just the seat grid, and never an upright-rotated board', () => {
    const m = css.match(/@media \(min-width: 1025px\) and \(pointer: fine\) \{([^}]*\{[^}]*\})/);
    expect(m?.[1]).toContain(':where(.game-board-rotator:not([data-board-rot]))');
    expect(m?.[1]).toMatch(/max-width:\s*48rem/);
  });

  it('leaves touch tablets alone: the query needs a fine pointer', () => {
    expect(DESKTOP_TABLE_QUERY).toContain('(pointer: fine)');
  });
});
