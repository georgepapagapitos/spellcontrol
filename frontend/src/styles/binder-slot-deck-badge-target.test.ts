/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// axe `target-size` failed the nightly journey: the binder pocket's "Open
// deck" link measured 18.4px. The identity paint already floors an a/button
// mark at 24px, but inside a `:where()` (no specificity), so `.slot-deck-badge`'s
// own 12px floor silently beat it. The link's own floor must be 24px.
// Read off disk: CSS `?raw` imports come back empty under this setup.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'deck-builder-binder-slot.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

function body(selector: string): string {
  const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].trim() === selector);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[2];
}

describe('the binder pocket deck link target', () => {
  it('is never smaller than 24px (WCAG 2.5.8)', () => {
    const b = body('.slot-deck-badge');
    for (const prop of ['min-width', 'min-height', 'max-width', 'max-height']) {
      const px = Number(b.match(new RegExp(prop + ': *([0-9]+)px'))?.[1]);
      expect(px, prop).toBeGreaterThanOrEqual(24);
    }
  });
});
