/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// E594 guard: the type scale has a floor. A review found nearly all text set at
// 11.5 to 13px (--text-sm 962 uses, --text-xs 919, --text-base 99), a known tell
// of machine-made UI and hard to read on a phone. xs is no smaller than 0.78rem
// (12.5px) and body is 1rem (16px) at every tier. If a dense surface overflows
// at these sizes, fix the component (keep it on xs); do not lower the token.
const tokens = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8');

function rem(name: string): number {
  const m = new RegExp(String.raw`${name}:\s*([\d.]+)rem`).exec(tokens);
  expect(m, `${name} should be a rem value`).toBeTruthy();
  return parseFloat((m as RegExpExecArray)[1]);
}

describe('type scale floor (E594)', () => {
  it('--text-xs is at least 0.78rem', () => {
    expect(rem('--text-xs')).toBeGreaterThanOrEqual(0.78);
  });
  it('--text-sm is at least 0.875rem', () => {
    expect(rem('--text-sm')).toBeGreaterThanOrEqual(0.875);
  });
  it('--text-base is at least 1rem and no tier block lowers it', () => {
    expect(rem('--text-base')).toBeGreaterThanOrEqual(1);
    const all = [...tokens.matchAll(/--text-base:\s*([\d.]+)rem/g)].map((m) => parseFloat(m[1]));
    expect(Math.min(...all)).toBeGreaterThanOrEqual(1);
  });
  it('the scale stays ascending', () => {
    const steps = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl'].map((s) =>
      rem(`--text-${s}`)
    );
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});
