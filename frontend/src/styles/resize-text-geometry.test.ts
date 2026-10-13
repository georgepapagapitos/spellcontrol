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

// The deck page at a 24px browser font on a 390px phone (nightly run 38351166188):
// the search pill's <input> reports its ~20-character intrinsic width as the
// toolbar row's minimum, 363px against a 342px column, so the page scrolled
// sideways and the toolbar pills, hero totals and stat tiles read as cut.
describe('the search pill does not widen its row', () => {
  const rule = (file: string, selector: string): string => {
    const text = readFileSync(join(dir, file), 'utf8');
    const at = text.indexOf(`${selector} {`);
    expect(at, `${selector} rule exists`).toBeGreaterThan(-1);
    return text.slice(at, text.indexOf('}', at));
  };

  it('its input has a percentage width, which adds nothing to min-content', () => {
    expect(rule('search-controls.css', '.search-pill > input')).toMatch(/\bwidth:\s*100%/);
  });

  it('the admin console-helper tokens wrap instead of scrolling the page', () => {
    expect(rule('admin-scanner.css', '.admin-sub code')).toContain('overflow-wrap: anywhere');
  });
});
