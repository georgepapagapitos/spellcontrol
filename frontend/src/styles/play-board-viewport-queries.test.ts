/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Board-internal sizing reads the BOARD, never the physical viewport.
 *
 * "Keep the board still" (play-board.css, `[data-board-rot]`) turns the whole
 * board 90° inside a landscape phone, so the board's own width is the screen's
 * height. An 844x390 phone lays the seats out in a 390-wide board, but a
 * `min-width: 600px` media query still matched the 844px screen: the 7-10
 * player seats got desktop-sized names that landed on their numerals (94
 * text-on-text hits per orientation in commander focus, zero in portrait).
 *
 * So every width/height media query in a board stylesheet must say which
 * board it is about: scoped to an unrotated board (`:not([data-board-rot])`),
 * or to a rotated one with the swapped query (`[data-board-rot]`). The keep-
 * still query itself is exempt, as is the one off-board block (the door
 * card on the play page). A new board rule that reads the viewport fails here
 * with its selector.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FILES = [
  'play-board.css',
  'play-panel-menus.css',
  'play-enhancements.css',
  'play-counters-panel.css',
  'play-effects.css',
  '../components/play/BoardHighRoll.css',
  '../components/play/BoardHubMenu.css',
];
const OFF_BOARD = /^\.play-board-door\b/;

/** Top-level `@media` blocks: [prelude, body]. */
function mediaBlocks(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /@media([^{]*)\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push([m[1].trim(), css.slice(re.lastIndex, i - 1)]);
    re.lastIndex = i;
  }
  return out;
}

/** Every selector of every rule in a block body, split on top-level commas. */
function selectors(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/([^{};]+)\{[^{}]*\}/g)) {
    let depth = 0;
    let start = 0;
    const sel = m[1];
    for (let i = 0; i <= sel.length; i++) {
      const ch = sel[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if ((ch === ',' && depth === 0) || i === sel.length) {
        const s = sel.slice(start, i).trim();
        if (s) out.push(s);
        start = i + 1;
      }
    }
  }
  return out;
}

describe('board stylesheets never size the board off the physical viewport', () => {
  for (const file of FILES) {
    it(`${file}: every width/height media query is scoped to the board's rotation`, () => {
      const css = readFileSync(join(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const unscoped: string[] = [];
      for (const [prelude, body] of mediaBlocks(css)) {
        if (!/(width|height)/.test(prelude)) continue;
        if (/orientation:\s*landscape/.test(prelude)) continue; // the keep-still query
        for (const sel of selectors(body)) {
          if (OFF_BOARD.test(sel) || sel.includes('data-board-rot')) continue;
          unscoped.push(`@media ${prelude} { ${sel} }`);
        }
      }
      expect(unscoped, 'scope it with :where(.game-board-rotator:not([data-board-rot]))').toEqual(
        []
      );
    });
  }

  it('a query whose answer flips under rotation gives the rotated board the swapped query', () => {
    // Subtitles hide on a narrow board of 3+ seats or on any short board. A
    // rotated board's width is the screen's height, and its height the width.
    const css = readFileSync(join(here, 'play-board.css'), 'utf8');
    const block = (prelude: string) =>
      mediaBlocks(css)
        .find(([p, b]) => p === prelude && b.includes('.player-panel-subtitle'))?.[1]
        .replace(/\s+/g, ' ');
    // Narrow board: every rotated board (its height is the narrow screen width).
    expect(block('(max-width: 480px)')).toMatch(
      /, :where\(\.game-board-rotator\[data-board-rot\]\) \.player-panel-subtitle/
    );
    // Short screen: a rotated board of 3+ seats (its width is the short height).
    expect(block('(max-height: 480px)')).toMatch(
      /\.game-board:not\(\.game-board-2\) :where\(\.game-board-rotator\[data-board-rot\]\) \.player-panel-subtitle/
    );
  });

  it("the game menu takes the rotated board's own height, not the landscape dvh", () => {
    const css = readFileSync(join(here, 'play-panel-menus.css'), 'utf8');
    expect(css).toMatch(
      /\.game-board-rotator\[data-board-rot\] \.game-menu \{\s*max-height: 88cqw;/
    );
  });
});
