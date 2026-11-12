/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The table clock strip's controls are buttons, so they take the button shape
 * (STYLE_GUIDE § Shape language: rectangles act, pills label). With a 999px
 * radius the icon-only Pause rendered as a circle beside a Pass pill, two
 * shapes for one kind of control, and the strip's 12.5px / 650 sentence sat
 * small and heavy beside them (E604). The fix: a `var(--radius)` rect for
 * every strip button, Pause a square the height of its labeled neighbors, and
 * the sentence at the labels' size.
 *
 * On a phone-width strip the sentence stacks to two lines. On one line an
 * hour-long game's "h:mm:ss" pair clipped the turn time at 320px ("P…'s turn
 * 2:05:5"), and "(paused)" clipped it at 375px; two lines fit inside the
 * buttons' height, so the strip does not grow.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'play-enhancements.css'),
  'utf8'
);

function block(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} not found in play-enhancements.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('table clock strip shape (E604)', () => {
  it('strip buttons are rectangles, not pills', () => {
    expect(block('.game-clock-strip-btn')).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(css).not.toMatch(/\.game-clock-strip-btn[^{]*\{[^}]*border-radius:\s*999px/);
  });

  it('the icon-only button is a square as tall as its labeled neighbors', () => {
    const btn = block('.game-clock-strip-btn');
    const icon = block('.game-clock-strip-btn--icon');
    const height = btn.match(/min-height:\s*([^;]+);/)?.[1];
    expect(height).toBeDefined();
    expect(icon).toContain(`min-width: ${height}`);
  });

  it('the sentence matches the button labels', () => {
    expect(block('.game-clock-strip-text')).toMatch(/font-size:\s*var\(--text-sm\)/);
    expect(block('.game-clock-strip-btn')).toMatch(/font-size:\s*var\(--text-sm\)/);
  });

  it('a phone-width strip stacks the sentence instead of clipping it', () => {
    const tier = css.slice(css.indexOf('@container clock-strip'));
    expect(tier).toMatch(/^@container clock-strip \(max-width: 26rem\)/);
    const text = tier.slice(tier.indexOf('.game-clock-strip-text {'));
    expect(text.slice(0, text.indexOf('}'))).toMatch(/flex-direction:\s*column/);
  });

  // Before the first turn the strip carries two labeled Start buttons. At
  // 320px they left the waiting note 59px and it was cut mid-word ("Starts
  // with the fi"). Measured after: nothing clipped at 320, 360, 390 or on a
  // phone held sideways, and the strip is no taller than it was.
  it('fits the waiting note beside both Start buttons on a phone', () => {
    const at = css.indexOf('@container clock-strip (max-width: 26rem)');
    const narrow = css.slice(at, css.indexOf('\n}\n', at));
    expect(narrow).toMatch(/\.game-clock-strip-btn--start svg\s*\{\s*display:\s*none;/);
    expect(narrow).toMatch(/\.game-clock-strip-wait\s*\{[^}]*white-space:\s*normal;/);
    expect(narrow).toMatch(
      /\.game-clock-strip-wait ~ \.game-clock-strip-idle\s*\{\s*display:\s*none;/
    );
  });
});
