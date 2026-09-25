/**
 * The generation takeover shows two things at once: the generator's live
 * `message` and a step list lit by `percent` (MILESTONES in
 * GenerationTakeover.tsx). When a message names a step, that step must be the
 * one the list shows as active at the message's percent. E411: the full path
 * opened on "Shuffling up…" (the last step's label) at 5%, while the list lit
 * step one; the Scryfall fallback said "Summoning creatures…" at 60%, two steps
 * past it; and the batch fetch's "Scrying the multiverse…" climbed to 35%, the
 * first percent of "Summoning creatures".
 *
 * Fix a failure by rewording the message so it names no other step, or by
 * moving its percent into the step it names.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const takeover = fs.readFileSync(path.join(__dirname, 'GenerationTakeover.tsx'), 'utf8');
const milestones = [...takeover.matchAll(/\{ at: (\d+), label: '([^']+)' \}/g)].map((m) => ({
  at: Number(m[1]),
  label: m[2],
}));

function activeLabel(percent: number): string {
  return milestones.reduce((acc, m) => (percent >= m.at ? m.label : acc), milestones[0].label);
}

// `onProgress?.('msg', 12)`, a type pass's `'msg',\n 35\n)` argument pair, a
// scaled `'msg', 25 + Math.round((done / total) * 9))` (read at its top, 34),
// and the hook's `{ message: 'msg', percent: 5 }` seed. A percent held in a
// variable escapes this scan, so write the expression inline.
const PAIR =
  /'([^'\n]+)',\s*(\d+)(?:\s*\+\s*Math\.round\([^;]*?\*\s*(\d+)\))?\s*\)|message: '([^'\n]+)', percent: (\d+)/g;

const emitted = [
  ...sourceFiles(path.join(SRC, 'deck-builder/services')),
  path.join(SRC, 'lib/use-deck-generation.ts'),
].flatMap((file) =>
  [...fs.readFileSync(file, 'utf8').matchAll(PAIR)].map((m) => ({
    file: path.relative(SRC, file),
    message: m[1] ?? m[4],
    percent: Number(m[2] ?? m[5]) + Number(m[3] ?? 0),
  }))
);

describe('generation progress messages match the takeover step list', () => {
  it('parses the step list and the emitted messages', () => {
    expect(milestones.length).toBeGreaterThanOrEqual(5);
    expect(emitted.filter((e) => e.message.endsWith('…')).length).toBeGreaterThan(20);
  });

  it('a message that names a step is emitted while that step is active', () => {
    const wrong = emitted.flatMap((e) =>
      milestones
        .filter((m) => e.message.includes(m.label) && m.label !== activeLabel(e.percent))
        .map(
          (m) =>
            `${e.file}: "${e.message}" at ${e.percent}% names "${m.label}", ` +
            `but the list shows "${activeLabel(e.percent)}"`
        )
    );
    expect(wrong).toEqual([]);
  });
});
