// @vitest-environment node
//
// Guard: retired binder-editor copy must not come back.
//
// E497 reworded the rules editor's "add rule" button and the two Cards
// switch hints because they leaned on internal vocabulary a user never sees
// elsewhere ("released" for deck/cube allocation, "pins" for a manually
// added card) or read worse than the replacement ("Or match other cards
// too" vs. "Also take other cards", under an "or" divider). Scans every
// source file (not just the ones this PR touched) so a copy-paste of the
// old string anywhere fails loudly instead of drifting back in.
//
// Fix a failure by using the replacement string, never by adding the old
// one back or widening this list away from a real regression.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const thisFile = fileURLToPath(import.meta.url);

/** Retired phrase → what replaced it. */
const RETIRED: Record<string, string> = {
  'Or match other cards too': '"Also take other cards" (E497)',
  "until they're released": 'plain deck/cube wording on the Cards switches (E497)',
  'Pins stay put': 'plain "added by hand" wording (E497, never says "pins")',
  'Keep every printing together': '"Keep printings together" (E497)',
  'sort levels': '"First N sorts" — the Page-breaks select (E497)',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (full === thisFile) continue;
    if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.[tj]sx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('retired binder-editor copy', () => {
  it('no source file contains a retired string', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, 'utf8');
      for (const [phrase, use] of Object.entries(RETIRED)) {
        if (text.includes(phrase)) hits.push(`${relative(srcDir, file)}: "${phrase}" → use ${use}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
