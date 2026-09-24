/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hand = readFileSync(join(here, '..', 'playtest', 'components', 'Hand.tsx'), 'utf8');

/**
 * A hand card's badges leave the table with it when it is dragged.
 *
 * The cost and the "revealed" tag are SIBLINGS of the card inside its slot,
 * not children, so the drag source going transparent did not take them
 * along: dragging a card out of the fan left its mana cost floating over the
 * felt where the card had been. The battlefield hit the same thing with its
 * P/T badges (pt-plate.test.ts). This reads every absolutely positioned
 * `playtest-hand__*` element the hand renders — a badge laid over or beside
 * a card — and fails if one is not hidden while its card is being dragged, so
 * a third badge added later cannot reopen it.
 */

/** `.playtest-hand__*` classes the stylesheet positions absolutely. */
function absoluteHandClasses(): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/position:\s*absolute/.test(m[2])) continue;
    for (const part of m[1].split(',')) {
      const sel = part.trim();
      const cls = /^\.(playtest-hand__[a-z-]+)$/.exec(sel)?.[1];
      if (cls) out.add(cls);
    }
  }
  return [...out];
}

/** Every selector in a rule that sets `visibility: hidden`. */
const hiddenSelectors = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => /visibility:\s*hidden/.test(m[2]))
  .flatMap((m) => m[1].split(/,(?![^(]*\))/).map((s) => s.replace(/\s+/g, ' ').trim()));

describe('hand badges leave with a dragged card', () => {
  const badges = absoluteHandClasses().filter((c) => hand.includes(c));

  it('finds the badges it is guarding', () => {
    // If this fails the classes were renamed and the check below reads nothing.
    expect(badges).toEqual(
      expect.arrayContaining(['playtest-hand__mv', 'playtest-hand__revealed'])
    );
  });

  it.each(badges)('.%s is hidden while its card is dragged', (cls) => {
    const covered = hiddenSelectors.some(
      (s) => /:has\(> \[data-dragging\]\) >/.test(s) && s.includes(cls)
    );
    expect(
      covered,
      `.${cls} sits beside a hand card; give it a \`:has(> [data-dragging]) >\` rule that hides it, or it stays on the felt when the card is dragged away`
    ).toBe(true);
  });

  it('the card marks itself while it is dragged', () => {
    const cardView = readFileSync(
      join(here, '..', 'playtest', 'components', 'PlaytestCardView.tsx'),
      'utf8'
    );
    expect(cardView).toMatch(/data-dragging=\{isDragging \|\| undefined\}/);
  });
});
