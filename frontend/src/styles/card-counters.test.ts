/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'playtest', 'components', 'CardCounters.css'), 'utf8');

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
 * The counters on the felt are the card's SIBLING in its slot, as the P/T
 * plates are (a control can't nest in the card's role="button"). So every
 * way the card moves without the slot moving has to be answered here, or the
 * counters are left behind: the drag, and the 90° turn of a tapped card.
 */
describe('the counters beside a card', () => {
  it('leave the felt with their card while it is dragged', () => {
    expect(rule('.playtest-card-slot:has(> [data-dragging]) > .card-counters')).toMatch(
      /visibility:\s*hidden/
    );
  });

  it('take a tapped card’s turned box, not the portrait slot', () => {
    // Pinned to the slot, a tapped card's counters floated off its corner
    // by half the difference between the card's height and width.
    const tapped = rule('.playtest-card-slot:has(> .playtest-card--tapped) > .card-counters');
    expect(tapped.replace(/\s+/g, ' ')).toContain(
      'inset: calc((var(--pt-card-h) - var(--pt-card-w)) / 2) calc((var(--pt-card-w) - var(--pt-card-h)) / 2)'
    );
  });

  it('paint fixed ink on fixed discs, never theme colours', () => {
    // They sit on card art, the same ruling as the P/T plates.
    expect(rule('.card-counter')).toMatch(/(?<![-\w])color:\s*#fff\b/);
    expect(rule('.card-counter--mark')).toMatch(/background:\s*#0b0b0c\b/);
    expect(css).not.toMatch(/var\(--text-primary\)|var\(--art-scrim\)/);
  });

  it('hold the "+1" still for anyone who asked for less motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.card-counters__burst\s*\{\s*animation:\s*none;/
    );
  });
});
