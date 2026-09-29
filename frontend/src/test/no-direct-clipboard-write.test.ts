// @vitest-environment node
//
// Guard: no `.tsx` file calls `navigator.clipboard.writeText` directly.
// Everything that copies plain text to the clipboard goes through
// `lib/util/clipboard.ts`'s `copyToClipboard` (a plain async helper, safe to call
// from any event handler) or the React-only `useCopyFeedback`/
// `CopyButton`/`CopyIconButton` built on it (STYLE_GUIDE § Verbs — Copy) —
// so a denied clipboard (an insecure origin, a WebView that refuses) is
// handled the same way everywhere instead of each call site inventing its
// own try/catch and its own wording. Before this guard, copy confirmed two
// ways (an inline "Copied" label vs a toast) with three different durations
// and inconsistent failure handling across ~20 call sites.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(fileURLToPath(import.meta.url), '..', '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(srcDir, file).split(sep).join('/');

const DIRECT_WRITE = /navigator\s*\.\s*clipboard\s*\.\s*writeText\s*\(/;

/**
 * Files that legitimately call `navigator.clipboard.writeText` directly,
 * each with the reason it is exempt rather than routed through the helper.
 */
const ALLOWLIST: Record<string, string> = {
  // Cube build is a different session's active lane (board T157) — left
  // alone on purpose rather than migrated alongside CubeDetailPage's copy.
  'pages/cube/CubeBuildPage.tsx': 'another in-flight lane owns this file; not migrated here',
};

describe('every clipboard-text write goes through the shared helper', () => {
  const files = tsxFiles(srcDir);

  const offenders: string[] = [];
  for (const file of files) {
    const path = rel(file);
    if (path in ALLOWLIST) continue;
    const code = readFileSync(file, 'utf8');
    if (DIRECT_WRITE.test(code)) offenders.push(path);
  }

  it('no .tsx file writes to the clipboard directly', () => {
    expect(
      offenders,
      'These call navigator.clipboard.writeText directly instead of going through ' +
        'lib/util/clipboard.ts (copyToClipboard), lib/util/use-copy-feedback.ts, or ' +
        'components/shared/CopyButton.tsx. Route the write through one of those, ' +
        'or add a commented allowlist entry above:\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((path) => {
      const full = join(srcDir, ...path.split('/'));
      try {
        return !DIRECT_WRITE.test(readFileSync(full, 'utf8'));
      } catch {
        return true; // file no longer exists
      }
    });
    expect(
      stale,
      'These no longer call navigator.clipboard.writeText directly (or no longer ' +
        'exist) — remove the entry:\n  ' +
        stale.join('\n  ')
    ).toEqual([]);
  });

  it('the scan sees the codebase (guards the guard)', () => {
    // A parser/path change that silently matched nothing would pass every
    // case above.
    expect(files.length).toBeGreaterThan(50);
  });
});
