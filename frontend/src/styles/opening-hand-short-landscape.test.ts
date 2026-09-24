/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(
  join(here, '..', 'playtest', 'components', 'OpeningHandSheet.css'),
  'utf8'
);

/**
 * The opening hand on a phone on its side (about 800x380). Below 1024px the
 * card width came from the screen WIDTH alone, so a sideways phone got 140px
 * cards, 196px tall on a 380px screen. The fan ran under the actions (which
 * the footer's z-index paints on top of the cards), desk-sized 15rem buttons
 * spanned the screen, and the toggles were pushed against the bottom edge.
 * Every card's type line and rules text sat under a button.
 *
 * jsdom loads no stylesheets, so no render test can see any of that. This
 * reads the rule instead, and pins the four things that fixed it.
 */
describe('opening hand on a phone on its side', () => {
  const QUERY = '@media (max-height: 500px) and (orientation: landscape)';
  const start = css.indexOf(QUERY);
  const block = css.slice(start, css.indexOf('\n}', start));

  it('has its own block, after the phone tier it must override', () => {
    expect(start, `${QUERY} is missing`).toBeGreaterThan(-1);
    // Same specificity as the max-width: 1023px rules, so source order decides.
    expect(start).toBeGreaterThan(css.indexOf('@media (max-width: 1023px)'));
  });

  it('bounds the card by the screen HEIGHT, not only its width', () => {
    const cards = /\.is-takeover \.playtest-opening-cards \{([^}]*)\}/.exec(block)?.[1] ?? '';
    expect(cards).toContain('--oh-w:');
    expect(cards).toContain('var(--vh-safe)');
  });

  it('lays the seven side by side instead of a 35% shingle', () => {
    const next =
      /\.playtest-opening-slot \+ \.playtest-opening-slot \{([^}]*)\}/.exec(block)?.[1] ?? '';
    expect(next).toMatch(/margin-left:\s*var\(--space-\d\)/);
  });

  it('sizes the actions to their labels, and keeps the 44px touch floor', () => {
    const btn = /\.playtest-opening-footer \.btn \{([^}]*)\}/.exec(block)?.[1] ?? '';
    expect(btn).toContain('min-height: 44px');
    expect(btn).not.toContain('15rem');
  });
});
