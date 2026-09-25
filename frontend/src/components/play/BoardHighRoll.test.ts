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
