/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// UX-102 guard: the motion language is a fixed set of semantic tokens defined
// once in tokens.css (see STYLE_GUIDE.md § Motion), and the old per-feature
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
  const tokensCss = readFileSync(join(srcRoot, 'styles', 'tokens.css'), 'utf8');

  it('defines the six motion tokens + --ease-drawer in tokens.css', () => {
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
        new RegExp(`${token}\\s*:`).test(tokensCss),
        `${token} should be defined in tokens.css`
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

  it('declares @keyframes spin exactly once (in feedback-spinner.css)', () => {
    const hits = declarations('spin');
    expect(hits, `expected one @keyframes spin, found: ${hits.join(', ')}`).toHaveLength(1);
    expect(hits[0]).toContain('feedback-spinner.css');
  });

  it('declares @keyframes skeleton-shimmer exactly once (in footer-card-preview.css)', () => {
    const hits = declarations('skeleton-shimmer');
    expect(
      hits,
      `expected one @keyframes skeleton-shimmer, found: ${hits.join(', ')}`
    ).toHaveLength(1);
    expect(hits[0]).toContain('footer-card-preview.css');
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
    'leaderboard-shimmer',
    'gen-mode-shimmer',
    'friends-shimmer',
    'deck-compare-shimmer',
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

  // Forward guard: loading skeletons share ONE gradient-sweep keyframe. A new
  // bespoke `@keyframes *-shimmer` clone (the recurring drift the UX-cohesion
  // sweep found) passes the name-specific checks above, so catch the whole
  // family here — only `skeleton-shimmer` may exist.
  it('declares no bespoke *-shimmer keyframe other than skeleton-shimmer', () => {
    const offenders: string[] = [];
    const re = /@keyframes\s+([\w-]*-shimmer)(?![\w-])/g;
    for (const { file, css } of byFile) {
      for (const m of css.matchAll(re)) {
        if (m[1] !== 'skeleton-shimmer') offenders.push(`${file}: @keyframes ${m[1]}`);
      }
    }
    expect(
      offenders,
      `bespoke shimmer keyframes found — use the shared skeleton-shimmer:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});

// Motion ratchet (T157 W5). The UX-cohesion sweep found 192 raw (non-token)
// durations against 442 tokenized ones — near-twins of --motion-fast/base/
// gentle/drawer (150/160/180/220ms, 0.15s/0.22s) scattered across the app so
// hovers and enter animations run at slightly different speeds screen to
// screen. A pass snapped the clear hover/press/menu/sheet/tab near-twins to
// their token; this freezes what's left per file and only lets it fall.
//
// Counted: a bare numeric ms/s literal in a transition / transition-duration /
// animation / animation-duration declaration, outside @keyframes. A literal
// inside a var(--x, <fallback>) is not counted (it's already token-driven).
// Zero (0s/0ms, incl. the reduced-motion 0.001ms backstop) is not counted —
// same spirit as layout-ratchet's hairline exemption.
//
// Not counted, and deliberately still raw: purposeful long/choreographed
// animations (brand mark, seal burst, skeleton shimmer/spinner, foil,
// playtest table effects, win celebration), canonical raw values the guide
// itself prescribes outside the 4 tokens (sheet-fall ~340ms, side-drawer
// 220ms-in/180ms-out, modal 160/180/120ms, toast enter 160ms), and anything
// in the same do-not-touch surfaces as the layout ratchet.
//
// A file whose count RISES fails: use a --motion-*/--ease-* token, or follow
// one of the guide's canonical patterns instead of a fresh raw value. A file
// whose count FALLS also fails, until it's locked in with:
//
//   UPDATE_MOTION_BASELINE=1 npm test -- src/styles/motion-tokens.test.ts
//
// The update refuses to write while any file is over its baseline, so it can
// only ever lower the numbers.
const MOTION_BASELINE_PATH = join(srcRoot, 'styles', 'motion-ratchet.baseline.json');
const DURATION_PROPERTY = /^(?:transition|animation)(?:-duration)?$/;

function stripKeyframeBlocks(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf('@keyframes', i);
    if (idx === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, idx);
    const braceStart = css.indexOf('{', idx);
    if (braceStart === -1) {
      i = css.length;
      break;
    }
    let depth = 1;
    let j = braceStart + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    i = j;
  }
  return out;
}

function countRawDurations(css: string): number {
  let count = 0;
  for (const decl of css.matchAll(/(^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+);/gm)) {
    if (!DURATION_PROPERTY.test(decl[2])) continue;
    // Drop var(...) spans first so a token's own ms fallback (e.g.
    // var(--motion-fast, 120ms)) is never mistaken for a raw literal.
    const withoutVars = decl[3].replace(/var\([^)]*\)/g, '');
    for (const m of withoutVars.matchAll(/(?<![\w.-])([0-9]*\.?[0-9]+)(ms|s)(?![\w-])/g)) {
      if (Number(m[1]) === 0) continue;
      count++;
    }
  }
  return count;
}

function motionCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...motionCssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function measureMotion(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of motionCssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    const css = stripKeyframeBlocks(readFileSync(file, 'utf8'));
    const n = countRawDurations(css);
    if (n) counts[key] = n;
  }
  return counts;
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('motion duration ratchet (T157 W5)', () => {
  const counts = measureMotion();
  const baseline: Record<string, number> = existsSync(MOTION_BASELINE_PATH)
    ? JSON.parse(readFileSync(MOTION_BASELINE_PATH, 'utf8'))
    : counts;

  const rose: string[] = [];
  const fell: string[] = [];
  const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  for (const file of files) {
    const now = counts[file] ?? 0;
    const was = baseline[file] ?? 0;
    if (now > was) rose.push(`${file}: ${was} -> ${now}`);
    if (now < was) fell.push(`${file}: ${was} -> ${now}`);
  }

  if (process.env.UPDATE_MOTION_BASELINE) {
    it('writes the lowered baseline', () => {
      expect(rose, `Refusing to raise the baseline:\n${rose.join('\n')}`).toEqual([]);
      writeFileSync(MOTION_BASELINE_PATH, JSON.stringify(sortedCounts(counts), null, 2) + '\n');
    });
  } else {
    it('no file gains raw (non-token) transition/animation durations', () => {
      expect(
        rose,
        `Use a --motion-*/--ease-* token (STYLE_GUIDE.md § Motion) instead of a fresh raw duration:\n${rose.join('\n')}`
      ).toEqual([]);
    });

    it('the motion ratchet baseline is current', () => {
      expect(
        fell,
        `These files improved. Lock it in: UPDATE_MOTION_BASELINE=1 npm test -- src/styles/motion-tokens.test.ts\n${fell.join('\n')}`
      ).toEqual([]);
    });
  }
});
