/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard: a deck card's preview stacks "Swap this card" and "Similar cards" in
// one extra slot. Both draw a top rule with padding below it, so with nothing
// between them the second rule sat flush against the first section's last row
// (nightly journey, card preview, Chrome phone and Firefox desktop). The slot
// owns that gap. Read off disk: CSS `?raw` imports come back empty here.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'footer-card-preview.css'), 'utf8');
const tsx = readFileSync(join(here, '../components/card/CardPreview.tsx'), 'utf8');

describe('card preview extra slot', () => {
  it('stacks its sections with a gap', () => {
    const rule = /(^|\n)\.card-preview-slot--extra\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.card-preview-slot--extra rule').not.toBeNull();
    expect(rule![2]).toMatch(/flex-direction:\s*column\s*;/);
    expect(rule![2]).toMatch(/gap:\s*var\(--space-\d[^)]*\)\s*;/);
  });

  it('is the class every extra slot renders with', () => {
    expect(tsx).not.toMatch(/slot\(extraSlot\)/);
    expect(tsx).toMatch(/slot\(extraSlot, ' card-preview-slot--extra'\)/);
  });
});
