/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');
const quadrant = readFileSync(
  join(here, '..', 'playtest', 'components', 'OpponentQuadrant.css'),
  'utf8'
);
const battlefield = readFileSync(
  join(here, '..', 'playtest', 'components', 'Battlefield.tsx'),
  'utf8'
);

/** The declarations of the first rule whose selector matches, whitespace collapsed. */
function rule(sheet: string, selector: string): string | null {
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split('\n').pop()!.trim();
    if (sel === selector) return m[2].replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * The board wears exactly ONE border, and it means "this is the board in play".
 *
 * The felt used to draw a dashed ring round itself whenever a card was being
 * dragged (`.playtest-battlefield.is-over`). It was chrome for something the
 * player cannot get wrong — the battlefield is the whole board and always the
 * destination, and the card already follows the pointer. Worse, it competed
 * with the one border that carries information: the gold turn ring.
 *
 * At a 2/3/4-seat table the same ring marks the active seat wherever it sits —
 * your own wrap here, an opponent's quadrant in `OpponentQuadrant.css`. The two
 * must stay identical or "whose turn" reads as two different things depending
 * on who is on turn.
 */
describe('the board’s turn ring', () => {
  it('is the same signal on your board and on an opponent quadrant', () => {
    const mine = rule(css, '.playtest-battlefield-wrap.is-my-turn');
    const theirs = rule(quadrant, '.opponent-quadrant.is-active-turn');
    expect(mine).not.toBeNull();
    expect(theirs).not.toBeNull();
    expect(mine).toBe(theirs);
  });

  it('reads at every width, not only on a wide table', () => {
    // The rule shipped inside `@media (min-width: 1024px)`, so a phone never
    // saw whose turn it was. Assert it sits at the sheet's top level: find the
    // rule, then walk back counting unclosed blocks before it.
    const at = css.indexOf('.playtest-battlefield-wrap.is-my-turn');
    expect(at).toBeGreaterThan(-1);
    const before = css.slice(0, at);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth).toBe(0);
  });

  it('does not draw a second border while a card is being dragged', () => {
    expect(css).not.toMatch(/\.playtest-battlefield\.is-over/);
    // The class is gone from the markup too — a droppable that destructures
    // the over-state is one render away from drawing it again. Matched as
    // code (a destructure, a ternary), so prose about it doesn't trip this.
    expect(battlefield).not.toMatch(/,\s*isOver\s*[},]/);
    expect(battlefield).not.toMatch(/isOver\s*\?/);
  });
});
