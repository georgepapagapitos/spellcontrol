// @vitest-environment node
//
// Guard: NameInputDialog is create-only (board T157, STYLE_GUIDE § Verbs —
// Rename).
//
// Renaming an existing thing happens in place (InlineRename): activate the
// name, an input swaps in pre-filled and selected, Enter/blur saves, Escape
// reverts. NameInputDialog — the themed `window.prompt` replacement — is for
// naming a thing that doesn't exist yet (a new list, "Save this cube"),
// because there is nothing on screen yet to edit in place. Before T157, list
// and cube rename each reused this same modal; a regression back to that
// shape is exactly the bug this guards.
//
// LIMIT: this is a textual heuristic, not real type/control-flow analysis. It
// finds each `<NameInputDialog` usage's `onSubmit={handlerName}` identifier,
// then locates that identifier's OWN function definition in the same file (by
// brace-matching from its declaration) and checks that body for a call
// matching /\brename\w*\(/i — the codebase's own naming convention for every
// rename mutator (renameDeck, renamePod, renameList, renameSaved,
// renameDeckTag). A handler that calls a differently-named wrapper that
// itself renames would slip past this; keep rename mutators named `rename*`
// (already true everywhere in this repo) and this catches it. An inline
// `onSubmit={(name) => …}` arrow, or a handler not found in the file, falls
// back to scanning the WHOLE FILE for a rename call, which is stricter (a
// false positive is possible if an unrelated rename call lives elsewhere in
// the same file) but never silently skips a file.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) && entry !== 'NameInputDialog.tsx')
      out.push(full);
  }
  return out;
}

const RENAME_CALL = /\brename\w*\s*\(/i;

/** Brace-matched body of `function name(` / `const name = (async)? (`, or
 *  null if no such declaration is found in `source`. */
function functionBody(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`function\\s+${escaped}\\s*\\(`),
    new RegExp(`const\\s+${escaped}\\s*=\\s*(async\\s*)?\\(`),
  ];
  let start = -1;
  for (const p of patterns) {
    const m = p.exec(source);
    if (m) {
      start = m.index;
      break;
    }
  }
  if (start === -1) return null;
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

describe('NameInputDialog is create-only', () => {
  for (const file of sourceFiles(srcDir)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('<NameInputDialog')) continue;
    const rel = relative(srcDir, file).split(sep).join('/');

    const submits = [
      ...source.matchAll(/<NameInputDialog[\s\S]*?onSubmit=\{\s*([A-Za-z0-9_]+)\s*\}/g),
    ].map((m) => m[1]);

    it(`${rel}: every onSubmit handler calls no rename/update mutator`, () => {
      expect(
        submits.length,
        'expected at least one onSubmit={…} on <NameInputDialog'
      ).toBeGreaterThan(0);
      for (const handler of submits) {
        const body = functionBody(source, handler) ?? source;
        expect(
          body,
          `${rel}: onSubmit={${handler}} calls a rename/update mutator — NameInputDialog is create-only (STYLE_GUIDE § Verbs — Rename); rename an existing thing in place with InlineRename instead`
        ).not.toMatch(RENAME_CALL);
      }
    });
  }
});
