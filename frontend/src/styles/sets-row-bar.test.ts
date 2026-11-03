/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../pages/SetsPage.css'), 'utf8');

/**
 * CB-05: set progress rows. The bar used `max-width` inside a body that grew
 * to fill the row, so on a wide screen the percent floated far from its bar and
 * bar widths followed each row's content. The body is capped, the bar fills it,
 * and the percent has a fixed tabular width so rows line up.
 */
const rule = (selector: string) =>
  css.match(new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('sets progress row', () => {
  it('caps the body so the percent stays beside the bar', () => {
    expect(rule('.sets-row-body')).toMatch(/max-width:\s*\d/);
  });

  it('the bar fills the capped body, so every row has the same width', () => {
    const bar = rule('.sets-row-bar');
    expect(bar).toMatch(/width:\s*100%/);
    expect(bar).not.toMatch(/max-width/);
  });

  it('the percent has a fixed width, right-aligned', () => {
    const pct = rule('.sets-row-pct');
    expect(pct).toMatch(/min-width:\s*\d/);
    expect(pct).toMatch(/justify-content:\s*flex-end/);
  });
});
