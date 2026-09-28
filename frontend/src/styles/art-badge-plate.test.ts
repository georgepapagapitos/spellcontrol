/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// T166 guard: everything on card art is one plate. ArtBadge renders
// `.art-badge` beside the family class, and collection.css paints the plate
// (scrim, weight, radius, shadow) and pins it by `data-corner` at one inset.
// The families below used to carry their own copy of each, and drifted into
// five font sizes, three weights, six insets and an accent fill that broke
// § On-art scrims. So a family's own rule may keep what is its own (a code's
// mono face, a size tier, a status fill on a modifier class) but may not
// restate the plate: that property belongs to `.art-badge`.
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

/** The ArtBadge families (T166 W1). */
const FAMILIES = [
  'collection-grid-qty',
  'collection-grid-set',
  'collection-grid-surplus',
  'deck-card-grid-qty',
  'deck-card-grid-alloc',
  'deck-card-grid-partner',
  'deck-card-grid-tags',
  'deck-card-grid-synergy',
  'card-group-qty',
  'product-card-qty',
  'home-deck-arrivals',
  'deck-combos-card-qty-badge',
  'deck-library-tile-badge',
  'slot-qty-badge',
];

/** The plate's properties, owned by `.art-badge`. */
const PLATE = [
  'background',
  'background-color',
  'border-radius',
  'box-shadow',
  'font-weight',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
];

describe('badges on card art are one plate (T166)', () => {
  const all = cssFiles(srcRoot).map((f) => ({
    file: relative(srcRoot, f).split(sep).join('/'),
    css: readFileSync(f, 'utf8'),
  }));

  it('the plate is defined once, in collection.css', () => {
    const owners = all.filter(({ css }) => /:where\(\.art-badge:not\(/.test(css));
    expect(owners.map((o) => o.file)).toEqual(['styles/collection.css']);
  });

  it('no family rule restates a plate property', () => {
    const offenders: string[] = [];
    for (const { file, css } of all) {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.trim());
        // A family's own class as the subject of the rule, not a modifier
        // (`.deck-card-grid-alloc-unowned`) or a part (`-qty-x`, `-tags-count`).
        const family = FAMILIES.find((f) =>
          selectors.some((s) => new RegExp(`\\.${f}(?![\\w-])[^\\s>+~]*$`).test(s))
        );
        if (!family) continue;
        for (const decl of m[2].split(';')) {
          const prop = decl.split(':')[0]?.trim();
          if (prop && PLATE.includes(prop)) offenders.push(`${file}: ${m[1].trim()} { ${prop} }`);
        }
      }
    }
    expect(
      offenders,
      'Drop these: .art-badge paints and pins every badge on card art (collection.css)'
    ).toEqual([]);
  });
});
