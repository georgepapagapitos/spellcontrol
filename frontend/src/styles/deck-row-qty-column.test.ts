/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

/**
 * One qty column per deck section.
 *
 * A ± stepper (basics, non-singleton formats) is about three times the width
 * of a bare count. It used to widen only its own row, so "26" pushed that
 * row's name right of every other name in the Land section, and the printings
 * chip beside it squeezed "Island" down to "I". The fix sizes the qty cell of
 * every row in the section from one custom property, which widens when any row
 * holds a stepper. This pins each qty cell to that property, so a later edit
 * can't hard-code one of them back to 1.4rem and break the column.
 */
describe('deck list — qty cells share one column per section', () => {
  const list = read('deck-builder-card-list.css');
  const qty = read('deck-builder-row-qty.css');

  it('widens the column when any row in the section has a stepper', () => {
    const rule = list.match(/\.deck-section-rows:has\(\.deck-row-qty-group\)\s*\{([^}]*)\}/);
    expect(rule, 'no :has(.deck-row-qty-group) rule on .deck-section-rows').toBeTruthy();
    expect(rule![1]).toMatch(/--deck-qty-col:/);
  });

  it.each([
    [list, '.deck-row-qty'],
    [list, '.deck-printing-sub-qty'],
    [qty, '.deck-row-qty-edit'],
    [qty, '.deck-row-qty-group'],
  ])('sizes %#: %s from --deck-qty-col', (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(rule, `no base rule for ${selector}`).toBeTruthy();
    expect(rule![1]).toMatch(/width:\s*var\(--deck-qty-col/);
  });
});
