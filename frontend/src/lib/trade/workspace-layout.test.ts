/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCK_MIN_WIDTH } from './workspace-layout';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(srcRoot, 'components/trade/TradeWorkspace.css'), 'utf8');

describe('trade workspace dock threshold', () => {
  it('is the same number in the stylesheet and in JS', () => {
    const queries = [...css.matchAll(/@container\s+trade-workspace\s*\(min-width:\s*(\d+)px\)/g)];
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(Number(q[1])).toBe(DOCK_MIN_WIDTH);
  });

  it('adds no viewport media query of its own', () => {
    // Only 600 / 1024 are viewport tiers (STYLE_GUIDE § Responsive); the dock
    // asks its container, so this sheet has no @media width query at all.
    expect(css).not.toMatch(/@media[^{]*(min|max)-width/);
  });

  it('makes the host the container the query asks', () => {
    expect(css).toMatch(
      /\.trade-workspace\s*\{[^}]*container:\s*trade-workspace\s*\/\s*inline-size/
    );
  });
});
