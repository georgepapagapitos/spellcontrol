/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Layout ratchet (T135). The app kept drifting on phones and tablets because
// the CSS never had to use the system it already had: ~1,550 spacing
// declarations picked freehand values off the --space-* scale (0.4rem,
// 0.3rem and 0.35rem were the three most common), and 32 different viewport
// widths gated @media blocks against a guide that names two tier boundaries.
// Each off-scale value is small; together they are why no two screens share
// a rhythm. `spacing-tokens.test.ts` only catches a literal that EXACTLY
// equals a step, so it never saw any of this.
//
// This guard freezes the debt per file and only lets it fall:
//   - off-scale spacing: a non-zero px/rem literal in margin / padding / gap
//     that is not a --space-* step. Hairline compensation (≤ 2px) is exempt.
//     Negative offsets are not counted, same as spacing-tokens.
//   - off-tier breakpoints: a width in an @media prelude that is not one of
//     the two tier boundaries (600 and 1024, with the 599 / 1023 max-width
//     spellings). Container queries are not counted; a component that needs
//     its own threshold should be asking its container anyway.
//
// A file whose count RISES fails: use a --space-* token, or snap the media
// query to a tier (or make it an @container query). A file whose count FALLS
// also fails, until you lock the gain in with:
//
//   UPDATE_LAYOUT_BASELINE=1 npm test -- src/styles/layout-ratchet.test.ts
//
// The update refuses to write while any file is over its baseline, so it can
// only ever lower the numbers.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read
// the stylesheets off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(srcRoot, 'styles', 'layout-ratchet.baseline.json');

type Counts = Record<string, number>;
type Baseline = { spacing: Counts; breakpoints: Counts };

const SPACING_PROPERTY =
  /^(?:margin|padding)(?:-(?:top|right|bottom|left|block|block-start|block-end|inline|inline-start|inline-end))?$|^(?:gap|row-gap|column-gap)$/;
const LENGTH = /(?<![\w.-])([0-9]*\.?[0-9]+)(px|rem)(?![\w-])/g;
const MEDIA_WIDTH = /(?:(?:min|max)-width\s*:\s*|width\s*[<>]=?\s*)([0-9]*\.?[0-9]+)(px|rem|em)/g;
const TIER_WIDTHS_PX = new Set([599, 600, 1023, 1023.98, 1024]);

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function scaleStepsPx(): Set<number> {
  const tokens = readFileSync(join(srcRoot, 'styles', 'tokens.css'), 'utf8');
  const steps = new Set<number>();
  for (const m of tokens.matchAll(/--space-\d+\s*:\s*([0-9.]+)rem\s*;/g))
    steps.add(Number(m[1]) * 16);
  return steps;
}

const toPx = (value: string, unit: string) => Number(value) * (unit === 'px' ? 1 : 16);

function measure(): { counts: Baseline; offenders: Record<string, string[]> } {
  const steps = scaleStepsPx();
  const counts: Baseline = { spacing: {}, breakpoints: {} };
  const offenders: Record<string, string[]> = {};

  for (const file of cssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const lineOf = (index: number) => css.slice(0, index).split('\n').length;
    const hits: string[] = [];

    let spacing = 0;
    for (const decl of css.matchAll(/(^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+);/gm)) {
      if (!SPACING_PROPERTY.test(decl[2])) continue;
      for (const lit of decl[3].matchAll(LENGTH)) {
        const px = toPx(lit[1], lit[2]);
        if (px === 0 || px <= 2 || steps.has(px)) continue;
        spacing++;
        hits.push(`${key}:${lineOf(decl.index)}  ${decl[2]}: ${decl[3].trim()}`);
      }
    }

    let breakpoints = 0;
    for (const media of css.matchAll(/@media([^{]+)\{/g)) {
      for (const w of media[1].matchAll(MEDIA_WIDTH)) {
        if (w[2] === 'px' && TIER_WIDTHS_PX.has(Number(w[1]))) continue;
        breakpoints++;
        hits.push(`${key}:${lineOf(media.index)}  @media${media[1].trimEnd()}`);
      }
    }

    if (spacing) counts.spacing[key] = spacing;
    if (breakpoints) counts.breakpoints[key] = breakpoints;
    if (hits.length) offenders[key] = hits;
  }
  return { counts, offenders };
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('layout ratchet (T135)', () => {
  const { counts, offenders } = measure();
  // A missing file seeds from today's counts (update mode only); after that
  // the update can only lower them.
  const baseline: Baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : counts;

  const compare = (metric: keyof Baseline) => {
    const rose: string[] = [];
    const fell: string[] = [];
    const files = new Set([...Object.keys(counts[metric]), ...Object.keys(baseline[metric])]);
    for (const file of files) {
      const now = counts[metric][file] ?? 0;
      const was = baseline[metric][file] ?? 0;
      if (now > was) rose.push(`${file}: ${was} → ${now}\n    ${offenders[file].join('\n    ')}`);
      if (now < was) fell.push(`${file}: ${was} → ${now}`);
    }
    return { rose, fell };
  };

  if (process.env.UPDATE_LAYOUT_BASELINE) {
    it('writes the lowered baseline', () => {
      const rose = [...compare('spacing').rose, ...compare('breakpoints').rose];
      expect(rose, `Refusing to raise the baseline:\n${rose.join('\n')}`).toEqual([]);
      const next: Baseline = {
        spacing: sorted(counts.spacing),
        breakpoints: sorted(counts.breakpoints),
      };
      writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    });
    return;
  }

  for (const metric of ['spacing', 'breakpoints'] as const) {
    const fix =
      metric === 'spacing'
        ? 'Use a --space-* token (tokens.css) instead of a freehand length.'
        : 'Snap the @media width to a tier boundary (600 / 1024), or use an @container query.';

    it(`no file gains off-${metric === 'spacing' ? 'scale spacing' : 'tier breakpoints'}`, () => {
      const { rose } = compare(metric);
      expect(rose, `${fix}\n${rose.join('\n')}`).toEqual([]);
    });

    it(`the ${metric} baseline is current`, () => {
      const { fell } = compare(metric);
      expect(
        fell,
        `These files improved. Lock it in: UPDATE_LAYOUT_BASELINE=1 npm test -- src/styles/layout-ratchet.test.ts\n${fell.join('\n')}`
      ).toEqual([]);
    });
  }
});
