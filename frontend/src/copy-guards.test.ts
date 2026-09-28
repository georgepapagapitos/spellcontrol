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
 *   INFOTIP_LONG — an InfoTip body is one paragraph of at most 35 words
 *                 (STYLE_GUIDE § Info tooltips, sweep-3). Reads a plain-string
 *                 `text`, inline or a same-file const; a rich node body (lead +
 *                 list, for a multi-point explainer) is exempt.
 *   RETRY      — the retry action label is "Retry", everywhere (board T157).
 *                 Only fires on a `<Button>`/`<button>` child's own JSX text
 *                 or a `toast`/`actionLabel` value that reads exactly "Try
 *                 again" — a full sentence in a message ("Couldn't load X.
 *                 Try again.") is prose, not a label, and is untouched.
 *
 * Card names and oracle text are data, not copy: fixtures and tests are
 * excluded, and strings inside console/logger calls are ignored.
 *
 * A handful of files are mid-sweep in another lane and temporarily excluded
 * from RETRY (see FILE_SKIP below) — swept after that lane merges.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname);
const SKIP_FILE =
  /(\.test\.tsx?$|\.d\.ts$|\/fixtures?\/|__fixtures__|__snapshots__|\.stories\.|\/src\/test\/)/;

const COPY_PROPS =
  /^(title|aria-label|aria-description|placeholder|label|hint|tagline|message|description|body|heading|subtitle|caption|tooltip|confirmLabel|cancelLabel|actionLabel|emptyText|helper|text|summary|reason|note|alt|blurb)$/;
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
  [
    'INFOTIP_LONG',
    (s, kind) => kind === 'infotip:text' && s.trim().split(/\s+/).length > 35,
    'InfoTip body over 35 words: lead with what it means to the player, cut the rest',
  ],
  [
    'RETRY',
    (s, kind) =>
      s.trim() === 'Try again' &&
      (kind === 'jsx:button' || kind === 'prop:actionLabel' || kind === 'attr:actionLabel'),
    'the retry action label is "Retry", not "Try again"',
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

// A JsxText's nearest enclosing element's tag name, so a RETRY-label check
// can tell "Try again" as a <Button>/<button> child from the same words
// inside unrelated prose (a <p>, a <span> reason line, …).
function enclosingTag(n: ts.Node): string | null {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) return p.openingElement.tagName.getText();
  }
  return null;
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
      // The other rules already saw this string as `attr:text` or at its const.
      if (kind === 'infotip:text' && rule !== 'INFOTIP_LONG') continue;
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
  // Same-file string consts, so `<InfoTip text={SOME_TIP} />` is measured too.
  const consts = new Map<string, string>();
  const collect = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))
    )
      consts.set(n.name.text, n.initializer.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const isInfoTipText = (n: ts.JsxAttribute) =>
    n.name.getText(sf) === 'text' &&
    (ts.isJsxSelfClosingElement(n.parent.parent) || ts.isJsxOpeningElement(n.parent.parent)) &&
    n.parent.parent.tagName.getText(sf) === 'InfoTip';
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.initializer && isInfoTipText(n)) {
      const e = n.initializer;
      const v = ts.isStringLiteral(e)
        ? e.text
        : ts.isJsxExpression(e) && e.expression
          ? ts.isStringLiteral(e.expression) || ts.isNoSubstitutionTemplateLiteral(e.expression)
            ? e.expression.text
            : ts.isIdentifier(e.expression)
              ? consts.get(e.expression.text)
              : undefined
          : undefined;
      if (v != null) check(n, 'infotip:text', v);
    }
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && /[a-zA-Z]/.test(t)) {
        const tag = enclosingTag(n);
        check(n, tag === 'Button' || tag === 'button' ? 'jsx:button' : 'jsx', t);
      }
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
