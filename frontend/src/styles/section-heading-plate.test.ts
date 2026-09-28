/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// T166 guard: a section heading's type comes from its role. SectionHeader
// marks the heading data-heading="title" | "overline", and base-layout.css
// paints each once. The overline labels had drifted into serif and sans,
// 0.06em and 0.08em; the Home title carried its own copy of the reference.
// A family keeps its spacing and layout, never the type.
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

/** The SectionHeader heading families (T166 W5). */
const FAMILIES = [
  'home-section-title',
  'settings-section-header',
  'friend-hub-section-head',
  'pod-hub-section-head',
  'shared-cube-section-head',
];

const TYPE = [
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-transform',
  'color',
];

describe('section headings take their type from their role (T166)', () => {
  const all = cssFiles(srcRoot).map((f) => ({
    file: relative(srcRoot, f).split(sep).join('/'),
    css: readFileSync(f, 'utf8'),
  }));

  it('title and overline are defined once, in base-layout.css', () => {
    const owners = all.filter(({ css }) => /:where\(\[data-heading='overline'\]\)/.test(css));
    expect(owners.map((o) => o.file)).toEqual(['styles/base-layout.css']);
  });

  it('no family rule restates the heading type', () => {
    const offenders: string[] = [];
    for (const { file, css } of all) {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.trim());
        const hit = selectors.some((s) =>
          FAMILIES.some((f) => new RegExp(`\\.${f}(?![\\w-])[^\\s>+~]*$`).test(s))
        );
        if (!hit) continue;
        for (const decl of m[2].split(';')) {
          const prop = decl.split(':')[0]?.trim();
          if (prop && TYPE.includes(prop)) offenders.push(`${file}: ${m[1].trim()} { ${prop} }`);
        }
      }
    }
    expect(offenders, 'Drop these: data-heading paints the type (base-layout.css)').toEqual([]);
  });
});
