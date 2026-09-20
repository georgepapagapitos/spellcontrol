/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const stylesDir = dirname(fileURLToPath(import.meta.url));

/**
 * A group label carries the case it was given.
 *
 * `getSectionMeta` returns display-ready labels: "White", "Multicolor",
 * "Colorless / Artifact", "Creature", "Mythic", "A", "7+" — and, grouping by
 * set, "Bloomburrow" or "Secret Lair Drop: Artist Series". Collection used to
 * uppercase them all, which reads as a label on the first kind and shouts the
 * second. CSS has no way to tell a category word from a proper noun, so the
 * decoration was paid for by mangling real names, and the binder needed a
 * `text-transform: none` override to escape it.
 *
 * Both are gone. This keeps them gone: re-adding the uppercase re-creates the
 * bug on every surface at once (Collection's list, its grid, its sticky
 * overlay and a binder), because all four render the same `SectionHeaderBar`.
 */
const sheets = readdirSync(stylesDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ file: f, css: readFileSync(join(stylesDir, f), 'utf8') }));

/**
 * Rules touching the GROUP label specifically. Deliberately not every
 * `*-section-label` in the app: the filter panels and the binder card editor
 * have their own `.…-section-label` spans heading a block of form controls
 * ("CONDITION", "LANGUAGE"), and those are category words the app itself
 * wrote — uppercasing them is right. This is about the one label whose text
 * comes from card data.
 */
const GROUP_LABEL = 'collection-list-section-label';

function labelRules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!selector.includes(GROUP_LABEL)) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

describe('group section labels', () => {
  it('finds the markup hook it is guarding', () => {
    // If the class is ever renamed, this test would otherwise pass by
    // guarding nothing at all.
    const bar = readFileSync(
      join(stylesDir, '..', 'components', 'shared', 'SectionHeaderBar.tsx'),
      'utf8'
    );
    expect(bar).toContain(GROUP_LABEL);
  });

  it('are never re-cased by CSS', () => {
    for (const { file, css } of sheets) {
      for (const { selector, body } of labelRules(css)) {
        expect(
          /text-transform\s*:/.test(body),
          `${file}: "${selector}" re-cases a section label; labels arrive display-ready from getSectionMeta`
        ).toBe(false);
      }
    }
  });

  it('need no per-surface escape hatch, because there is nothing to escape', () => {
    // `text-transform: none` on a binder's label was the tell that the base
    // rule was wrong. Its absence is the point; if one comes back, so has the
    // uppercase it was fighting.
    const all = sheets.map((s) => s.css).join('\n');
    expect(all).not.toMatch(new RegExp(`binder-table-section[^{]*${GROUP_LABEL}`));
  });
});
