/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// E536 step 4 guard (WCAG 1.4.4): the journey's zoom walk found the grid caption
// plate cut every price at a 24px browser font, because its box was px
// (`height: 20px`, `line-height: 16px`, `margin-top: -10px`) around rem text.
// The plate's geometry is a contract with the grid virtualizer's row estimate,
// which scales by remScale(), so every term here stays rem.
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'collection.css'), 'utf8');

function block(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} rule exists`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

describe('grid caption plate scales with the browser text size', () => {
  it('the caption line is a rem box with a rem line height', () => {
    const b = block('.collection-grid-caption');
    expect(b).toMatch(/height:\s*1\.25rem/);
    expect(b).toMatch(/line-height:\s*1rem/);
    expect(b).not.toMatch(/(^|[\s;])(height|line-height):\s*[\d.]+px/);
  });

  it('the plate pulls up by exactly its own padding, in rem', () => {
    const b = block('.collection-grid-captions');
    expect(b).toMatch(/margin-top:\s*calc\(-1 \* var\(--space-2-5\)\)/);
    expect(b).toMatch(/padding-top:\s*var\(--space-2-5\)/);
  });
});
