// @vitest-environment node
/**
 * Guard: the filter-chip family stays unified (T152 W8k). Before this, eight
 * families each carried their own radius, padding, resting/pressed colors
 * and coarse floor — `.deck-filter-chip` was a 999px pill with an accent
 * fill, `.card-search-filter-chip` a var(--radius) rect with an accent-light
 * TINT, `.theme-chip` had no coarse floor at all. They now share one
 * `.filter-chip` rule (styles/search-controls.css); a family's own
 * stylesheet keeps only what's genuinely its own (an icon color, a dashed
 * sub-state), never its own shape or pressed treatment. This fails the
 * moment a family's rule grows a `border-radius` or its own resting/pressed
 * background again — exactly how the eight families drifted apart the first
 * time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');

/** Declaration bodies of every rule whose selector is exactly `selector` (mirrors overlay-containment.test.ts). */
function blocks(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[1]);
  return out;
}

describe('filter-chip family stays unified (T152 W8k)', () => {
  it('the shared .filter-chip rule is a rect with an accent FILL when pressed', () => {
    const found = blocks(read('styles/search-controls.css'), '.filter-chip');
    expect(found, 'no base .filter-chip rule in search-controls.css').not.toEqual([]);
    expect(found[0]).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(found[0]).not.toMatch(/border-radius:\s*999px/);

    const pressed = blocks(read('styles/search-controls.css'), ".filter-chip[aria-pressed='true']");
    expect(pressed.some((b) => /background:\s*var\(--accent\)[;\s]/.test(b))).toBe(true);
    expect(pressed.some((b) => /background:\s*var\(--accent-light\)/.test(b))).toBe(false);
  });

  // [file, selector] pairs the eight families used to carry their own shape
  // and pressed colors on. None of them should define these selectors with
  // their own radius or background any more — the class either disappeared
  // (folded into `.filter-chip`) or, where it survives for a genuinely
  // bespoke reason (layout, a color pip), lost every declaration below.
  const RETIRED: Array<[string, string]> = [
    ['styles/search-controls.css', '.deck-filter-chip'],
    ['styles/deck-builder-card-search.css', '.card-search-filter-chip'],
    ['components/deck/CoachFeed.css', '.coach-feed-filter-chip'],
    ['styles/deck-builder-deck-extras.css', '.deck-role-bar-chip'],
    ['components/import/ProductSearchPanel.css', '.product-type-chip'],
    ['styles/deck-builder-combos-list.css', '.deck-combos-filter-pill'],
    ['components/decks/DiscoverFiltersPopover.css', '.discover-filter-chip > span'],
  ];

  for (const [file, selector] of RETIRED) {
    it(`${selector} (${file}) no longer defines its own shape or colors`, () => {
      expect(
        blocks(read(file), selector),
        `${selector} still has a rule in ${file} — it should have folded into .filter-chip`
      ).toEqual([]);
    });
  }

  it('.theme-chip keeps only layout, never its own radius or pressed fill', () => {
    const found = blocks(read('styles/deck-builder-customizer.css'), '.theme-chip');
    expect(found, 'no base .theme-chip rule in deck-builder-customizer.css').not.toEqual([]);
    for (const body of found) {
      expect(body).not.toMatch(/border-radius/);
      expect(body).not.toMatch(/background:\s*var\(--accent\)/);
    }
  });
});
