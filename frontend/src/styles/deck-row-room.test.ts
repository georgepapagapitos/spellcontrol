/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The deck list read as cramped (user report, 2026-10-13): a desktop row was
 * ~25px tall at `--space-1` padding, and every land row reserved a blank 3.9rem mana slot, so "Sokenzan, Crucible of Defiance"
 * ellipsized with visible room to spare. This pins both fixes. The 36px touch
 * floor stays (the long-list density ruling, styles/density-tiers.test.ts):
 *
 * - the row pads `--space-1-5` top and bottom (the inline padding is left
 *   alone so prices stay under the section subtotal);
 * - an empty mana placeholder drops out, handing its width to the name. Price
 *   sits at the trailing edge, so both columns stay aligned on other rows.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-list.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/** Body of the first top-level `selector { … }` rule. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('deck row room', () => {
  it('pads the row --space-1-5 top and bottom', () => {
    expect(rule('.deck-row')).toMatch(/padding:\s*var\(--space-1-5\)\s+var\(--space-1\);/);
  });

  it('drops an empty mana slot so the name can use it', () => {
    expect(rule('.deck-row .mana-cost-row:empty')).toMatch(/display:\s*none/);
  });
});
