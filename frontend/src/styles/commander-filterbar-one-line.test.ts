/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * On the generator's desktop filter bar the row labels are hidden, so the source switch,
 * colors, Bracket, Sort and Random fit on one line at 1280px (E1113). The Color row's
 * `.commander-finder-row.is-stacked .commander-finder-label` rule sets `display: flex` with
 * three classes; the hide rule had two, lost, and the 49px "Color" label pushed the toolbar
 * onto a second, right-aligned line. The hide rule must come later with at least as many
 * classes.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, '../components/deck/CommanderSearch.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

type Rule = { selector: string; body: string; index: number };
const rules: Rule[] = [...css.matchAll(/([^{}@;]+?)\s*\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  body: m[2],
  index: m.index ?? 0,
}));
const classes = (sel: string) => (sel.match(/\.[\w-]+/g) ?? []).length;
const targetsLabel = (r: Rule) => /\.commander-finder-label$/.test(r.selector);

describe('generator filter bar keeps its row labels hidden', () => {
  it('the filter-bar hide rule outranks every earlier rule that shows the label', () => {
    const hide = rules.find(
      (r) =>
        targetsLabel(r) &&
        r.selector.includes('.commander-finder-filterbar') &&
        /display:\s*none/.test(r.body)
    );
    expect(hide, 'no filter-bar rule hides .commander-finder-label').toBeDefined();
    const showers = rules.filter(
      (r) => targetsLabel(r) && r !== hide && /display:\s*(?!none)/.test(r.body)
    );
    expect(showers.length).toBeGreaterThan(0);
    for (const s of showers) {
      expect(s.index, `${s.selector} comes after the hide rule`).toBeLessThan(hide!.index);
      expect(
        classes(hide!.selector),
        `${s.selector} outranks the hide rule`
      ).toBeGreaterThanOrEqual(classes(s.selector));
    }
  });
});
