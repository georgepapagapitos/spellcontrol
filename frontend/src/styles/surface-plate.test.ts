/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// T166 guard: the three resting surfaces are painted once, on Surface's
// data-surface (styles/base-layout.css, "Surfaces"). Sleeve, framed and
// popover had drifted: tiles carrying an outline the ruling forbids, section
// cards on --surface-raised or --radius, a shadow stacked on a border, 0.5px
// against 1px, --radius against --radius-lg. A family keeps its padding and
// layout, which follow its content, but not the frame: its fill, border,
// radius or shadow. A state rule (:hover, :focus-within) may still lift a
// tile, the error card keeps its status border colour, and a surface nested
// in another frame may drop its own (0, none, transparent): one frame per
// surface, never a card in a card.
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

/** Split a selector list on its top-level commas only: the commas inside
 *  `:is(a, b)` belong to one selector, and splitting there cut a state rule
 *  in two halves, one of which no longer showed its `:hover`. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

/** The Surface families (T166 W4), matching the display-primitives guard. */
const FAMILIES = [
  'decks-index-card',
  'binders-index-card',
  'home-card',
  'game-night-card',
  'play-home-card',
  'card-search-panel',
  'deck-combos-panel',
  'deck-test-hand-panel',
  'search-syntax-panel',
  'deck-stats-panel',
  'partner-panel',
  'settings-card',
  'auth-card',
  'import-card',
  'error-boundary-card',
  'breakdown-card',
  'deck-identity-card',
  'friend-hub-h2h-card',
  'trade-offer-card',
  'trade-accept-card',
  'filter-popover-panel',
  'sort-popover-panel',
  'toolbar-popover-panel',
  'binder-color-panel',
  'rule-field-panel',
];

const FRAME = ['background', 'background-color', 'border', 'border-radius', 'box-shadow'];

describe('surfaces are painted once, by variant (T166)', () => {
  const all = cssFiles(srcRoot).map((f) => ({
    file: relative(srcRoot, f).split(sep).join('/'),
    css: readFileSync(f, 'utf8'),
  }));

  it('the three variants are defined once, in base-layout.css', () => {
    const owners = all.filter(({ css }) => /:where\(\[data-surface='framed'\]\)/.test(css));
    expect(owners.map((o) => o.file)).toEqual(['styles/base-layout.css']);
  });

  it('no family rule restates its frame', () => {
    const offenders: string[] = [];
    for (const { file, css } of all) {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = splitSelectors(m[1]);
        const hit = selectors.some((s) =>
          FAMILIES.some((f) => new RegExp(`\\.${f}(?![\\w-])[^\\s>+~]*$`).test(s))
        );
        // A state may lift or ring a surface; the frame at rest is the plate's.
        if (
          !hit ||
          selectors.every((s) => /:(hover|focus|focus-within|focus-visible|active)/.test(s))
        )
          continue;
        for (const decl of m[2].split(';')) {
          const prop = decl.split(':')[0]?.trim();
          const value = decl.split(':').slice(1).join(':').trim();
          if (/^(0|none|transparent)$/.test(value)) continue;
          if (prop && FRAME.includes(prop)) offenders.push(`${file}: ${m[1].trim()} { ${prop} }`);
        }
      }
    }
    expect(offenders, 'Drop these: data-surface paints the frame (base-layout.css)').toEqual([]);
  });
});
