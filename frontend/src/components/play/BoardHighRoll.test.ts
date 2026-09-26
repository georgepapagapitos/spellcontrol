/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'BoardHighRoll.css'), 'utf8');

/**
 * High Roll must read alone: no life numeral, ± hint, badge, name or burst
 * chip ghosting through the overlay, on either the winner or the dimmed
 * seats. A translucent fill (even at 92% opacity) let the panel underneath
 * show through — this pins the overlay's own background, and every color it
 * draws from (including the winner gradient's two stops), to a fully opaque
 * value so the regression can't come back as "just a little transparent".
 */
describe('High Roll overlay is fully opaque', () => {
  it('the base overlay has no alpha channel below 1', () => {
    const rule = css.slice(
      css.indexOf('.pp-highroll {'),
      css.indexOf('\n}', css.indexOf('.pp-highroll {'))
    );
    expect(rule).toMatch(/background:\s*#[0-9a-f]{6};/i);
    expect(rule).not.toMatch(/rgba\([^)]*,\s*0(\.\d+)?\)/);
  });

  it('the winner gradient never falls back to a translucent stop', () => {
    const rule = css.slice(
      css.indexOf('.pp-highroll.is-winner {'),
      css.indexOf('\n}', css.indexOf('.pp-highroll.is-winner {'))
    );
    expect(rule).not.toMatch(/rgba\(/);
  });
});

/**
 * The overlay has to fit every seat. Its column (die, number, tiebreak,
 * caption) was sized for an upright seat, and a sideways seat's own height is
 * its cell's WIDTH: on 2p-side at 320px a tied winner's caption sat 18px
 * outside the panel (invisible), and ties ran 2-13px out on 4p-sides, 3p and
 * 2p-side at 390-430. Measured after, with a real browser: zero overflow on
 * all 33 presets x 320/390/430/820, tie and no tie.
 */
describe('High Roll fits every seat', () => {
  const body = (needle: string) => {
    const at = css.indexOf(needle);
    expect(at, `"${needle}" is missing`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    return css.slice(open + 1, css.indexOf('}', open));
  };

  it("caps the number by what the rest of the column leaves of the seat's own height", () => {
    expect(body('.player-panel:not([data-sideways]) .pp-highroll-value {')).toMatch(
      /font-size:\s*min\(var\(--life-size\),\s*calc\(100cqh - /
    );
    // Sideways, the panel's height is the cell's width.
    expect(body('.player-panel[data-sideways] .pp-highroll-value {')).toMatch(
      /font-size:\s*min\(var\(--life-size\),\s*calc\(100cqw - /
    );
  });

  it('drops the die on a short seat, in both orientations', () => {
    expect(css).toMatch(
      /@container \(max-height: 8rem\) \{\s*\.player-panel:not\(\[data-sideways\]\) \.pp-highroll-die \{\s*display: none;/
    );
    expect(css).toMatch(
      /@container \(max-width: 8rem\) \{\s*\.player-panel\[data-sideways\] \.pp-highroll-die \{\s*display: none;/
    );
  });

  it('reads along one line on a long, short seat, in both orientations', () => {
    expect(css).toMatch(
      /@container \(min-aspect-ratio: 5 \/ 2\) \{\s*\.player-panel:not\(\[data-sideways\]\) \.pp-highroll \{\s*flex-direction: row;/
    );
    expect(css).toMatch(
      /@container \(max-aspect-ratio: 2 \/ 5\) \{\s*\.player-panel\[data-sideways\] \.pp-highroll \{\s*flex-direction: row;/
    );
  });
});
