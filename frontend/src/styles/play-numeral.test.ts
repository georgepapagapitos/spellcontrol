/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { paletteForIndex, SEAT_PALETTE_COUNT } from '../lib/seat-palette';

const here = dirname(fileURLToPath(import.meta.url));
const board = readFileSync(join(here, 'play-board.css'), 'utf8');
const identity = readFileSync(join(here, 'play-history-inline.css'), 'utf8');

/**
 * The life numeral was always white. On the W (amber) seat that measured
 * 1.8:1 against the spotlit mid-tone, so the number a table reads from across
 * the room was the least legible thing on the board. Each seat now takes
 * black or white ink, whichever has the better worst case across its base and
 * the base/edge mid-tone. This recomputes that choice for every palette, so a
 * new or re-tuned colour cannot ship with the wrong ink.
 */

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mid = (a: string, b: string) =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');

/** Worst-case contrast of an ink across the panel's base and mid-tone. */
const worst = (ink: string, base: string, edge: string) =>
  Math.min(contrast(ink, base), contrast(ink, mid(base, edge)));
const bestInk = (base: string, edge: string) =>
  worst('#000000', base, edge) > worst('#ffffff', base, edge) ? 'dark' : 'light';

// the dark-ink selector list in play-board.css: `.player-panel:is(...)`
const darkList = (() => {
  const m = board.match(
    /\.player-panel:is\(([^)]*)\):not\(\s*\.is-winner,\s*\.is-eliminated\s*\)\s*\{\s*--pp-ink: #000;/
  );
  if (!m) throw new Error('dark-ink rule is missing from play-board.css');
  return m[1].split(',').map((s) => s.trim());
})();

describe('seat ink', () => {
  it('every seat-palette entry declares the ink with the better contrast, at 4:1 or more', () => {
    for (let i = 0; i < SEAT_PALETTE_COUNT; i++) {
      const p = paletteForIndex(i);
      expect(p.ink, `palette ${p.base}`).toBe(bestInk(p.base, p.edge));
      const ink = p.ink === 'dark' ? '#000000' : '#ffffff';
      expect(worst(ink, p.base, p.edge), `palette ${p.base}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('every identity colour is in the dark-ink list exactly when black reads better', () => {
    const blocks = [
      ...identity.matchAll(/\.pp-color-(\w) \{\s*--pp-base: (#\w{6});\s*--pp-edge: (#\w{6});/g),
    ];
    expect(blocks.map((b) => b[1]).sort()).toEqual(['b', 'c', 'g', 'm', 'r', 'u', 'w']);
    for (const [, key, base, edge] of blocks) {
      const ink = bestInk(base, edge);
      expect(darkList.includes(`.pp-color-${key}`), `.pp-color-${key}`).toBe(ink === 'dark');
      const hex = ink === 'dark' ? '#000000' : '#ffffff';
      expect(worst(hex, base, edge), `.pp-color-${key}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('seat-palette panels opt in through pp-ink-dark', () => {
    expect(darkList).toContain('.pp-ink-dark');
  });

  it('the numeral, ± and name read the ink rather than a fixed white', () => {
    for (const sel of [
      '.player-panel-life {',
      '.player-panel-step-btn {',
      '.player-panel-name {',
    ]) {
      const start = board.indexOf(`\n${sel}`);
      expect(start, sel).toBeGreaterThan(-1);
      const rule = board.slice(start, board.indexOf('\n}', start));
      expect(rule, sel).toContain('color: var(--pp-ink);');
    }
  });
});

/**
 * The numeral used to be sized off the viewport, one clamp per player count,
 * so a 3p/4p seat on a phone drew a 62px number in a 370px panel (Lotus fills
 * about 40%). It now reads --life-size, a share of the panel's own cell, and
 * a sideways seat reads that cell with its axes swapped.
 */
describe('numeral size', () => {
  it('the numeral, its ± and their spacing all derive from --life-size', () => {
    expect(board).toContain('--life-size: min(60cqh, 38cqw);');
    expect(board).toContain('--life-size: min(60cqw, 38cqh);');
    expect(board).toContain('font-size: calc(var(--life-size) * var(--life-scale, 1));');
    expect(board).toContain('font-size: calc(var(--life-size) * 0.32);');
    expect(board).toContain('--life-half: calc(var(--life-size) * 0.72);');
  });

  it('a short panel shrinks the numeral off its SHORT side, whichever way it is turned', () => {
    // Fixed 44px corner chips leave a 148px seat no room for 60%. A sideways
    // panel's short side is its cell's width, an upright one's its height.
    expect(board).toMatch(
      /@container \(max-width: 10rem\) \{\s*\.game-board:not\(\.game-board-2\) \.player-panel\[data-sideways\] \{\s*--life-size: min\(40cqw, 38cqh\);/
    );
    expect(board).toMatch(
      /@container \(max-height: 12rem\) \{\s*\.game-board:not\(\.game-board-2\) \.player-panel:not\(\[data-sideways\]\) \{\s*--life-size: min\(42cqh, 38cqw\);/
    );
  });

  it('the ± hug the numeral at every player count, never pinned to the panel ends', () => {
    // A sideways seat keeps its corner controls at the panel ends; 2p-side
    // pinned the ± there and ran them into ⋯ and the turn chip.
    expect(board).toContain('.player-panel-life-wrap > .player-panel-step-btn:first-of-type {');
    expect(board).toContain('.player-panel-life-wrap > .player-panel-step-btn:last-of-type {');
    expect(board).not.toMatch(/\.game-board-\d \.player-panel-life-wrap > \.player-panel-step-btn/);
    expect(board).not.toMatch(
      /\.player-panel-step-btn:(first|last)-child \{\s*(left|right): [\d.]+rem/
    );
  });

  it('no viewport or per-player-count size creeps back onto the numeral or ±', () => {
    expect(board).not.toMatch(/\.player-panel-life \{[^}]*vmin/);
    expect(board).not.toMatch(/\.game-board-\d \.player-panel-(life|step-btn) \{/);
    expect(board).not.toMatch(/--life-half: [\d.]+vmin/);
  });
});

// The board is an always-dark surface (white rings, near-black hub). Its
// ground used to follow the theme's --bg, which framed the seats in a pale
// border in every light theme.
describe('board ground', () => {
  it('is black in every theme', () => {
    const start = board.indexOf('\n.game-board {');
    const rule = board.slice(start, board.indexOf('\n}', start));
    expect(rule).toContain('background: #000;');
    expect(rule).not.toContain('var(--bg');
  });
});
