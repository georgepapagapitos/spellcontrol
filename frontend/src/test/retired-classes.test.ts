// @vitest-environment node
//
// Guard: a class whose stylesheet is gone must not come back in markup.
//
// T152 W8m replaced `.modal-close` with IconButton variant="quiet" and
// deleted its CSS. A dialog cut before that sweep and
// merged after it (the upgrade plan, #2395) kept `className="modal-close"`,
// and its close button rendered unstyled with no touch floor. The sweep had
// looked for glyph children, not the class string. This scans for the string.
//
// Fix a failure by rendering the primitive the ruling names, never by adding
// the class back to a stylesheet. When a sweep retires a class, add it here.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Retired class → what replaced it. */
const RETIRED: Record<string, string> = {
  'modal-close': 'IconButton variant="quiet" (T152 W8m)',
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/** Every class token a `className` attribute names, across quotes and templates. */
function classTokens(source: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of source.matchAll(/className=(\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
    for (const t of m[1].split(/[^A-Za-z0-9_-]+/)) if (t) tokens.add(t);
  }
  return tokens;
}

describe('retired classes', () => {
  it('no component renders a class whose stylesheet was retired', () => {
    const hits: string[] = [];
    for (const file of tsxFiles(srcDir)) {
      const tokens = classTokens(readFileSync(file, 'utf8'));
      for (const [cls, use] of Object.entries(RETIRED)) {
        if (tokens.has(cls)) hits.push(`${relative(srcDir, file)}: ${cls} → use ${use}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('reads class tokens out of every attribute shape', () => {
    expect(classTokens(`<b className="modal-close x" />`).has('modal-close')).toBe(true);
    expect(classTokens("<b className={`a ${on ? 'modal-close' : ''}`} />").has('modal-close')).toBe(
      true
    );
    expect(classTokens(`<b className="modal-closer" />`).has('modal-close')).toBe(false);
  });
});
