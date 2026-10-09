/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-list.css'), 'utf8');

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(m, `no base rule for ${selector}`).toBeTruthy();
  return m![1];
};

/**
 * The deck row's ⋮ trigger fits its column.
 *
 * The trigger grew to a 24px hit box (WCAG 2.5.8) while its column stayed
 * 12px, so on hover the trigger's plate hung past the row's right edge. This
 * pins the column to the trigger's width and forbids an inline negative
 * margin, which would push the box back out of it.
 */
describe('deck row — the ⋮ trigger stays inside its column', () => {
  it('sizes the column to the trigger min-width', () => {
    const trigger = rule('.deck-row-menu-trigger').match(/min-width:\s*([^;]+);/);
    expect(trigger, 'trigger has no min-width').toBeTruthy();
    const slot = rule('.deck-row > .deck-row-menu').match(/(?:^|\s)width:\s*([^;]+);/);
    expect(slot, 'deck row menu column has no width').toBeTruthy();
    expect(slot![1].trim()).toBe(trigger![1].trim());
  });

  it('only trims the trigger box on the block axis', () => {
    const body = rule('.deck-row-menu-trigger');
    expect(body).not.toMatch(/(?:^|\s)margin:\s*-/);
    expect(body).not.toMatch(/margin-(?:inline|left|right)[^:]*:\s*-/);
  });
});
