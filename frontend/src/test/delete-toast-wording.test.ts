/**
 * Delete/remove toast wording gate (STYLE_GUIDE § Toasts, board T157).
 *
 * A toast that confirms deleting or removing something is a status fragment,
 * not a sentence: `Deleted {name}` / `Deleted N {things}` / `Removed {name}`,
 * success tone, no trailing period (see `store/decks.ts` deleteDeck for the
 * canonical shape). This scans every `toast.show({…})` / `pushToast({…})`
 * call whose `message` is a plain string or a template literal starting with
 * "Deleted" or "Removed", and fails when that same object literal's `tone`
 * isn't `'success'`, or the message's own text ends in a period.
 *
 * Deliberately narrow, so read the false-negatives as "unproven", not "safe":
 *   - only a top-level `message`/`tone` property assignment is read; a
 *     message built from a ternary or a helper call is skipped rather than
 *     guessed at (e.g. `pages/DeckEditorPage.tsx`'s bulk-remove toast).
 *   - only calls textually named `toast.show` or `pushToast` are matched —
 *     a differently-named local alias for the same store action is invisible
 *     to this guard.
 *   - a message that doesn't start with "Deleted"/"Removed" (e.g. "Request
 *     declined.", "Game night deleted." before this sweep) is out of scope:
 *     this guard only holds the two fixed verb-first openings to their shape,
 *     it doesn't detect every synonym for a deletion.
 *   - test files are skipped, and so are `components/deck/*` and
 *     `components/ProductSearchPanel.tsx` while the T152 sessions hold them.
 *   - a trailing period is allowed after a second sentence ("Deleted Rares.
 *     Its cards moved to other binders."); only the lone fragment is held.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const SKIP_FILE =
  /(\.test\.tsx?$|\.d\.ts$|\/fixtures?\/|__fixtures__|\/components\/deck\/|\/components\/ProductSearchPanel\.tsx$)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !SKIP_FILE.test(p.split(path.sep).join('/'))) out.push(p);
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  message: string;
  reason: string;
}

/** The literal's own text: a plain string, or a template's fixed parts joined
 * around its substitutions (so "Deleted ${name}." reads as "Deleted {…}."). */
function literalText(n: ts.Expression): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n))
    return n.head.text + n.templateSpans.map((s) => '{…}' + s.literal.text).join('');
  return null;
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
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: Violation[] = [];

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (/^(toast\.show|pushToast)$/.test(callee)) {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          let messageText: string | null = null;
          let toneText: string | null = null;
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const name = prop.name.getText(sf);
            if (name === 'message') messageText = literalText(prop.initializer);
            else if (name === 'tone' && ts.isStringLiteral(prop.initializer))
              toneText = prop.initializer.text;
          }
          if (messageText != null && /^(Deleted|Removed)\b/.test(messageText)) {
            // A fragment takes no period; a second sentence ("Deleted Rares. Its
            // cards moved to other binders.") ends the way any sentence does.
            const text = messageText.trimEnd();
            if (text.endsWith('.') && !/\.\s/.test(text.slice(0, -1)))
              out.push({
                file: rel,
                line: line(n),
                message: messageText,
                reason: 'trailing period',
              });
            if (toneText !== 'success')
              out.push({
                file: rel,
                line: line(n),
                message: messageText,
                reason: `tone is ${toneText ?? 'the default (info)'}, not success`,
              });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('delete/remove toast wording (STYLE_GUIDE § Toasts)', () => {
  const files = walk(ROOT);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every "Deleted …" / "Removed …" toast is success-toned with no trailing period', () => {
    const violations = files.flatMap(scan);
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  "${v.message}"  — ${v.reason}`)
      .join('\n');
    expect(violations, `${violations.length} violation(s):\n${report}`).toEqual([]);
  });
});
