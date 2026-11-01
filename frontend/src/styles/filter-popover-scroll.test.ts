/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// E1068: the Decks, Discover and Combos filter popovers had no height cap and
// no scroll, so at 640x360 (and 400% zoom) the lower sections and the footer
// were unreachable (WCAG 1.4.10). useAnchoredPanel supplies the inline
// max-height; this rule is what turns that cap into a scroll.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'search-controls.css'),
  'utf8'
);

describe('filter popover panel scrolls inside its cap', () => {
  it('.filter-popover-panel sets overflow-y: auto', () => {
    const m = css.match(/\n\.filter-popover-panel\s*\{([^}]*)\}/);
    expect(m, '.filter-popover-panel rule').not.toBeNull();
    expect(m![1]).toMatch(/overflow-y:\s*auto/);
  });
});
