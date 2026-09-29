/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-list.css'), 'utf8');

/**
 * Deck-row chips drop by the name cell's width, never the name.
 *
 * In a 100-card deck's four desktop columns the name cell is ~170px and the
 * hover chips (combo, ownership, synergy, EDHREC %) need ~175px, so the name
 * went to nothing or the last chip was clipped. The fix sizes the chip cluster
 * against the name cell with container queries and drops the least-needed
 * chip first. An `@container` with no matching container is silent, so this
 * pins both halves: the container on `.deck-row-name`, and the tier order.
 */
describe('deck row — chips drop by the name cell width', () => {
  it('makes .deck-row-name the size container', () => {
    const rule = css.match(/(?:^|\n)\.deck-row-name\s*\{([^}]*)\}/);
    expect(rule, 'no base .deck-row-name rule').toBeTruthy();
    expect(rule![1]).toMatch(/container:\s*deck-row-name\s*\/\s*inline-size/);
  });

  /** The width (rem) below which `selector` is hidden inside the name cell. */
  function hiddenBelow(selector: string): number {
    const blocks = css.matchAll(
      /@container\s+deck-row-name\s*\(width\s*<\s*([\d.]+)rem\)\s*\{([\s\S]*?)\n\}/g
    );
    for (const [, rem, body] of blocks) {
      if (body.includes(selector) && /display:\s*none/.test(body)) return Number(rem);
    }
    throw new Error(`no @container deck-row-name tier hides ${selector}`);
  }

  it('drops EDHREC % first, then synergy, then ownership, then the whole cluster', () => {
    const inclusion = hiddenBelow('.deck-row-inclusion');
    const synergy = hiddenBelow('.deck-row-synergy');
    const owned = hiddenBelow('.deck-row-alloc-chip');
    const cluster = hiddenBelow('> .deck-row-hovermeta');
    expect(inclusion).toBeGreaterThan(synergy);
    expect(synergy).toBeGreaterThan(owned);
    expect(owned).toBeGreaterThan(cluster);
    // Combo and foil are never dropped on their own: they leave with the cluster.
    expect(() => hiddenBelow('.combo-badge')).toThrow();
    expect(() => hiddenBelow('.foil-badge')).toThrow();
  });

  it('hides the whole cluster below the hover reveal, so it wins the cascade', () => {
    // Same specificity as `.deck-row:hover .deck-row-hovermeta`; only source
    // order decides. Placed above it, the narrowest tier never applied.
    const reveal = css.indexOf('.deck-row:hover .deck-row-hovermeta');
    const hide = css.indexOf('.deck-row .deck-row-name > .deck-row-hovermeta');
    expect(reveal).toBeGreaterThan(-1);
    expect(hide).toBeGreaterThan(reveal);
  });

  it('spaces the cluster with one gap, not per-chip margins', () => {
    const rule = css.match(/(?:^|\n)\.deck-row-hovermeta\s*\{([^}]*)\}/);
    expect(rule, 'no base .deck-row-hovermeta rule').toBeTruthy();
    expect(rule![1]).toMatch(/gap:/);
    expect(rule![1]).toMatch(/margin-left:\s*auto/);
    expect(css).toMatch(/\.deck-row \.deck-row-hovermeta > \*\s*\{\s*margin-left:\s*0;/);
  });
});
