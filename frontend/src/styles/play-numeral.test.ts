/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { paletteForIndex, SEAT_PALETTE_COUNT } from '../lib/seat-palette';

const here = dirname(fileURLToPath(import.meta.url));
const board = readFileSync(join(here, 'play-board.css'), 'utf8');
const identity = readFileSync(join(here, 'play-history-inline.css'), 'utf8');
const counters = readFileSync(join(here, 'play-counters-panel.css'), 'utf8');

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
    // 44, not 38 (gestures audit, 2026-09-25): Bebas Neue's condensed digits
    // made the width axis cheap, the same reasoning E416 used to raise the
    // 7-10p tier below. 4p-pod / 5p / 6p's non-wide seats went 56px -> 65px
    // (320px) / 70px -> 81px (390px) / 77px -> 89px (430px) with zero new
    // overlap on any 2-10p preset (life-board-probe.mjs).
    expect(board).toContain('--life-size: min(60cqh, 44cqw);');
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
    // Stayed at 38, unlike the base rule above: 5p/6p's 155px-tall cell at
    // 320px lands in THIS tier, and even 39 here put the "up next"
    // designation chip into the numeral (measured) — no headroom to match
    // the base rule's 44 without also condensing the chip rail.
    expect(board).toMatch(
      /@container \(max-height: 12rem\) \{\s*\.game-board:not\(\.game-board-2\) \.player-panel:not\(\[data-sideways\]\) \{\s*--life-size: min\(42cqh, 38cqw\);/
    );
  });

  it('a 7-10 player board shrinks the numeral further on its ~90-145px cells', () => {
    // 7-10 players push rows to 4-5, so a 320-390px-wide board's cells are
    // shorter than the 42% tier above was tuned for. This tier is placed
    // AFTER the 12rem one so it wins where both match. 9.5rem (not 9rem): a
    // 390px-wide 9p/10p board measures 145px, 1px past the old 9rem cut,
    // which silently left it in the 12rem tier with no name-condensing
    // (E416) — see the CSS comment for the measured overlap this closed.
    expect(board).toMatch(
      /@container \(max-height: 9\.5rem\) \{\s*\.game-board:not\(\.game-board-2\) \.player-panel:not\(\[data-sideways\]\) \{\s*--life-size: min\(38cqh, 55cqw\);/
    );
  });

  it('that same tier condenses the name, or the numeral shrink alone leaves it grazing the numeral', () => {
    // E416: the name's own font never shrank with the panel, so on a
    // 90-145px cell the corner keep-out alone can't clear a fixed ~23px-tall
    // label from the centred numeral — measured as a real overlap (up to
    // 450px², always the name, never a badge or chip) at every 7-10p preset.
    const tierStart = board.indexOf('@container (max-height: 9.5rem)');
    expect(tierStart, '9.5rem tier is missing').toBeGreaterThan(-1);
    // The container's own (unindented) closing brace — its two inner rule
    // bodies are indented, so their own `}` lines don't match this.
    const tierEnd = board.indexOf('\n}\n', tierStart);
    const tier = board.slice(tierStart, tierEnd);
    expect(tier).toContain(
      '.game-board:not(.game-board-2) .player-panel:not([data-sideways]) .player-panel-name {'
    );
    expect(tier).toMatch(/font-size:\s*calc\(var\(--text-xs\) \* 0\.6\)/);
  });

  it('the same short-cell tier also shrinks the designation chip rail (Monarch/Initiative/Up next)', () => {
    // E416: the chip rail sits at the opposite (top-right) corner, anchored
    // by the same unconditional seam-keepout, and its fixed 28px size reached
    // down into the ± step button's vertical band on the same ~90-145px
    // cells (measured as STEP-HITS, never zero until this shrank too).
    const tierStart = counters.indexOf('@container (max-height: 9.5rem)');
    expect(tierStart, '9.5rem chip tier is missing from play-counters-panel.css').toBeGreaterThan(
      -1
    );
    const tier = counters.slice(tierStart, counters.indexOf('\n}\n', tierStart));
    expect(tier).toContain(
      '.game-board:not(.game-board-2) .player-panel:not([data-sideways]) .pp-designation-chip {'
    );
    expect(tier).toMatch(/width:\s*1rem/);
    expect(tier).toMatch(/height:\s*1rem/);
  });

  it('a sideways 7-10p seat (Xp-sides/Xp-ends) gets the same short-cell treatment as an upright one', () => {
    // The 9.5rem tier above only ever shrank the sideways numeral (the
    // width-keyed `max-width: 10rem` rule) — never the ±'s reach, the name,
    // or the chip rail. Measured before this: the ± spilling 3-6px past a
    // 74-115px-tall cell's short half-width, the name ellipsising to "Pla…"
    // (10p-sides @320, no upright seat exists to fall back on there), and
    // the "up next" chip grazing the name (335-478px²). This override is a
    // SECOND `@container (max-height: 9.5rem)` block, placed after
    // `.player-panel-corner`'s own rule rather than folded into the first
    // (upright) block above — play-touch-targets.test.ts's search for the
    // base corner rule needs to find that one first, not this override.
    const firstEnd = board.indexOf('\n}\n', board.indexOf('@container (max-height: 9.5rem)'));
    const tierStart = board.indexOf('@container (max-height: 9.5rem)', firstEnd);
    expect(tierStart, 'second (sideways) 9.5rem tier is missing').toBeGreaterThan(-1);
    const tier = board.slice(tierStart, board.indexOf('\n}\n', tierStart));
    expect(tier).toContain('.game-board:not(.game-board-2) .player-panel[data-sideways] {');
    expect(tier).toMatch(/--life-half:\s*calc\(var\(--life-size\)\s*\*\s*0\.48\)/);
    expect(tier).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .player-panel-name {'
    );
    expect(tier).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .player-panel-corner {'
    );
    expect(tier).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .player-panel-step-btn {'
    );
  });

  it('the sideways chip rail shrinks in the same 9.5rem tier too', () => {
    const tierStart = counters.indexOf('@container (max-height: 9.5rem)');
    const tier = counters.slice(tierStart, counters.indexOf('\n}\n', tierStart));
    expect(tier).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .pp-designation-chip {'
    );
  });

  it("9p-ends/10p-ends' 74px sideways cells (rows=6, the tallest row count) get one tier further", () => {
    // Even at the 9.5rem tier's values, the shortest row count (6, only
    // 9p-ends/10p-ends need it) still left a name/chip residual — a second,
    // narrower container query, placed after the 9.5rem one so it wins
    // where both match, and scoped to [data-sideways] so it never touches
    // the 90-115px sideways cells (or anything upright) the 9.5rem tier
    // already clears on its own.
    const boardTier = board.slice(board.indexOf('@container (max-height: 6rem)'));
    expect(boardTier.slice(0, boardTier.indexOf('\n}\n'))).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .player-panel-name {'
    );
    const countersTierStart = counters.indexOf('@container (max-height: 6rem)');
    expect(countersTierStart, '6rem tier is missing from play-counters-panel.css').toBeGreaterThan(
      -1
    );
    const countersTier = counters.slice(
      countersTierStart,
      counters.indexOf('\n}\n', countersTierStart)
    );
    expect(countersTier).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .pp-designation-chips {'
    );
    expect(countersTier).toContain(
      '.game-board:not(.game-board-2) .player-panel[data-sideways] .pp-designation-chip {'
    );
    // The rail's own corner offset shrinks but keeps --seam-keepout intact —
    // that term is what keeps this corner clear of the hub/undo satellites
    // (E299/E310), unrelated to how short the cell is.
    expect(countersTier).toMatch(/top:\s*calc\([\d.]+rem \+ var\(--seam-keepout, 0px\)\)/);
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
