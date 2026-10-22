/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The playtest commander-tax coin ("<Commander> commander tax, 0") measured
// 34x22 with a mouse at 1024x768 (E1035): its only floor was the 44px ghost,
// and that sits in a coarse-pointer block. WCAG 2.5.8's 24x24 applies to every
// pointer, so the coin's own base rule carries a 24px min-height, on a box
// that honors it (inline-flex, not inline).
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'playtest.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Drop every @media block, so only the pointer-agnostic base rules remain.
  .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

function baseBody(selector: string): string {
  const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].trim() === selector);
  if (!m) throw new Error(`no base rule for ${selector}`);
  return m[2];
}

describe('the commander-tax coin target', () => {
  it('is at least 24px tall for every pointer (WCAG 2.5.8)', () => {
    const b = baseBody('.playtest-tax-coin');
    const px = Number(b.match(/min-height:\s*(\d+)px/)?.[1]);
    expect(px, '.playtest-tax-coin min-height').toBeGreaterThanOrEqual(24);
    expect(b).toMatch(/display:\s*inline-flex/);
  });
});
