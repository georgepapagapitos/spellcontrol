/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection.css'), 'utf8');

/**
 * The card table's column tiers are `@container` rules queried against
 * `.collection-table` (the `container-type: inline-size` wrapper). An element
 * cannot be matched by a query on its own container, so a tier rule written as
 * `.collection-table { --ct-w-binder: 0px }` never fires: the cells for the
 * dropped columns disappear (their `data-tier` hide rules target descendants,
 * which DO match) while the rows keep every track, and the remaining cells
 * slide left into the wrong widths with a hole on the right. That is exactly
 * how the first cut of the table looked at 1024px. The guard reads every
 * `@container` block in the sheet and requires anything that sizes a column
 * inside one to target a descendant of the wrapper.
 *
 * The tiers used to rewrite `--collection-table-cols` wholesale, which only
 * worked because one surface owned the only column set. They now zero the
 * dropped column's own `--ct-w-*` track instead, so the same two rules serve
 * every surface and every preset — but the containment trap is unchanged,
 * hence the same guard over the new property names.
 */
function containerBlocks(sheet: string): string[] {
  const out: string[] = [];
  const re = /^\s*@container[^{]*\{/gm;
  while (re.exec(sheet)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < sheet.length && depth > 0; i++) {
      if (sheet[i] === '{') depth++;
      else if (sheet[i] === '}') depth--;
    }
    out.push(sheet.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return out;
}

describe('collection table column tiers', () => {
  const TRACK_PROP = /--(?:collection-table-cols|ct-w-[\w-]+)/;
  const blocks = containerBlocks(css).filter((b) => TRACK_PROP.test(b));

  it('has container-query tiers that set the column template', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('never sets the template on the queried container itself', () => {
    for (const block of blocks) {
      const rules = (block.match(/[^{}]+\{[^{}]*\}/g) ?? []).filter((r) => TRACK_PROP.test(r));
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        const selector = rule.slice(0, rule.indexOf('{')).trim();
        // `.collection-table > *` / `.collection-table .x` are fine; a bare
        // `.collection-table` (optionally with a class chained on) is the bug.
        expect(selector, `tier rule "${selector}" targets the container itself`).not.toMatch(
          /^\.collection-table(\.[\w-]+)*$/
        );
      }
    }
  });
});
