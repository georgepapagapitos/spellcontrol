// Guard: no source file contains a NUL or other C0 control byte (tab, newline
// and carriage return are fine).
//
// WHY. A shell or string-replace write once turned a CSS `'\00b7'` into a
// literal NUL byte. Every check passed (stylelint, prettier, a rule guard that
// only looked at the selector) while the browser drew a tofu glyph. Escape
// sequences belong in files written with the editor tools, and this catches the
// ones that slip through.
//
// Binary assets are skipped. KNOWN_EXCEPTIONS lists files that hold one on
// purpose; do not add to it, fix the file.

import { describe, expect, it } from 'vitest';
import { join, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { SRC } from './import-graph';

const TEXT = /\.(ts|tsx|css|json|md|html|js|mjs)$/;

/** `lib/binder/binder-moves.ts` keeps a NUL inside a sentinel string on purpose. */
const KNOWN_EXCEPTIONS = new Set(['lib/binder/binder-moves.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEXT.test(name)) out.push(full);
  }
  return out;
}

/** C0 controls except tab (9), newline (10) and carriage return (13). */
function hasControlByte(bytes: Uint8Array): boolean {
  return bytes.some((b) => b < 32 && b !== 9 && b !== 10 && b !== 13);
}

describe('source files hold no control bytes', () => {
  it('has none outside the known exceptions', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (KNOWN_EXCEPTIONS.has(rel)) continue;
      if (hasControlByte(readFileSync(file))) offenders.push(rel);
    }
    expect(offenders, 'write escapes with the editor tools, not a shell').toEqual([]);
  });
});
