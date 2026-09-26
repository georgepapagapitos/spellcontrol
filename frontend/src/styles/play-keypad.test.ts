/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-effects.css'), 'utf8');

/**
 * The life keypad is a BOARD-LEVEL dialog now (Lotus's model), not an
 * in-panel cover — it dims and covers the whole board and rotates to face
 * the seat it's for, rendered by `GameBoard` rather than inside any one
 * `.player-panel`. This replaced the old in-panel cover, whose ~160px of
 * fixed chrome above a `1fr` digit grid collapsed to 2-16px keys on any seat
 * under ~300px (every seat of 4p-sides, the default four-player board, among
 * others — playtest batch 7, measured with b7-keypad-layouts.mjs). A
 * board-level dialog is sized off the viewport instead, so it's never
 * constrained by one seat's cell.
 */
describe('life keypad is a board-level dialog', () => {
  /** The body of the first `{...}` block whose selector line contains `needle`. */
  const block = (needle: string) => {
    const at = css.indexOf(needle);
    expect(at, `"${needle}" is missing`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  };

  it('dims and covers the whole board, not one panel', () => {
    const backdrop = block('.life-keypad-backdrop {');
    expect(backdrop).toMatch(/position:\s*absolute/);
    expect(backdrop).toMatch(/inset:\s*0/);
    // No longer scoped inside .player-panel at all.
    expect(css).not.toMatch(/\.player-panel\s*\.life-keypad/);
    expect(css).not.toMatch(/\.player-panel\[data-sideways\]\s*\.life-keypad/);
  });

  it('is sized off the viewport, never a panel/cell container query', () => {
    const dialog = block('.life-keypad {');
    expect(dialog).toMatch(/vw|vh/);
    // The old short-panel container queries are gone with the in-panel cover.
    expect(css).not.toContain('@container (max-width: 300px)');
    expect(css).not.toContain('@container (max-height: 300px)');
  });

  it('rotates to face its seat, swapping axes for a sideways (90/270) seat', () => {
    const dialog = block('.life-keypad {');
    // Centred by its own position + transform (not flexbox — a flex parent
    // shrank a rotated dialog's deliberately-larger local width to fit its
    // own available WIDTH, since layout happens before the rotate() below
    // swaps the axes back; measured 14px-wide digit keys before this fix).
    expect(dialog).toMatch(/position:\s*absolute/);
    expect(dialog).toMatch(/transform:\s*translate\([^)]*\)\s*rotate\(var\(--keypad-rot/);
    // `height`, not only `max-height` — a flex column with no explicit
    // height sizes to its content, so the digit grid's flexible row never
    // grew to use the room it was given (measured 39-41px keys).
    expect(dialog).toMatch(/\n\s*height:\s*var\(--keypad-h\);/);
    const rotated = block("[data-rot='90'],");
    // Width/height swapped, same trick as .player-panel[data-sideways].
    expect(rotated).toMatch(/width:\s*var\(--keypad-h\)/);
    expect(rotated).toMatch(/height:\s*var\(--keypad-w\);/);
    expect(rotated).toMatch(/max-height:\s*var\(--keypad-w\)/);
  });

  it('the rotated (sideways) layout is a row — display/Set beside the grid, not stacked above it', () => {
    const rotated = block("[data-rot='90'],");
    // The digit grid is 6 LOCAL columns, which become the SCREEN HEIGHT axis
    // after a 90°/270° rotation — column 2 needs the bulk of the width split
    // (4fr vs the head/display/confirm column's 1fr), and the grid spans all
    // three local rows, or its share of local width/height was too small
    // for a 44px key on either axis (measured 14-41px, both tried).
    expect(rotated).toContain("'head grid'");
    expect(rotated).toContain("'display grid'");
    expect(rotated).toContain("'confirm grid'");
    expect(rotated).toMatch(/grid-template-columns:\s*minmax\([^)]+\)\s*4fr/);
    const rotatedGrid = block('.life-keypad-grid,');
    expect(rotatedGrid).toContain('grid-template-columns: repeat(6, 1fr)');
  });

  it('every digit key holds the 44px coarse-pointer floor by default', () => {
    // The leading newline picks the standalone base rule, not the compound
    // `[data-rot='270'] .life-keypad-grid {` selector a bare substring match
    // would also hit.
    const grid = block('\n.life-keypad-grid {');
    expect(grid).toMatch(/grid-auto-rows:\s*minmax\(44px/);
  });
  it('pops in facing its seat: the entrance animates `scale`, never `transform`', () => {
    // A transform in a keyframe replaces the dialog's own translate+rotate
    // for the animation's length: it opened unrotated and off-centre, then
    // snapped to its seat.
    const at = css.indexOf('@keyframes pp-scale-in');
    const body = css.slice(at, css.indexOf('\n}\n', at));
    expect(body).toMatch(/\bscale:\s*0\.92/);
    expect(body).not.toContain('transform');
  });

  it('the close button never shrinks under a long title', () => {
    expect(block('.life-keypad-close {')).toMatch(/flex:\s*0 0 auto/);
    const title = block('.life-keypad-title {');
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/min-width:\s*0/);
  });
  it("sized in the board's own axes when a phone on its side keeps the board still", () => {
    // vw/vh stay the physical landscape viewport while the keypad sits in the
    // counter-rotated board: a sideways seat's keypad ran ~80px off an
    // 844x390 screen. .game-board is the size container in that same query.
    const at = css.indexOf('.game-board-rotator[data-board-rot] .life-keypad {');
    expect(at).toBeGreaterThan(-1);
    expect(
      css.lastIndexOf(
        '@media (orientation: landscape) and (max-height: 500px) and (pointer: coarse)',
        at
      )
    ).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at));
    expect(body).toMatch(/--keypad-w:\s*min\(94cqh/);
    expect(body).toMatch(/--keypad-h:\s*min\(78cqw/);
  });
});
