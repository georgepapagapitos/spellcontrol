import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A scanner list row is one surface (style-guide/cards-collection.md § Card
// scanner). The hover fill once sat on `.scan-row-main`, the edit button only,
// so it stopped short of the separate remove button and left the bin in an
// unlit strip at the row's right edge. The fill belongs on the whole row.
describe('scanner list row surface', () => {
  const css = readFileSync(join(__dirname, 'admin-scanner.css'), 'utf8');

  it('fills the whole row on hover, not just the edit button', () => {
    expect(css).toMatch(/\.scan-row:hover\s*\{[^}]*background:/);
    expect(css).not.toMatch(/\.scan-row-main:hover\s*\{[^}]*background:/);
  });

  it('keeps the price column at least as wide as the action pair under it', () => {
    const price = css.match(/\.scan-row-price\s*\{[^}]*\}/)?.[0] ?? '';
    expect(price).toMatch(/min-width:\s*calc\(2 \* var\(--scan-action\)/);
  });
});
