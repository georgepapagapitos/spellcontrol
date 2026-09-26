/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'components',
    'aggregates',
    'TrendingRail.css'
  ),
  'utf8'
);

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A rule starts the file or follows a `}` or the `*/` of its comment.
  const m = new RegExp(`(?:^|[}/])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

/**
 * The rail's "Trending" heading and each list's own title both use the
 * .deck-combos-title family. With nothing between them they stacked flush and
 * at equal weight ("TRENDING / POPULAR THIS WEEK" read as two labels, not a
 * heading and its list). The rail owns the gap, and the list title sits a
 * level down.
 */
describe('Trending rail headings', () => {
  it('spaces its heading from its lists with a gap it owns', () => {
    const rail = rule('.trending-rail');
    expect(rail).toMatch(/display:\s*flex/);
    expect(rail).toMatch(/flex-direction:\s*column/);
    expect(rail).toMatch(/gap:\s*var\(--space-/);
  });

  it('sets each list title one level below the rail heading', () => {
    // Two classes: a lone .trending-rail-section-title ties .deck-combos-title
    // on specificity and lost to it whenever that sheet loaded later.
    const title = rule('.trending-rail .trending-rail-section-title');
    expect(title).toMatch(/font-size:\s*var\(--text-xs\)/);
    expect(title).toMatch(/color:\s*var\(--text-secondary\)/);
  });
});
