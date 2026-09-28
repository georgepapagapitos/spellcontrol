/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// T166 guard: every count is one bubble. `Count` renders `.count-badge`,
// painted once in styles/tabs.css ("Count bubbles"): 1.125rem, the label face
// at 700 with tabular figures, quiet by default, accent-filled by
// tone="accent", pinned at one offset by placement="corner". The families
// below had drifted into four sizes, three faces, two offsets and a literal
// #38bdf8. A family rule may keep its own layout and motion (margin, flex,
// animation) but may not restate the bubble. The one exception is the nav's
// "badges invert on accent fills" rule, scoped to an `.active` link.
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

/** The Count families (T166 W3). */
const FAMILIES = [
  'collection-filters-badge',
  'friends-nav-link-badge',
  'mobile-tab-bar-badge',
  'scanner-stack-badge',
  'home-waiting-count',
  'play-setup-roster-count',
  'trades-section-count',
  'pull-list-group-count',
  'trending-deck-count',
];

const BUBBLE = [
  'min-width',
  'height',
  'padding',
  'border',
  'border-color',
  'border-radius',
  'background',
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'position',
  'top',
  'right',
  'bottom',
  'left',
];

describe('counts are one bubble (T166)', () => {
  const all = cssFiles(srcRoot).map((f) => ({
    file: relative(srcRoot, f).split(sep).join('/'),
    css: readFileSync(f, 'utf8'),
  }));

  it('the bubble is defined once, in tabs.css', () => {
    const owners = all.filter(({ css }) => /:where\(\.count-badge\)/.test(css));
    expect(owners.map((o) => o.file)).toEqual(['styles/tabs.css']);
  });

  it('no family rule restates the bubble', () => {
    const offenders: string[] = [];
    for (const { file, css } of all) {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].split(',').map((s) => s.trim());
        const hit = selectors.some((s) =>
          FAMILIES.some((f) => new RegExp(`\\.${f}(?![\\w-])[^\\s>+~]*$`).test(s))
        );
        if (!hit || selectors.every((s) => /\.active\s/.test(s))) continue;
        for (const decl of m[2].split(';')) {
          const prop = decl.split(':')[0]?.trim();
          if (prop && BUBBLE.includes(prop)) offenders.push(`${file}: ${m[1].trim()} { ${prop} }`);
        }
      }
    }
    expect(offenders, 'Drop these: .count-badge paints and pins every count (tabs.css)').toEqual(
      []
    );
  });
});
