/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');
const board = readFileSync(join(here, '..', 'playtest', 'components', 'PlaytestBoard.tsx'), 'utf8');

/**
 * The moving copy of a TAPPED card has to sit where the card you grabbed is.
 *
 * dnd-kit sizes the <DragOverlay> wrapper from the source card's measured
 * box. A tapped permanent carries `rotate(90deg)`, so that box is the ROTATED
 * one — width and height swapped. The copy inside keeps the printed card's own
 * size and rotates about its own centre, so left at the wrapper's top-left it
 * lands half the width/height difference off the card under the pointer.
 *
 * The other half of that bug is in `PlaytestBoard`'s `measuring` prop, which
 * takes dnd-kit off its transform-agnostic measurement (it reads a rotation
 * matrix as a zero scale and hands back a box half a card away). Both halves
 * are needed; this guard covers the centring.
 *
 * Centring the copy in the wrapper puts its rotated box exactly where the
 * source's was, and is a no-op for an untapped card (the two boxes are the
 * same). This guard is on the pair — the class has to carry the centring AND
 * the overlay has to still be wearing the class — because either half alone
 * brings the offset back.
 */
describe('dragging a tapped card', () => {
  const rule = /\.playtest-drag-overlay\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('centres the copy in the wrapper dnd-kit sizes', () => {
    expect(rule).toMatch(/display\s*:\s*grid/);
    expect(rule).toMatch(/place-items\s*:\s*center/);
  });

  it('measures the box the browser paints, not an inverted one', () => {
    // dnd-kit's default measurement inverts the element's own transform, and
    // it reads a rotation matrix's `a`/`d` as scaleX/scaleY — both 0 for
    // `rotate(90deg)`, so a tapped card measures half a card up and to the
    // left of itself. That moves the drag copy AND the attach-drop hit box.
    expect(board).toMatch(/measure:\s*getClientRect/);
    expect(board).toMatch(/<DndContext[\s\S]{0,400}?measuring=\{measuring\}/);
  });

  it('wears the centring class on the DragOverlay itself, not the card', () => {
    // `<DragOverlay ` with the trailing space: the file also talks about
    // `<DragOverlay>` in prose, which carries no props to check.
    const overlay = /<DragOverlay [^>]*>/.exec(board)?.[0] ?? '';
    expect(overlay).toContain('playtest-drag-overlay');
  });
});
