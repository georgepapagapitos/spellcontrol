/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// T166 guard: every label chip that names a state, a format or a role wears
// one pill (styles/search-controls.css, "Label pills"). The families below
// had drifted into six paddings, four border styles, seven fills, three
// weights, uppercase on a third of them and three different fonts. The pill
// is in :where(), so a family rule may keep its own layout (margin, flex,
// display, vertical-align, white-space) but may not restate the pill: its
// padding, border, fill, colour, type or casing. Status is `tone`, painted
// by the plate, never a per-family [data-tone] rule.
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

const plateCss = readFileSync(join(srcRoot, 'styles', 'search-controls.css'), 'utf8');
const plateStart = plateCss.indexOf('/* ── Label pills (T166)');

/** The families, read from the plate's own selector list. */
const FAMILIES = [
  ...plateCss
    .slice(plateStart)
    .matchAll(/:where\(\s*([^)]*)\)\s*\{\s*display: inline-flex/g)
    .next()
    .value![1].matchAll(/\.([a-z][a-z0-9-]*)/g),
].map((m) => m[1]);

const PILL_PROPS = [
  'padding',
  'border',
  'border-color',
  'border-radius',
  'background',
  'background-color',
  'color',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'text-transform',
];

describe('label pills are one pill (T166)', () => {
  it('reads the family list from the plate', () => {
    expect(FAMILIES.length).toBeGreaterThan(20);
    expect(FAMILIES).toContain('verdict-chip');
    expect(FAMILIES).toContain('deck-format-badge');
  });

  it('no family rule restates the pill or paints its own tone', () => {
    const offenders: string[] = [];
    for (const f of cssFiles(srcRoot)) {
      const file = relative(srcRoot, f).split(sep).join('/');
      let css = readFileSync(f, 'utf8');
      if (file === 'styles/search-controls.css') css = css.slice(0, plateStart);
      css = css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.trim());
        // The family is the rule's subject: its class ends the last compound,
        // plus pseudo-classes or an attribute (a tone), not a part or modifier.
        const hit = selectors.some((s) =>
          FAMILIES.some((fam) => new RegExp(`\\.${fam}(?![\\w-])[^\\s>+~]*$`).test(s))
        );
        if (!hit) continue;
        // Two things a family may paint itself: a material fill on a finish
        // modifier (foil, etched), and a chip that sits on card art, which
        // takes the scrim plate and the scrim tone set (§ On-art scrims).
        if (selectors.every((s) => /\.finish-|\.card-group-annotation /.test(s))) continue;
        for (const decl of m[2].split(';')) {
          const prop = decl.split(':')[0]?.trim();
          if (prop && PILL_PROPS.includes(prop))
            offenders.push(`${file}: ${m[1].trim()} { ${prop} }`);
        }
      }
    }
    expect(offenders, 'Drop these: the label pill plate paints them (search-controls.css)').toEqual(
      []
    );
  });
});
