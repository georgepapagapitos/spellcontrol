/// <reference types="node" />
// Guard: computePopoverPlacement returns EITHER `left` or `right` (it flips a
// panel near the right edge to right-aligned). A caller that applies only
// `left` drops the flip and the panel lands at the far left of the screen:
// InfoTip did exactly that (`left: placement.left ?? 8`) until 2026-11-02.
// Every caller must carry `placement.right` through to its style.
// If this fails: read `right` from the placement and set it on the panel.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

describe('computePopoverPlacement callers keep the right-aligned flip', () => {
  it('every caller reads placement.right', () => {
    const callers = [...files(SRC)].filter((f) => {
      const s = readFileSync(f, 'utf8');
      return /computePopoverPlacement\(/.test(s) && !f.endsWith('popover-placement.ts');
    });
    expect(callers.length).toBeGreaterThan(5);
    const dropsRight = callers
      .filter((f) => !/\bplacement\.right\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split(sep).join('/'));
    expect(dropsRight).toEqual([]);
  });

  it('no caller falls back to a fixed left edge', () => {
    const offenders = [...files(SRC)]
      .filter((f) => /placement\.left\s*\?\?\s*\d/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
