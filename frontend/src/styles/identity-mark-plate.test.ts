/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// T166 follow-up guard: a deck, cube or binder mark on card art is one
// identity disc, the plate's shape filled with its owner's colour. The marks
// were the last things on art to skip `.art-badge`: the grid clusters
// restyled the row chip in place (scrim, a 55% ring, the glyph in the owner's
// colour, each rule written twice, once per kind), and the binder slot
// painted its own solid disc. Several binders on a tile took the themed
// --text-primary, dark on the dark scrim in a light theme. The user chose the
// solid disc over a coloured glyph on the scrim (2026-09-28 specimen): a
// purple deck's glyph vanished on the scrim, and so did any mark on a dimmed
// binder pocket.
//
// Now DeckBadge / BinderBadge `placement="art"` and the slot marks render
// `.art-badge[data-identity]`, and collection.css paints the identity once.
// A family keeps its size and place (padding, a cqw box, its corner) but not
// the paint, and no rule may restyle a row chip inside an on-art cluster.
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

/** The identity mark families on art. */
const FAMILIES = ['identity-mark', 'slot-deck-badge', 'tooltip-deck-badge'];

/** The identity paint, owned by `:where(.art-badge[data-identity])`. */
const PAINT = [
  'background',
  'background-color',
  'color',
  'border',
  'border-color',
  'border-radius',
  'box-shadow',
  'filter',
  'outline',
];

/** The on-art clusters a row chip must never be restyled inside. */
const CLUSTERS = ['collection-grid-badges', 'deck-card-grid-badges'];
const ROW_CHIPS = ['card-list-deck-badge', 'card-list-binder-badge'];

/** Rules as [selector, body], comments tokenized away first so a `;` or a
 *  brace inside one can't split a body. */
function rules(css: string): [string, string][] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

describe('identity marks on card art are one disc in the owner colour', () => {
  const all = cssFiles(srcRoot).map((f) => ({
    file: relative(srcRoot, f).split(sep).join('/'),
    css: readFileSync(f, 'utf8'),
  }));

  it('the identity paint is defined once, in collection.css', () => {
    const owners = all.filter(({ css }) => /:where\(\.art-badge\[data-identity\]\)\s*\{/.test(css));
    expect(owners.map((o) => o.file)).toEqual(['styles/collection.css']);
  });

  it('no identity family restates the paint', () => {
    const offenders: string[] = [];
    for (const { file, css } of all) {
      for (const [sel, body] of rules(css)) {
        const selectors = sel.split(',').map((s) => s.trim());
        const family = FAMILIES.find((f) =>
          selectors.some((s) => new RegExp(`\\.${f}(?![\\w-])[^\\s>+~]*$`).test(s))
        );
        if (!family) continue;
        for (const decl of body.split(';')) {
          const prop = decl.split(':')[0]?.trim();
          if (prop && PAINT.includes(prop)) offenders.push(`${file}: ${sel} { ${prop} }`);
        }
      }
    }
    expect(
      offenders,
      'Drop these: :where(.art-badge[data-identity]) paints every identity mark on art (collection.css)'
    ).toEqual([]);
  });

  it('no rule restyles a row chip inside an on-art cluster', () => {
    const offenders: string[] = [];
    for (const { file, css } of all) {
      for (const [sel] of rules(css)) {
        for (const s of sel.split(',').map((x) => x.trim())) {
          if (
            CLUSTERS.some((c) => s.includes(`.${c}`)) &&
            ROW_CHIPS.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(s))
          )
            offenders.push(`${file}: ${s}`);
        }
      }
    }
    expect(
      offenders,
      'On art, render DeckBadge / BinderBadge with placement="art" and size .identity-mark'
    ).toEqual([]);
  });
});
