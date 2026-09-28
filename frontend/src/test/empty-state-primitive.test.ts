// @vitest-environment node
//
// Guard: the shared `.empty-state` / `.empty-state-tagline` markup is only
// ever rendered by the `EmptyState` primitive (board T157, STYLE_GUIDE
// "Empty states" / "Primitives index").
//
// Before this, ~30 pages and components hand-rolled the same
// `<div className="empty-state"><p className="empty-state-tagline">…`
// shape directly, so a change to the pattern (a new a11y rule, a new CTA
// convention) meant editing every site instead of one component. This scans
// every `.tsx` file for the exact class tokens `empty-state` and
// `empty-state-tagline` in a className string/template literal and fails on
// any match outside `components/shared/EmptyState.tsx` itself.
//
// A raw `empty-state-hint` / `empty-state-actions` / `empty-state-action`
// reference is NOT flagged here — those are only ever reachable through
// `EmptyState`'s own props (tagline/hint/actions), so
// a new hand-rolled site necessarily starts with the container class this
// guard does catch.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXEMPT = new Set([join(srcDir, 'components', 'shared', 'EmptyState.tsx')]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const FLAGGED = new Set(['empty-state', 'empty-state-tagline']);

function findRawEmptyStateClasses(src: string): string[] {
  const found: string[] = [];
  // Strip comments so prose mentioning the class name (like this file's own
  // header, or a component's doc comment) never trips the guard.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  for (const lit of code.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^\\`])*)`/g)) {
    const text = lit[3] !== undefined ? lit[3].replace(/\$\{[^}]*\}/g, ' ') : lit[2];
    for (const token of text.split(/\s+/)) {
      if (FLAGGED.has(token)) found.push(token);
    }
  }
  return found;
}

describe('empty-state primitive (no raw .empty-state markup outside EmptyState.tsx)', () => {
  it('every className="empty-state"/"empty-state-tagline" site goes through the EmptyState component', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      if (EXEMPT.has(file)) continue;
      const hits = findRawEmptyStateClasses(readFileSync(file, 'utf8'));
      if (hits.length > 0) {
        offenders.push(`${relative(srcDir, file)}: ${[...new Set(hits)].join(', ')}`);
      }
    }
    expect(
      offenders,
      `Raw .empty-state markup found outside EmptyState.tsx — render <EmptyState> instead:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
