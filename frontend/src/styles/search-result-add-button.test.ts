/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// E459: on touch the search result's "+" (and the −/+ stepper that replaces
// it) grew its whole painted box to the 44px target, so a solid accent block
// around a 12px glyph outweighed the card on every row of /search, Add cards,
// list add and the deck add panel. The fix keeps the 44px box and paints a
// smaller one inside it by clipping the background to the content box.
//
// Both are rects at the control radius, not circles (STYLE_GUIDE § Shape
// language: circles are only the camera button and avatars; ui-tells.md, "the
// same action as two shapes"). The "+" was a filled disc here and a labeled
// rect in Coach for the same Add.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'binder-card-management.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

const TOUCH_RULE = '.inline-card-search-add,\n  .inline-card-search-stepper-btn {';

function touchRule(): string {
  const at = css.indexOf(TOUCH_RULE);
  expect(at, 'the shared touch rule for the add + stepper buttons is missing').toBeGreaterThan(-1);
  expect(css.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('search result add button (E459)', () => {
  it('keeps a 44px target but paints only the content box', () => {
    const rule = touchRule();
    expect(rule).toMatch(/min-width:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(rule).toMatch(/padding:\s*var\(--space-2\)/);
    expect(rule).toMatch(/background-clip:\s*content-box/);
  });

  it('both buttons are rects at the control radius, not discs', () => {
    for (const base of ['.inline-card-search-add {', '.inline-card-search-stepper-btn {']) {
      const at = css.indexOf(base);
      expect(at, `${base} is missing`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf('}', at));
      expect(body, `${base} radius`).toMatch(/border-radius:\s*var\(--radius\)/);
      expect(body).not.toMatch(/999px|50%/);
    }
  });

  it('comes after both base rules, whose `background` shorthand would reset the clip', () => {
    const touchAt = css.indexOf(TOUCH_RULE);
    for (const base of ['.inline-card-search-add {', '.inline-card-search-stepper-btn {']) {
      const baseAt = css.indexOf(base);
      expect(baseAt, `${base} is missing`).toBeGreaterThan(-1);
      expect(baseAt, `${base} must precede the touch rule`).toBeLessThan(touchAt);
    }
  });
});
