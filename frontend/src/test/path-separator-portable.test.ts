// Guard: tests that walk the tree compare paths the same way on every OS.
//
// WHY. CI runs on Linux, so a test that assumes `/` in a filesystem path passes
// there and fails only on a Windows checkout. Two did: dark-island-link-scope
// compared `relative()` output (backslashes on Windows) against a set of
// `/` paths, and panel-room-cap took a file name with `.split('/').pop()`,
// which returns the whole path on Windows, so its exemption list never matched.
//
// Fix: `basename(f)` for a file name, and `relative(a, b).split(sep).join('/')`
// before comparing or keying a relative path. A `relative()` used only inside
// a failure message is fine.

import { describe, expect, it } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { SRC } from './import-graph';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.tsx?$/.test(name) && name !== 'path-separator-portable.test.ts')
      out.push(full);
  }
  return out;
}

const RULES: Array<[string, RegExp]> = [
  // A file name split off a filesystem path on '/'.
  ["`.split('/').pop()`: use basename()", /\.split\(\s*['"]\/['"]\s*\)\.pop\(\)/],
  // A list of relative paths that never normalizes the separator.
  [
    "`.map(x => relative(...))` without `.split(sep).join('/')`",
    /\.map\(\s*\(?\s*\w+\s*\)?\s*=>\s*relative\([^()]*\)\s*\)/,
  ],
];

describe('tree-walking tests are path-separator portable', () => {
  it('has no slash-only path handling', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const [label, re] of RULES) {
        if (re.test(text)) offenders.push(`${relative(SRC, file).split(sep).join('/')}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
