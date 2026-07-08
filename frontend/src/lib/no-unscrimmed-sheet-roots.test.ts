/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Guard: a `card-picker-root` sheet that dismisses on a root click and
 * renders no `.card-picker-backdrop` child must dim the page itself —
 * `background: var(--overlay-sheet)` (or `--overlay`) on the root's own
 * scoped class. See STYLE_GUIDE.md "Overlays". This omission shipped
 * THREE times (E95 #1048, re-applied E99, then WelcomeDigest) before being
 * caught mechanically here — this test is what stops a fourth.
 *
 * Heuristic: any `className="card-picker-root <scoped-class>"` literal
 * marks a root that owns a scoped class of its own (the two-place scrim
 * convention). That root passes only if its file also renders
 * `card-picker-backdrop` (the shell's default scrim) or some CSS source
 * sets an overlay background on the scoped class. Simple and
 * low-false-positive by design — a root with no second class relies on
 * some other shell (out of scope for this pattern); extend with a comment
 * rather than weakening the patterns if a real exception shows up.
 */

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function filesWithExt(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesWithExt(full, ext));
    else if (entry.name.endsWith(ext) && !entry.name.endsWith(`.test${ext}`)) out.push(full);
  }
  return out;
}

const ROOT_RE = /className="card-picker-root ([a-zA-Z0-9-]+)/g;
const scrimRe = (scopedClass: string) =>
  new RegExp(`\\.${scopedClass}\\s*\\{[^}]*background:\\s*var\\(--overlay(?:-sheet)?\\)`);

describe('every card-picker-root sheet dims the page', () => {
  it('renders .card-picker-backdrop or scrims its own scoped root class', () => {
    const allCss = filesWithExt(srcRoot, '.css')
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    const offenders: string[] = [];
    for (const file of filesWithExt(srcRoot, '.tsx')) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('card-picker-backdrop')) continue;
      for (const match of content.matchAll(ROOT_RE)) {
        const scopedClass = match[1];
        if (scrimRe(scopedClass).test(allCss)) continue;
        offenders.push(`${file}: .${scopedClass}`);
      }
    }
    expect(
      offenders,
      'Add `background: var(--overlay-sheet)` on the scoped root class (or render .card-picker-backdrop) — see STYLE_GUIDE.md "Overlays"'
    ).toEqual([]);
  });
});
