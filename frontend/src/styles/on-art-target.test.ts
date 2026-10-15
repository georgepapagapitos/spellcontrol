/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// Nightly journey 2026-10-14 (#2929): the copy-places trigger on a grid tile
// broke two checks at once. On desktop it was 23px wide (axe target-size):
// the 24px floor lived on the marks, which stopped being controls when the
// one trigger replaced them, and the trigger only set min-height. On a touch
// phone at large text it was cut by the tile (journey-zoom control-cut, 73%
// visible): it grew its target with padding cancelled by a negative margin,
// so its own box left the tile, whose edge clips at the foot's small inset.
//
// The rules: the trigger floors both axes, and nothing in an on-art cluster
// grows its box with a negative margin. A target grows through an absolute
// `::after` ghost, which the clip trims while the control stays whole.
//
// Read off disk: CSS `?raw` imports come back empty under this setup.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Rules as [selector, body], comments stripped first. */
function rules(css: string): [string, string][] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

/** Controls that sit on card art inside a clipped tile. */
const ON_ART = [
  'collection-grid-foot',
  'collection-grid-badges',
  'deck-card-grid-badges',
  'copy-places-trigger',
];

const NEGATIVE_MARGIN = /(^|;)\s*margin(-[a-z-]+)?\s*:[^;]*(calc\(\s*-|(^|[\s:(,])-\d|-1\s*\*)/;

describe('targets on card art', () => {
  it('the copy-places trigger floors both axes at 24px', () => {
    const css = readFileSync(join(srcRoot, 'components/shared/CopyPlaces.css'), 'utf8');
    const base = rules(css).find(([sel]) => sel === '.copy-places-trigger');
    expect(base, '.copy-places-trigger rule').toBeDefined();
    const body = base![1];
    expect(body, 'min-width: 24px (WCAG 2.5.8)').toMatch(/min-width:\s*24px/);
    expect(body, 'min-height: 24px (WCAG 2.5.8)').toMatch(/min-height:\s*24px/);
  });

  it('no on-art control grows its box past the tile with a negative margin', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcRoot)) {
      for (const [sel, body] of rules(readFileSync(file, 'utf8'))) {
        if (!ON_ART.some((cls) => sel.includes(`.${cls}`))) continue;
        if (NEGATIVE_MARGIN.test(body)) {
          offenders.push(`${relative(srcRoot, file).split(sep).join('/')}: ${sel}`);
        }
      }
    }
    expect(
      offenders,
      'Grow an on-art target with an absolute ::after ghost, not padding cancelled by a negative margin'
    ).toEqual([]);
  });

  it('the negative-margin check sees the shape #2929 shipped', () => {
    expect(NEGATIVE_MARGIN.test('margin: calc(-1 * var(--space-3)); padding: 4px')).toBe(true);
    expect(NEGATIVE_MARGIN.test('margin-left: -6px')).toBe(true);
    expect(NEGATIVE_MARGIN.test('margin: 0; padding: 0')).toBe(false);
    expect(NEGATIVE_MARGIN.test('margin-left: auto')).toBe(false);
  });
});
