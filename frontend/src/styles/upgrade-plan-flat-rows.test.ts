/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../components/deck/UpgradePlanSheet.css'), 'utf8');

/**
 * Upgrade plan rows are hairline rows, not boxes on dividers.
 *
 * Each `.upgrade-plan-row` li draws the divider. The shared `.deck-card-row`
 * inside it is a bordered, raised box by default, and the plan once removed
 * only its bottom edge: every row read as a three-sided box sitting on a
 * divider, the boxes bumping into each other. The fix is to drop the whole box.
 */
describe('upgrade plan: one frame per row', () => {
  const rule = css.match(/\.upgrade-plan-row-main > \.deck-card-row\s*\{([^}]*)\}/);

  it('flattens the shared row inside the plan', () => {
    expect(rule, 'no flattening rule for the shared row').toBeTruthy();
    expect(rule![1]).toMatch(/(^|[;\s])border:\s*0/);
    expect(rule![1]).toMatch(/background:\s*none/);
    expect(rule![1]).toMatch(/border-radius:\s*0/);
  });

  it('keeps the divider on the li', () => {
    const li = css.match(/\.upgrade-plan-row\s*\{([^}]*)\}/);
    expect(li![1]).toMatch(/border-bottom:\s*0\.5px solid var\(--border\)/);
  });
});
