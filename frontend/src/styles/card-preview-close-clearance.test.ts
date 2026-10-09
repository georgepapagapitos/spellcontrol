/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard: in the split inspector the close button sits in the head's top-right
// corner, level with the name row. The head reserved a fixed 4rem on the right
// while the button covered 12px + 44px of it, so the price sat 8px from the X.
// The button's size and inset are now custom properties, and the head's right
// padding is computed from both plus a gap. Read off disk: CSS `?raw` imports
// come back empty here.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'footer-card-preview.css'), 'utf8');

const rules = (selector: string) =>
  [
    ...css.matchAll(new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')),
  ].map((m) => m[2]);

describe('card preview close-button clearance', () => {
  it('sizes and places the close button from the shared properties', () => {
    const decls = rules('.card-preview-close').join('\n');
    expect(decls).toMatch(/right:\s*var\(--pv-close-inset\)\s*;/);
    expect(decls).toMatch(/width:\s*var\(--pv-close-size\)\s*;/);
    expect(decls).toMatch(/height:\s*var\(--pv-close-size\)\s*;/);
    // A literal size anywhere would drift from the head's clearance.
    expect(decls).not.toMatch(/(width|height):\s*\d+px/);
  });

  it('clears the button on the head right edge, with a gap', () => {
    const padded = rules('.card-preview-head').filter((d) => /padding:/.test(d));
    const split = padded.find((d) => /--pv-close-size/.test(d));
    expect(split, 'split head padding derived from the close button').toBeDefined();
    expect(split!.replace(/\s+/g, ' ')).toMatch(
      /calc\(var\(--pv-close-inset\) \+ var\(--pv-close-size\) \+ var\(--space-\d\)\)/
    );
  });
});
