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
    // Declarations only: a rule may carry a comment explaining itself, and
    // two rules that differ solely in their prose are still one signal.
    if (sel === selector)
      return m[2]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim();
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
    for (const part of ['', '::after']) {
      const mine = rule(css, `.playtest-battlefield-wrap.is-my-turn${part}`);
      const theirs = rule(quadrant, `.opponent-quadrant.is-active-turn${part}`);
      expect(mine).not.toBeNull();
      expect(theirs).not.toBeNull();
      expect(mine).toBe(theirs);
    }
  });

  it('paints in front of the cards, not under them', () => {
    // As an inset shadow on the board itself the band painted with the
    // background, under every descendant — so the hand fan and the pile
    // shelf, which sit at the table's near edge by design, cut through it.
    // The band is an overlay above the felt's whole card layer instead.
    const base = rule(css, '.playtest-battlefield-wrap.is-my-turn') ?? '';
    expect(base).not.toMatch(/inset 0 0 0/);
    const band = rule(css, '.playtest-battlefield-wrap.is-my-turn::after') ?? '';
    expect(band).toMatch(/box-shadow:\s*inset 0 0 0 var\(--pt-table-edge\)/);
    // Above the marquee at 4, the tallest thing on the felt.
    const z = /(?<![-\w])z-index:\s*(\d+)/.exec(band);
    expect(z).not.toBeNull();
    expect(Number(z![1])).toBeGreaterThan(4);
    // And it must not eat clicks on what it covers.
    expect(band).toMatch(/pointer-events:\s*none/);
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
