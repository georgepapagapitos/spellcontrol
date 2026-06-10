/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// UX-102 guard: the motion language is a fixed set of semantic tokens defined
// once in global.css (see STYLE_GUIDE.md § Motion), and the old per-feature
// spinner/shimmer keyframe clones were collapsed into the single shared
// `spin` / `skeleton-shimmer` keyframes. This test fails loudly if a token
// definition goes missing, a duplicate keyframe creeps back in, or a retired
// keyframe name is redeclared/referenced.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read
// the stylesheets off disk (tests run in the node env per vitest.config.ts).
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

describe('motion tokens (UX-102)', () => {
  const globalCss = readFileSync(join(srcRoot, 'styles', 'global.css'), 'utf8');

  it('defines the six motion tokens + --ease-drawer in global.css', () => {
    for (const token of [
      '--motion-fast',
      '--motion-base',
      '--motion-gentle',
      '--motion-drawer',
      '--ease-out-soft',
      '--ease-pop',
      '--ease-drawer',
    ]) {
      expect(
        new RegExp(`${token}\\s*:`).test(globalCss),
        `${token} should be defined in global.css`
      ).toBe(true);
    }
  });
});

describe('shared keyframes are declared exactly once (UX-102)', () => {
  const files = cssFiles(srcRoot);
  const byFile = files.map((f) => ({ file: f, css: readFileSync(f, 'utf8') }));

  function declarations(name: string): string[] {
    const re = new RegExp(`@keyframes\\s+${name}(?![\\w-])`, 'g');
    const hits: string[] = [];
    for (const { file, css } of byFile) {
      const m = css.match(re);
      if (m) hits.push(`${file} (${m.length}x)`);
    }
    return hits;
  }

  it('declares @keyframes spin exactly once (in global.css)', () => {
    const hits = declarations('spin');
    expect(hits, `expected one @keyframes spin, found: ${hits.join(', ')}`).toHaveLength(1);
    expect(hits[0]).toContain('global.css');
  });

  it('declares @keyframes skeleton-shimmer exactly once (in global.css)', () => {
    const hits = declarations('skeleton-shimmer');
    expect(
      hits,
      `expected one @keyframes skeleton-shimmer, found: ${hits.join(', ')}`
    ).toHaveLength(1);
    expect(hits[0]).toContain('global.css');
  });

  // The per-feature spinner/shimmer keyframe clones were retired in favor of
  // the shared keyframes above. None of these names may be redeclared as a
  // keyframe or referenced from an `animation`/`animation-name` value again.
  // (Class names like `.commander-readiness-spin` are fine — only the
  // keyframe identity is dead.)
  const retired = [
    'price-refresh-spin',
    'sync-indicator-spin',
    'scanner-spin',
    'deck-combos-spin',
    'commander-readiness-spin',
    'next-best-move-spin',
    'power-hero-spin',
    'deck-card-row-spin',
    'deck-card-row-shimmer',
    'cmdr-readiness-shimmer',
  ];

  it('no retired spinner/shimmer keyframe is declared or referenced', () => {
    const offenders: string[] = [];
    for (const name of retired) {
      const declRe = new RegExp(`@keyframes\\s+${name}(?![\\w-])`);
      const refRe = new RegExp(`animation(?:-name)?\\s*:[^;]*(?<![\\w-])${name}(?![\\w-])`);
      for (const { file, css } of byFile) {
        if (declRe.test(css)) offenders.push(`${file}: @keyframes ${name}`);
        if (refRe.test(css)) offenders.push(`${file}: animation reference to ${name}`);
      }
    }
    expect(offenders, `retired keyframes found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
