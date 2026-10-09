/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// Data-role ratchet (board E596). STYLE_GUIDE § Typography gives `--font-mono`
// (IBM Plex Mono in the default set) the Data role only: prices, quantities,
// counts, set codes, collector numbers, tabular numerals, code. Never prose,
// hints, captions, descriptors, labels or names. A design review named "very
// faint monospaced font for descriptors" as a tell of AI-built UI, and the
// app had ~190 rules reaching for the data face, a quarter of them on muted
// meta text. The 2026-10 audit moved every prose/descriptor rule to the body
// role and left only data on mono.
//
// This guard freezes what is left per file and lets it fall:
//   1. the count of `font-family` declarations that use `var(--font-mono…)`
//      may not rise above `font-mono-ratchet.baseline.json` (a new rule means
//      the content really is data, and the baseline moves up in the same PR
//      with the reason in the commit; prefer `font-variant-numeric:
//      tabular-nums` on the body face for alignment alone);
//   2. no stylesheet outside tokens.css / typesets.css / the @font-face sheets
//      may name a face by literal ('IBM Plex Mono', 'Bebas Neue'): type sets
//      swap faces through the role tokens, so a literal pins one set's face.
//
// Lowering after a cleanup:
//   UPDATE_FONT_MONO_BASELINE=1 npm test -- src/styles/font-mono-ratchet.test.ts
// The update refuses to write while any file is over its baseline.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');
const BASELINE_PATH = join(here, 'font-mono-ratchet.baseline.json');

// The sheets that define or declare faces. Everything else uses the tokens.
const FACE_SHEETS = new Set([
  'styles/tokens.css',
  'styles/typesets.css',
  'styles/fonts.css',
  'styles/play-fonts.css',
  'styles/icon-fonts.css',
]);

interface Baseline {
  mono: Record<string, number>;
  literal: Record<string, number>;
}

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

function measure(): Baseline {
  const mono: Record<string, number> = {};
  const literal: Record<string, number> = {};
  for (const file of cssFiles(srcRoot)) {
    const rel = relative(srcRoot, file).split(sep).join('/');
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      for (const d of m[2].matchAll(/font-family\s*:\s*([^;]+)/g)) {
        const value = d[1];
        if (/var\(--font-mono\b/.test(value)) mono[rel] = (mono[rel] ?? 0) + 1;
        if (selector.startsWith('@font-face') || FACE_SHEETS.has(rel)) continue;
        if (/['"]/.test(value)) literal[rel] = (literal[rel] ?? 0) + 1;
      }
    }
  }
  return { mono, literal };
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

function over(current: Record<string, number>, base: Record<string, number>): string[] {
  return Object.entries(current)
    .filter(([file, n]) => n > (base[file] ?? 0))
    .map(([file, n]) => `${file}: ${n} (baseline ${base[file] ?? 0})`);
}

describe('font-mono ratchet (the data role)', () => {
  const current = measure();
  const baseline: Baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : { mono: {}, literal: {} };

  if (process.env.UPDATE_FONT_MONO_BASELINE) {
    const bad = [...over(current.mono, baseline.mono), ...over(current.literal, baseline.literal)];
    if (bad.length && existsSync(BASELINE_PATH))
      throw new Error(`Refusing to raise the baseline:\n${bad.join('\n')}`);
    const sorted = (r: Record<string, number>) =>
      Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify({ mono: sorted(current.mono), literal: sorted(current.literal) }, null, 2) +
        '\n'
    );
  }

  it('does not add --font-mono rules (data only: prices, qty, codes, numerals)', () => {
    // Each offender's content must be data. If it is a hint, caption, label,
    // name or sentence, delete the font-family so it inherits the body role.
    expect(over(current.mono, baseline.mono)).toEqual([]);
    expect(sum(current.mono)).toBeLessThanOrEqual(sum(baseline.mono));
  });

  it('never names a face by literal outside the token and @font-face sheets', () => {
    // Use var(--font-serif | --font-display | --font-label | --font-mono) so a
    // type set can swap the face. The baseline holds the legacy literals.
    expect(over(current.literal, baseline.literal)).toEqual([]);
  });
});
