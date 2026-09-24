/**
 * Copy guards — the mechanical half of STYLE_GUIDE `## Voice & copy`.
 *
 * Walks every non-test source file under `src/` with the TypeScript AST and
 * checks the user-facing strings (JSX text, copy-carrying JSX attributes and
 * object props, plain string/template literals that read as prose) against
 * the rules that make copy read as machine-written:
 *
 *   EMDASH      — the em-dash is retired from UI copy (period / colon / comma,
 *                 or cut the clause). The "claim — justification" shape was the
 *                 single most-cited tell in the 2026-09 sweep (709 strings).
 *   ELLIPSIS    — the single `…` glyph, never `...` or `&hellip;`.
 *   ADJECTIVE   — no marketing/capability adjectives.
 *   FILLER      — no "please", no "simply".
 *   EG          — no `(e.g. …)` / `i.e.` asides; placeholders show the example.
 *   FINALITY    — the finality clause is exactly "This can't be undone."
 *   EXCLAIM     — no exclamation marks.
 *   APP_SUBJECT — never narrate the app ("SpellControl routes…", "we built…").
 *   TITLE_LONG  — a `title=` over 8 words hides detail from touch; use a
 *                 visible caption or InfoTip.
 *
 * Card names and oracle text are data, not copy: fixtures and tests are
 * excluded, and strings inside console/logger calls are ignored.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname);
const SKIP_FILE =
  /(\.test\.tsx?$|\.d\.ts$|\/fixtures?\/|__fixtures__|__snapshots__|\.stories\.|\/src\/test\/)/;

const COPY_PROPS =
  /^(title|aria-label|aria-description|placeholder|label|hint|tagline|message|description|body|heading|subtitle|caption|tooltip|confirmLabel|cancelLabel|emptyText|helper|text|summary|reason|note|alt|blurb)$/;
const LOG_CALLEE = /^(console\.|logger?\.|debug\b|warn\b|log\b|trace\b|reportError\b)/;

type Rule = [id: string, test: (text: string, kind: string) => boolean, why: string];
const RULES: Rule[] = [
  // A lone trailing glyph ("Bracket —", or "—" alone) is the app's unknown-value placeholder, not prose.
  [
    'EMDASH',
    (s) => /—/.test(s.replace(/(^|\s)—$/, '')),
    'em-dash in UI copy (retired: period, colon, comma, or cut the clause)',
  ],
  ['ELLIPSIS', (s) => /\.\.\.|&hellip;/.test(s), 'use the single … character'],
  [
    'ADJECTIVE',
    (s) =>
      /\b(curated|tailored|intelligent(ly)?|powerful|comprehensive|elevates?|unlocks?|leverages?|seamless(ly)?|robust|effortless(ly)?|cutting-edge|state-of-the-art)\b/i.test(
        s.replace(/Comprehensive Rules/g, '')
      ),
    'marketing/capability adjective',
  ],
  ['FILLER', (s) => /\b(please|simply)\b/i.test(s), 'filler word'],
  [
    'EG',
    (s) => /\(\s*(e\.g\.|i\.e\.)/i.test(s) || /\be\.g\.\s/i.test(s),
    'parenthetical example aside',
  ],
  [
    'FINALITY',
    (s) => /(cannot be undone|can not be undone|there is no undo|no undo\b)/i.test(s),
    'the finality clause is exactly "This can\'t be undone."',
  ],
  ['EXCLAIM', (s) => /[a-z]!(\s|$)/i.test(s), 'no exclamation marks'],
  [
    'APP_SUBJECT',
    (s) =>
      /\bSpellControl (automatically|will|tracks|keeps|routes|knows|hit|uses|sends|stores|reads|checks|remembers)\b/.test(
        s
      ) || /\b[Ww]e (connected|built|filled|snapshot|weighted|picked)\b/.test(s),
    'the app narrated as the subject',
  ],
  [
    'TITLE_LONG',
    (s, kind) => kind === 'attr:title' && s.trim().split(/\s+/).length > 8,
    'title= over 8 words: move the detail to a visible caption or an InfoTip',
  ],
];

function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    // Match on posix separators so the `/src/test/` skip also holds on Windows.
    else if (/\.tsx?$/.test(e.name) && !SKIP_FILE.test(p.split(path.sep).join('/'))) out.push(p);
  }
  return out;
}

function looksLikeCopy(s: string): boolean {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 4 || !/[a-zA-Z]/.test(t) || !/\s/.test(t)) return false;
  // class lists ("btn btn-primary"), paths, code-ish strings
  if (
    /^[\w-]+( [\w-]+)*$/.test(t) &&
    t === t.toLowerCase() &&
    !/[.'’]/.test(t) &&
    t.split(' ').length <= 4
  )
    return false;
  if (/^(https?:|\/|\.\/|@\/|\.\.|\[)/.test(t)) return false;
  if (/[{}<>]/.test(t) && !/[.?!]/.test(t)) return false;
  return true;
}

function insideLogCall(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && LOG_CALLEE.test(p.expression.getText())) return true;
  }
  return false;
}

interface Violation {
  file: string;
  line: number;
  rule: string;
  kind: string;
  text: string;
}

function scan(file: string): Violation[] {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const out: Violation[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const check = (n: ts.Node, kind: string, text: string) => {
    for (const [rule, test] of RULES) {
      if (test(text, kind))
        out.push({
          file: rel,
          line: line(n),
          rule,
          kind,
          text: text.replace(/\s+/g, ' ').trim().slice(0, 120),
        });
    }
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && /[a-zA-Z]/.test(t)) check(n, 'jsx', t);
    } else if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText(sf);
      let v: string | null = null;
      if (ts.isStringLiteral(n.initializer)) v = n.initializer.text;
      else if (
        ts.isJsxExpression(n.initializer) &&
        n.initializer.expression &&
        (ts.isStringLiteral(n.initializer.expression) ||
          ts.isNoSubstitutionTemplateLiteral(n.initializer.expression))
      )
        v = n.initializer.expression.text;
      if (v != null && COPY_PROPS.test(name) && /[a-zA-Z]/.test(v)) check(n, 'attr:' + name, v);
    } else if (
      ts.isPropertyAssignment(n) &&
      (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))
    ) {
      const name = n.name.getText(sf).replace(/['"]/g, '');
      if (COPY_PROPS.test(name) && looksLikeCopy(n.initializer.text))
        check(n, 'prop:' + name, n.initializer.text);
    } else if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
      !ts.isImportDeclaration(n.parent) &&
      !ts.isJsxAttribute(n.parent) &&
      !ts.isPropertyAssignment(n.parent)
    ) {
      const v = n.text;
      if (looksLikeCopy(v) && (/[.?!…—]/.test(v) || v.split(' ').length >= 3) && !insideLogCall(n))
        check(n, 'str', v);
    } else if (ts.isTemplateExpression(n)) {
      const t = n.head.text + n.templateSpans.map((s) => '{…}' + s.literal.text).join('');
      if (looksLikeCopy(t.replace(/\{…\}/g, 'X')) && /[a-zA-Z]{3,}/.test(t) && !insideLogCall(n))
        check(n, 'tpl', t);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('copy guards (STYLE_GUIDE § Voice & copy)', () => {
  const files = walk(ROOT, []);
  const violations = files.flatMap(scan);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const [rule, , why] of RULES) {
    it(`${rule}: ${why}`, () => {
      const hits = violations.filter((v) => v.rule === rule);
      const report = hits.map((v) => `  ${v.file}:${v.line}  [${v.kind}]  ${v.text}`).join('\n');
      expect(hits, `${hits.length} ${rule} violation(s):\n${report}`).toEqual([]);
    });
  }
});
