/**
 * No bare "Loading…" text as a PAGE's whole loading state (board T157).
 *
 * STYLE_GUIDE's rule: skeletons for content, a spinner only for an action in
 * progress, never a bare "Loading…" line standing in for a page's entire
 * pending state. This scans `pages/**` for a JSX text node whose trimmed
 * content is exactly "Loading…" and fails on any new one.
 *
 * Deliberately narrow:
 *   - only an exact "Loading…" JsxText node is flagged. A descriptive bare
 *     line ("Loading printings…", "Loading usage counters…") or a busy
 *     button label swap (`{loading ? 'Loading…' : 'Resume'}`, a string inside
 *     a JSX *expression*, not JsxText) is invisible to this narrow check —
 *     read the ALLOWLIST below and style-guide/components.md § Empty states' "small inline
 *     sub-panel placeholder" carve-out for what was reviewed by eye instead.
 *   - only files directly under `pages/` (not `components/`, `playtest/`) —
 *     the task that added this guard is page-scoped; a component-level bare
 *     "Loading…" (e.g. `components/play/PlayHome.tsx`'s "Next game night"
 *     card) is a secondary-section placeholder, not a page's whole state, and
 *     is unaffected by this guard.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PAGES_DIR = path.resolve(__dirname, '../pages');

/** file (relative to pages/) → how many bare "Loading…" nodes it may keep,
 *  and why none is the page's whole loading state. Keyed by file and count,
 *  not line: a line key broke on every unrelated edit above it. */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  'PlayPage.tsx': {
    count: 1,
    reason:
      'the hidden-games sub-list inside an already-loaded history panel, not the page load — a small inline sub-panel placeholder (style-guide/components.md § Empty states)',
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function scan(file: string): Array<{ file: string; line: number }> {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(PAGES_DIR, file).split(path.sep).join('/');
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: Array<{ file: string; line: number }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && n.text.replace(/\s+/g, ' ').trim() === 'Loading…') {
      out.push({ file: rel, line: line(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.length > (ALLOWLIST[rel]?.count ?? 0) ? out : [];
}

describe('no bare "Loading…" as a page\'s whole loading state', () => {
  const files = walk(PAGES_DIR);

  it('scans the pages tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every page loading state is a skeleton, spinner, or a labeled BrandMark/LoadingView', () => {
    const violations = files.flatMap(scan);
    const report = violations.map((v) => `  pages/${v.file}:${v.line}`).join('\n');
    expect(violations, `${violations.length} bare "Loading…" node(s):\n${report}`).toEqual([]);
  });
});
