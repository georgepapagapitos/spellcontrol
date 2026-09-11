/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Caller owns spacing (STYLE_GUIDE § Color & spacing). A shared component
// mounts in more than one host, and each host lays its children out with its
// own `gap`. A component that also carries an outer vertical margin doubles
// that gap in every host that has one and still lands flush in every host
// that doesn't — the AI refine panel shipped flush against the build report's
// last pill row for exactly that reason (#1887): its Coach-tab home supplied
// the gap, the sheet supplied nothing, and the panel owned no margin of its
// own to fall back on. The fix is one convention, enforced here: a shared
// root declares no margin-top / margin-bottom in any rule that targets it
// alone; the host that renders it declares the gap.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read
// the stylesheets off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Root class of every shared component that mounts in more than one host. */
const SHARED_ROOTS = [
  // AI panels (Coach tab bento, Suggestions tab, replace prompt, build sheet)
  '.deck-ai-strip',
  '.deck-ai-review',
  '.deck-stats-panel',
  '.ai-sources',
  // primitives (STYLE_GUIDE § Primitives index)
  '.wedge-hint-strip',
  '.thin-data-note',
  '.info-tip',
  '.meterbar',
  '.collection-grid-cell',
  '.collection-list-row',
  '.verdict-badge',
  '.verdict-chip',
  '.sc-tabs',
  '.search-pill',
  '.toolbar-viewmode',
  '.user-avatar',
  '.btn',
  '.pill-btn',
];

/**
 * Roots that still carry an outer margin. Empty since E287 converted the last
 * two (`.empty-state-mark`, `.collection-filter-chips`): every host now
 * declares its own gap. Never add to this set — a new shared root ships
 * without an outer margin. A root listed here would be exempt from the
 * assertion below, nothing more.
 */
const NOT_YET_CONVERTED = new Set<string>();

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const VERTICAL_MARGIN =
  /(?<![\w-])(margin(?:-top|-bottom|-block(?:-start|-end)?)?)\s*:\s*([^;}]+)/g;

/** True when a declaration adds vertical outer space (not 0 / auto). */
function addsVerticalMargin(prop: string, value: string): boolean {
  const parts = value.trim().split(/\s+/);
  const inert = (v: string) => v === '0' || v === 'auto';
  if (prop === 'margin') {
    const top = parts[0];
    const bottom = parts.length >= 3 ? parts[2] : parts[0];
    return !(inert(top) && inert(bottom));
  }
  if (prop === 'margin-block') {
    const start = parts[0];
    const end = parts[1] ?? parts[0];
    return !(inert(start) && inert(end));
  }
  return !inert(parts[0]);
}

interface Offence {
  file: string;
  selector: string;
  declaration: string;
}

/** Every rule whose selector is exactly one of the roots, at any nesting. */
function outerMarginOffences(): Offence[] {
  const offences: Offence[] = [];
  const guarded = SHARED_ROOTS.filter((r) => !NOT_YET_CONVERTED.has(r));
  for (const file of cssFiles(srcRoot)) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().split('\n').pop()!.trim();
      if (!guarded.includes(selector)) continue;
      for (const decl of rule[2].matchAll(VERTICAL_MARGIN)) {
        if (addsVerticalMargin(decl[1], decl[2])) {
          offences.push({
            file: relative(srcRoot, file),
            selector,
            declaration: `${decl[1]}: ${decl[2].trim()}`,
          });
        }
      }
    }
  }
  return offences;
}

describe('spacing ownership — shared roots carry no outer vertical margin', () => {
  it('every guarded shared root is declared somewhere', () => {
    const all = cssFiles(srcRoot)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const missing = SHARED_ROOTS.filter((r) => !all.includes(r));
    expect(missing, 'roots listed here should exist in CSS (rename? update the list)').toEqual([]);
  });

  it('no guarded shared root declares margin-top / margin-bottom', () => {
    const offences = outerMarginOffences();
    expect(
      offences,
      offences
        .map((o) => `${o.file}: ${o.selector} { ${o.declaration} } — move the gap into the host`)
        .join('\n')
    ).toEqual([]);
  });

  it('the not-yet-converted list stays empty', () => {
    // Every root is converted (E287 took the last two). A new shared root
    // ships without an outer margin; never add to this set.
    expect([...NOT_YET_CONVERTED]).toEqual([]);
  });
});
