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

  it('pins the dock on its grid-cell wrapper, clearing the header', () => {
    // A sticky .trade-dock inside a wrapper exactly its own height has no room
    // to travel: it scrolled away with the grid, title under the header.
    const wrapper = css.match(/\.trade-workspace-dock\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(wrapper).toMatch(/position:\s*sticky/);
    expect(wrapper).toMatch(/top:\s*var\(--space-3\)/);
    expect(wrapper).toMatch(/var\(--site-header-h\)/);
    const inner = css.match(/\.trade-workspace-dock \.trade-dock\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(inner).toMatch(/position:\s*static/);
  });
});

describe('collection browser responsiveness', () => {
  const browserCss = readFileSync(join(srcRoot, 'components/share/CollectionBrowser.css'), 'utf8');

  it('is a container, and its toolbar wraps by that container above the phone fold', () => {
    expect(browserCss).toMatch(
      /\.collection-browser\s*\{[^}]*container:\s*collection-browser\s*\/\s*inline-size/
    );
    expect(browserCss).toMatch(
      /@media \(min-width: 600px\)\s*\{\s*@container collection-browser \(max-width: 639px\)\s*\{[^]*?\.collection-browser-tools\s*\{\s*flex-wrap:\s*wrap/
    );
    expect(browserCss).toMatch(/\.collection-browser-search\s*\{\s*flex:\s*1 1 100%/);
  });

  it('keeps three tiles across on a phone', () => {
    expect(browserCss).toMatch(
      /@media \(max-width: 599px\)\s*\{\s*\.collection-browser \.shared-card-grid\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/
    );
  });

  it('draws nothing trade-related on the card face but the ring', () => {
    const cell = readFileSync(join(srcRoot, 'components/shared/CardGridCell.tsx'), 'utf8');
    // pickedCount reaches the item class (the ring) and nowhere inside the art.
    expect(cell).not.toMatch(/collection-grid-picked/);
    expect(cell).not.toMatch(/\{pickedCount[^}]*&&[^]*?<ArtBadge/);
  });
});
