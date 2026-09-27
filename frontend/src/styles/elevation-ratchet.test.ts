/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Elevation ratchet (T157 W5). 229 raw box-shadow declarations, only 85 on a
// --shadow-* token, ~92 distinct values — the same kind of floating surface
// sat at a different depth on every screen. tokens.css now names one scale
// (--shadow-raised/-tooltip/-card/-modal/-sheet) and most elevation shadows
// were migrated to it; this guard freezes what's left per file and only lets
// it fall, the same shape as layout-ratchet.test.ts (T135).
//
// A raw "elevation" box-shadow layer is one that is not already a
// --shadow-* token AND not one of the two categories that were never in
// scope to convert:
//   - inset shadows (bevels, hairlines, pressed states — not a floating
//     surface)
//   - focus/selection rings: `0 0 0 <spread> <color>` (zero blur, a border
//     standing in for outline, never a drop shadow)
// Everything else left raw (glows/effects with game-state meaning, shadows
// inside @keyframes, one-off hover-lift variants) is deliberately still
// raw — this guard does not distinguish why, it only stops the count from
// climbing. A file whose count RISES fails: snap the new shadow to a
// --shadow-* token, or make it an inset/ring if that's what it actually is.
//
//   UPDATE_ELEVATION_BASELINE=1 npm test -- src/styles/elevation-ratchet.test.ts
//
// The update refuses to write while any file is over its baseline, so it can
// only ever lower the numbers.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(srcRoot, 'styles', 'elevation-ratchet.baseline.json');

type Counts = Record<string, number>;

const RING = /^0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+[\d.]+(?:px|rem|em)\s+\S/;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

// Split a box-shadow value on its top-level commas — a comma nested inside
// rgba(...) / color-mix(...) / var(...) is not a new shadow layer.
function splitLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      layers.push(value.slice(start, i));
      start = i + 1;
    }
  }
  layers.push(value.slice(start));
  return layers;
}

function isRawElevationLayer(layer: string): boolean {
  const t = layer.trim();
  if (!t || /^none$/i.test(t)) return false;
  if (t.includes('var(--shadow-')) return false;
  if (/^inset\b/i.test(t)) return false;
  if (RING.test(t)) return false;
  return true;
}

function measure(): { counts: Counts; offenders: Record<string, string[]> } {
  const counts: Counts = {};
  const offenders: Record<string, string[]> = {};

  for (const file of cssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const lineOf = (index: number) => css.slice(0, index).split('\n').length;
    const hits: string[] = [];

    let n = 0;
    for (const decl of css.matchAll(/(^|[;{}])\s*box-shadow\s*:\s*([^;{}]+);/gm)) {
      for (const layer of splitLayers(decl[2])) {
        if (!isRawElevationLayer(layer)) continue;
        n++;
        hits.push(`${key}:${lineOf(decl.index)}  ${layer.trim()}`);
      }
    }

    if (n) counts[key] = n;
    if (hits.length) offenders[key] = hits;
  }
  return { counts, offenders };
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('elevation ratchet (T157 W5)', () => {
  const { counts, offenders } = measure();
  const baseline: Counts = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : counts;

  const compare = () => {
    const rose: string[] = [];
    const fell: string[] = [];
    const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
    for (const file of files) {
      const now = counts[file] ?? 0;
      const was = baseline[file] ?? 0;
      if (now > was) rose.push(`${file}: ${was} → ${now}\n    ${offenders[file].join('\n    ')}`);
      if (now < was) fell.push(`${file}: ${was} → ${now}`);
    }
    return { rose, fell };
  };

  if (process.env.UPDATE_ELEVATION_BASELINE) {
    it('writes the lowered baseline', () => {
      const { rose } = compare();
      expect(rose, `Refusing to raise the baseline:\n${rose.join('\n')}`).toEqual([]);
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted(counts), null, 2) + '\n');
    });
    return;
  }

  it('no file gains raw (non-token, non-inset, non-ring) elevation shadows', () => {
    const { rose } = compare();
    expect(
      rose,
      `Snap the new box-shadow to a --shadow-* token (tokens.css), or mark it inset/ring if it isn't elevation.\n${rose.join('\n')}`
    ).toEqual([]);
  });

  it('the elevation baseline is current', () => {
    const { fell } = compare();
    expect(
      fell,
      `These files improved. Lock it in: UPDATE_ELEVATION_BASELINE=1 npm test -- src/styles/elevation-ratchet.test.ts\n${fell.join('\n')}`
    ).toEqual([]);
  });
});
