/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');
const badges = readFileSync(join(here, '..', 'playtest', 'components', 'CardPtBadges.tsx'), 'utf8');
const cardView = readFileSync(
  join(here, '..', 'playtest', 'components', 'PlaytestCardView.tsx'),
  'utf8'
);

/** Declarations of the rule whose full selector list is exactly `selector`. */
function rule(selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (sel === selector) return m[2];
  }
  return '';
}

/**
 * A creature's power and toughness sit on CARD ART, so they are painted in
 * fixed colours — solid black plates, bold white numerals — never a theme's.
 *
 * They were `color: var(--text-primary)` on `background: var(--art-scrim)`.
 * In a dark theme that is light-on-dark and reads; in every light theme it is
 * dark text on a dark scrim, and the numbers vanished. Same ruling as the
 * hover and selection rings: what is drawn on the art does not follow the
 * chrome's palette.
 */
describe('the power/toughness plate', () => {
  const plate = rule('.playtest-card__pt-half, .playtest-card-pt__value, .playtest-card-pt__input');

  it('is one rule for every surface that shows a body', () => {
    // The editable badges on your battlefield and the read-only box on a card
    // face (every other board, and the drag copy) cannot drift apart.
    expect(plate).not.toBe('');
  });

  it('paints fixed ink on a fixed plate, never theme colours', () => {
    expect(plate).toMatch(/(?<![-\w])color:\s*#fff\b/);
    expect(plate).toMatch(/background:\s*#0b0b0c\b/);
    expect(plate).not.toMatch(/var\(--text-primary\)|var\(--art-scrim\)/);
  });

  it('scales with the card, with a floor for the densest table', () => {
    // A fixed step off the type scale read at ~70% of EDHPlay's size on a
    // normal table and could not grow with the density setting. Sized off
    // `--pt-card-w` instead, never below `--text-xs`.
    expect(plate).toMatch(
      /font-size:\s*max\(var\(--text-xs\),\s*calc\(var\(--pt-card-w, 100px\) \* 0\.1\d+\)\)/
    );
  });

  it('sits as a pair: a 1px seam, square where the plates meet', () => {
    // Set by eye against EDHPlay (2026-09-23): a spaced gap and four rounded
    // corners each read as two separate chips. Both surfaces, same shape.
    for (const box of ['.playtest-card__pt', '.playtest-card-pt']) {
      expect(rule(box), box).toMatch(/(?<![-\w])gap:\s*1px/);
    }
    expect(rule('.playtest-card__pt > :first-child, .playtest-card-pt > :first-child')).toMatch(
      /border-top-right-radius:\s*0;[\s\S]*border-bottom-right-radius:\s*0/
    );
    expect(rule('.playtest-card__pt > :last-child, .playtest-card-pt > :last-child')).toMatch(
      /border-top-left-radius:\s*0;[\s\S]*border-bottom-left-radius:\s*0/
    );
  });

  it('is two plates, not one box with a slash', () => {
    expect(badges).not.toMatch(/playtest-card-pt__slash/);
    expect(css).not.toMatch(/playtest-card-pt__slash/);
  });

  it('leaves the felt with its card while the card is being dragged', () => {
    // The badges are the card's SIBLING in its slot — a control cannot nest in
    // the card's role="button" — so the source going transparent left them
    // behind on their own. The card marks itself; the slot hides the badges.
    expect(cardView).toMatch(/data-dragging=\{isDragging \|\| undefined\}/);
    expect(css).toMatch(
      /\.playtest-card-slot:has\(> \[data-dragging\]\) > \.playtest-card-pt\s*\{\s*visibility:\s*hidden;/
    );
  });

  it('rides a tapped card’s corner, not the slot’s', () => {
    // The card rotates inside a portrait slot; the badges are pinned to the
    // slot. Left at the slot's bottom-right they hung below a tapped card,
    // off it entirely (2026-09-24). A tapped card moves them onto its own
    // printed corner: out by the half-difference on the left, up by it below.
    const tapped = rule('.playtest-card-slot:has(> .playtest-card--tapped) > .playtest-card-pt');
    const half = String.raw`\(var\(--pt-card-h\) - var\(--pt-card-w\)\) / 2`;
    expect(tapped).toMatch(/right:\s*auto/);
    expect(tapped).toMatch(new RegExp(String.raw`left:\s*calc\(var\(--space-1\) - ${half}\)`));
    expect(tapped).toMatch(new RegExp(String.raw`bottom:\s*calc\(var\(--space-1\) \+ ${half}\)`));
  });
});
