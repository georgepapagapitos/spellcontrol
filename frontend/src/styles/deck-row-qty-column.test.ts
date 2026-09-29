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
 * Every row's qty cell (the read-only count, the tap-to-edit button, a
 * printing sub-row's count) sizes from one custom property, so the names
 * start on one line down the list. This pins each cell to that property, so a
 * later edit can't hard-code one of them to its own width and break the column.
 */
describe('deck list — qty cells share one column per section', () => {
  const list = read('deck-builder-card-list.css');
  const qty = read('deck-builder-row-qty.css');

  it('sets the column once, on the section list', () => {
    const rule = list.match(/(?:^|\n)\.deck-section-rows\s*\{([^}]*)\}/);
    expect(rule, 'no .deck-section-rows rule').toBeTruthy();
    expect(rule![1]).toMatch(/--deck-qty-col:/);
  });

  it.each([
    [list, '.deck-row-qty'],
    [list, '.deck-printing-sub-qty'],
    [qty, '.deck-row-qty-edit'],
  ])('sizes %#: %s from --deck-qty-col', (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(rule, `no base rule for ${selector}`).toBeTruthy();
    expect(rule![1]).toMatch(/width:\s*var\(--deck-qty-col/);
  });
});
