/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Color ratchet (T157 W5). The play/table stylesheets carried ~360 raw color
// literals (hex, rgb/rgba/hsl/hsla) that duplicated the same panel darks,
// hairlines and ink tones across files — e.g. `color-mix(... #2a3340 18%,
// #15171d)` in play-panel-menus.css and the identical pair reappearing as a
// var() fallback three files away. Nobody could change "the table's panel
// color" in one place. tokens.css now names the roles that actually recurred
// (--table-focus-ring, --table-text, --table-ink, --table-ink-inverse,
// --table-ink-muted, --table-border, --table-press-wash, --table-danger-rgb,
// --table-felt-text, --table-felt-line, --table-card-back) and most of their
// usages were migrated; this guard freezes what's left per file and only
// lets it fall, the same shape as layout-ratchet.test.ts (T135) and
// elevation-ratchet.test.ts (T157 W5).
//
// Scope: the play/table stylesheets — the seven files directly under
// styles/ that own the multiplayer board + its panel covers and the solo
// Playtest board, plus every stylesheet under components/play/ and
// playtest/ (the board's own components). Not the rest of the app.
//
// What counts as a raw literal: any hex color (#fff, #2a3340, …) or
// rgb()/rgba()/hsl()/hsla() function call that is not itself a token
// definition (a `--name: <value>;` declaration in :root or a component-local
// custom property like `--pp-base: #2a3340;`) and is not a var() fallback
// (`var(--x, #fallback)`) — those defaults are load-bearing for a
// conditionally-set custom property (a per-seat palette, a portal context
// with no inherited --pp-* vars), verified case by case rather than swept
// mechanically; see the comments beside each one in the CSS.
//
// Deliberately NOT excluded: pure black/white alpha scrims (rgba(0,0,0,X),
// rgba(255,255,255,X) at values with no matching table token). They are
// still real per-file debt — mask-image fade stops, elevation shadows,
// glows, hover washes at a bespoke alpha — and this guard freezes them the
// same as any other literal rather than special-casing "good" vs "bad" raw
// color, matching elevation-ratchet's own precedent ("this guard does not
// distinguish why, it only stops the count from climbing").
//
// A file whose count RISES fails: reuse an existing --table-* token if the
// value matches exactly, name a new one in tokens.css's "Table" block if the
// value recurs, or leave it raw with a comment if it's genuinely a one-off
// effect (a glow, a damage flash, a gradient/mask stop, a seat color from
// game state).
//
//   UPDATE_COLOR_BASELINE=1 npm test -- src/styles/color-ratchet.test.ts
//
// The update refuses to write while any file is over its baseline, so it can
// only ever lower the numbers.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(srcRoot, 'styles', 'color-ratchet.baseline.json');

type Counts = Record<string, number>;

const SCOPE_DIRS = ['components/play', 'playtest'];
const SCOPE_FILES = [
  'styles/play-panel-menus.css',
  'styles/play-counters-panel.css',
  'styles/play-enhancements.css',
  'styles/playtest.css',
  'styles/play-history-inline.css',
  'styles/play-board.css',
  'styles/play-effects.css',
];

// A hex color or an rgb()/rgba()/hsl()/hsla() function call.
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
// A custom-property DECLARATION (`--name: value;`) — its own value is the
// token's source of truth, not a usage to count.
const CUSTOM_PROP_DECL = /^\s*--[\w-]+\s*:/;
// `var(--x, <fallback>)` — the fallback is load-bearing for a conditionally
// set custom property; skip whatever COLOR literal sits inside the whole
// var(...) call.
function varFallbackRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of line.matchAll(/var\([^)]*\)/g)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  return ranges;
}

function cssFilesIn(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesIn(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function scopedFiles(): string[] {
  const files = new Set<string>();
  for (const f of SCOPE_FILES) files.add(join(srcRoot, f));
  for (const d of SCOPE_DIRS) for (const f of cssFilesIn(join(srcRoot, d))) files.add(f);
  return [...files];
}

function measure(): { counts: Counts; offenders: Record<string, string[]> } {
  const counts: Counts = {};
  const offenders: Record<string, string[]> = {};

  for (const file of scopedFiles()) {
    const key = relative(srcRoot, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf8');
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const lines = css.split('\n');
    const hits: string[] = [];
    let n = 0;

    lines.forEach((line, i) => {
      if (CUSTOM_PROP_DECL.test(line)) return; // token/local-var definition, not a usage
      const fallbackRanges = varFallbackRanges(line);
      for (const m of line.matchAll(COLOR)) {
        const idx = m.index!;
        if (fallbackRanges.some(([s, e]) => idx >= s && idx < e)) continue; // var() fallback
        n++;
        hits.push(`${key}:${i + 1}  ${line.trim()}`);
      }
    });

    if (n) counts[key] = n;
    if (hits.length) offenders[key] = hits;
  }
  return { counts, offenders };
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('color ratchet (T157 W5)', () => {
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

  if (process.env.UPDATE_COLOR_BASELINE) {
    it('writes the lowered baseline', () => {
      const { rose } = compare();
      expect(rose, `Refusing to raise the baseline:\n${rose.join('\n')}`).toEqual([]);
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted(counts), null, 2) + '\n');
    });
    return;
  }

  it('no play/table stylesheet gains raw color literals', () => {
    const { rose } = compare();
    expect(
      rose,
      `Reuse a --table-* token (tokens.css), name a new one if the value recurs, or leave it raw with a comment if it's a one-off effect.\n${rose.join('\n')}`
    ).toEqual([]);
  });

  it('the color baseline is current', () => {
    const { fell } = compare();
    expect(
      fell,
      `These files improved. Lock it in: UPDATE_COLOR_BASELINE=1 npm test -- src/styles/color-ratchet.test.ts\n${fell.join('\n')}`
    ).toEqual([]);
  });
});
