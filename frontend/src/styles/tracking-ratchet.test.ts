/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Tracking ratchet (T166). Uppercase labels across the app carried eleven
// different letter-spacing values (0.03em to 0.12em, most of them 0.04em or
// 0.06em) for what reads as one role. E595 then retired the uppercase section
// label altogether (styles/uppercase-role.test.ts): those labels are sentence
// case with normal tracking, so their raw letter-spacing is gone. What is left
// is the --font-label role (tape labels, stamps, print-table th), which keeps
// its own wider tracking (§ App chrome), plus unrelated optical tracking
// (display numerals, wordmarks). This guard freezes the raw (non-token)
// letter-spacing declarations per file and only lets the count fall, the same
// shape as elevation-ratchet.test.ts. Uppercase text that does need tracking
// takes var(--tracking-overline) beside --font-label.
//
//   UPDATE_TRACKING_BASELINE=1 npm test -- src/styles/tracking-ratchet.test.ts
//
// The update refuses to write while any file is over its baseline.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(srcRoot, 'styles', 'tracking-ratchet.baseline.json');

type Counts = Record<string, number>;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** A raw tracking: not a token, not 0/normal/inherit. */
const isRaw = (value: string) =>
  !/var\(--/.test(value) && !/^(0|normal|inherit)$/.test(value.trim());

function measure(): { counts: Counts; offenders: Record<string, string[]> } {
  const counts: Counts = {};
  const offenders: Record<string, string[]> = {};
  for (const file of cssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
      c.replace(/[^\n]/g, ' ')
    );
    const lineOf = (index: number) => css.slice(0, index).split('\n').length;
    const hits: string[] = [];
    for (const decl of css.matchAll(/(^|[;{}])\s*letter-spacing\s*:\s*([^;{}]+);/gm)) {
      if (isRaw(decl[2])) hits.push(`${key}:${lineOf(decl.index)}  ${decl[2].trim()}`);
    }
    if (hits.length) {
      counts[key] = hits.length;
      offenders[key] = hits;
    }
  }
  return { counts, offenders };
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe('tracking ratchet (T166)', () => {
  const { counts, offenders } = measure();
  const baseline: Counts = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : counts;

  const compare = () => {
    const rose: string[] = [];
    const fell: string[] = [];
    for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
      const now = counts[file] ?? 0;
      const was = baseline[file] ?? 0;
      if (now > was) rose.push(`${file}: ${was} → ${now}\n    ${offenders[file].join('\n    ')}`);
      if (now < was) fell.push(`${file}: ${was} → ${now}`);
    }
    return { rose, fell };
  };

  if (process.env.UPDATE_TRACKING_BASELINE) {
    it('writes the lowered baseline', () => {
      const { rose } = compare();
      expect(rose, `Refusing to raise the baseline:\n${rose.join('\n')}`).toEqual([]);
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted(counts), null, 2) + '\n');
    });
    return;
  }

  it('the baseline file exists', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it('no file gains a raw letter-spacing', () => {
    const { rose } = compare();
    expect(
      rose,
      `Use var(--tracking-overline) (tokens.css) on a --font-label stamp instead of a raw em value; sentence-case text takes no tracking.\n${rose.join('\n')}`
    ).toEqual([]);
  });

  it('the baseline has no stale entries', () => {
    const { fell } = compare();
    expect(
      fell,
      `These fell below the baseline; lower it:\n  UPDATE_TRACKING_BASELINE=1 npm test -- src/styles/tracking-ratchet.test.ts\n${fell.join('\n')}`
    ).toEqual([]);
  });
});
