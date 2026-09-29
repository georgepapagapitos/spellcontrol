/**
 * Icon scale guard — the mechanical half of STYLE_GUIDE `## Icon scale`
 * (board T157, "icons sit on one size and stroke scale").
 *
 * Walks every non-test source file under `src/` with the TypeScript AST,
 * finds JSX elements for a name imported from `lucide-react`, and checks any
 * numeric-literal `size=`/`width=`/`height=`/`strokeWidth=` against the five
 * (size, strokeWidth) pairs the scale allows:
 *
 *   12 / 2    micro (badges, tags, dense-row/no-prose controls)
 *   14 / 1.8  inline-with-text (a glyph beside a rendered word/phrase)
 *   16 / 2    standalone trigger (icon-only or icon+chevron control)
 *   18 / 2    hero-adjacent (next to a page-hero heading/CTA)
 *   20 / 1.8  large control (a bigger dismiss/primary standalone icon)
 *
 * A literal size outside {12,14,16,18,20} fails. A literal size on the scale
 * whose strokeWidth (explicit, or the lucide default of 2 when the attribute
 * is omitted) doesn't match that size's canonical stroke also fails — so a
 * 14px icon left at the lucide default of 2 fails just as loudly as one
 * explicitly set to 2.4.
 *
 * Icons whose size comes from a prop/expression (not a numeric literal) are
 * invisible to this guard by construction — that's "computed," out of scope
 * per the T157 brief, and the point where a codemod would silently do the
 * wrong thing.
 *
 * ALLOWLIST below covers two kinds of exception:
 *  - whole files/directories another T157 lane has open right now (icon
 *    scale work there is deferred until that lane lands — see the do-not-
 *    touch list in the T157 brief);
 *  - specific sites that are deliberately off-scale (a miniature preview
 *    badge, an empty-state mark, a live-game touch target, a scanner/camera
 *    CTA) and were left alone on purpose during the T157 migration.
 * Anything not on this list is a real regression, not a style choice.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ICON_SCALE } from '@/lib/util/icon-scale';

const ROOT = path.resolve(__dirname, '..');
const SKIP_FILE = /(\.test\.tsx?$|\.d\.ts$|\/fixtures?\/|__fixtures__|__snapshots__|\.stories\.)/;

// size -> canonical strokeWidth, read from the one home of the scale so the
// guard and lib/util/icon-scale.ts cannot disagree.
const SCALE: Record<string, string> = Object.fromEntries(
  Object.values(ICON_SCALE).map(({ size, stroke }) => [String(size), String(stroke)])
);

// Whole files/directories another session owns right now (T157 brief's
// "do not touch" list). Re-run this guard once each lane lands and drop its
// entry — it should then either pass on its own or need a site-level
// allowlist entry below.
const FILE_ALLOWLIST = [
  'components/deck/DeckCardGrid.tsx',
  'components/deck/DeckDisplay.tsx',
  'components/deck/DeckMainboardRow.tsx',
  'components/deck/deck-display-icons.tsx',
  'components/deck/deck-display-rows.ts',
  'components/shared/EmptyState.tsx',
  'components/collection/StatsBar.tsx',
  'components/collection/CardListTable.tsx',
  'components/home/',
  'pages/CollectionPage.tsx',
  'pages/HomePage.tsx',
  'pages/BindersIndexPage.tsx',
  'pages/DecksIndexPage.tsx',
  'pages/ListsPage.tsx',
  'pages/cube/CubeCommanders.tsx',
  'lib/cube/',
  'lib/collection/allocations',
  'lib/collection/collection-insights.ts',
  'lib/home/home-signals.ts',
  'lib/collection/format-money.ts',
];

// Specific (file, tag, size) sites left deliberately off-scale. Keyed loosely
// (not by stroke) so a *different* off-scale value showing up later at the
// same spot still fails — only the exact known exception is silent.
const SITE_ALLOWLIST = new Set<string>([
  // Miniature badge sized to a binder-slot overlay at variable grid density,
  // not a role-governed action icon.
  'components/binder/BinderPagePreview.tsx::Boxes::9',
  'components/binder/BinderPagePreview.tsx::Layers::9',
  'components/binder/CardSlot.tsx::Boxes::9',
  'components/binder/CardSlot.tsx::Layers::9',
  // Empty/error-state illustrative mark, paired with a caption.
  'components/deck/DeckCardInspector.tsx::ImageOff::22',
  'components/deck/DeckHoverPeek.tsx::ImageOff::22',
  // Primary live-game hub control — oversized on purpose for touch
  // ergonomics during play.
  'components/play/GameBoard.tsx::Swords::22',
  'components/play/GameBoard.tsx::X::22',
  'components/play/GameBoard.tsx::Menu::22',
  // Seat-avatar placeholder glyph sized to the avatar circle, not an action.
  'components/play/OnlineLobby.tsx::UserRound::22',
  // Large camera/scan CTA and scanner-overlay glyphs (STYLE_GUIDE calls out
  // the scanner overlay by name as a deliberate-large exception).
  'components/import/AddCardsSheet.tsx::Camera::36',
  'components/scanner/CardScanner.tsx::LoaderCircle::34',
  'components/scanner/ScannerQueueSheet.tsx::Camera::32',
  // Large stat-emphasis glyph in a game sheet.
  'components/play/BoardSheets.tsx::ChartLine::40',
  // Device-rotate prompt hero glyph.
  'playtest/components/RotatePrompt.tsx::Smartphone::48',
]);

function fileAllowed(rel: string): boolean {
  return FILE_ALLOWLIST.some((p) => rel === p || rel.startsWith(p));
}

function walk(dir: string, out: string[]): string[] {
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
  tag: string;
  size: string;
  stroke: string;
  why: string;
}

function numericLiteralText(expr: ts.Expression | undefined): string | undefined {
  if (!expr) return undefined;
  if (ts.isNumericLiteral(expr)) return expr.text;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  )
    return '-' + expr.operand.text;
  return undefined;
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

  const lucideNames = new Set<string>();
  sf.forEachChild((n) => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text === 'lucide-react' &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    ) {
      for (const el of n.importClause.namedBindings.elements) lucideNames.add(el.name.text);
    }
  });
  if (lucideNames.size === 0) return out;

  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tagName = n.tagName.getText(sf);
      if (lucideNames.has(tagName)) {
        let sizeAttr: string | undefined;
        let widthAttr: string | undefined;
        let heightAttr: string | undefined;
        let strokeAttr: string | undefined;
        for (const prop of n.attributes.properties) {
          if (!ts.isJsxAttribute(prop) || !prop.initializer) continue;
          if (!ts.isJsxExpression(prop.initializer) || !prop.initializer.expression) continue;
          const name = prop.name.getText(sf);
          const val = numericLiteralText(prop.initializer.expression);
          if (val === undefined) continue;
          if (name === 'size') sizeAttr = val;
          else if (name === 'width') widthAttr = val;
          else if (name === 'height') heightAttr = val;
          else if (name === 'strokeWidth') strokeAttr = val;
        }
        const size = sizeAttr ?? widthAttr ?? heightAttr;
        if (size !== undefined) {
          const key = `${rel}::${tagName}::${size}`;
          if (!fileAllowed(rel) && !SITE_ALLOWLIST.has(key)) {
            if (!(size in SCALE)) {
              out.push({
                file: rel,
                line: line(n),
                tag: tagName,
                size,
                stroke: strokeAttr ?? 'default(2)',
                why: `size ${size} is not on the scale (12/14/16/18/20)`,
              });
            } else {
              const expected = SCALE[size];
              const actual = strokeAttr ?? '2';
              if (Number(actual) !== Number(expected)) {
                out.push({
                  file: rel,
                  line: line(n),
                  tag: tagName,
                  size,
                  stroke: actual,
                  why: `size ${size} wants strokeWidth ${expected}, got ${actual}`,
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('icon scale (STYLE_GUIDE § Icon scale)', () => {
  const files = walk(ROOT, []);
  const violations = files.flatMap(scan);

  it('has no lucide icon off the (size, strokeWidth) scale', () => {
    if (violations.length > 0) {
      const report = violations
        .map(
          (v) => `${v.file}:${v.line} <${v.tag}> size=${v.size} strokeWidth=${v.stroke} — ${v.why}`
        )
        .join('\n');
      expect.fail(`${violations.length} icon(s) off the scale:\n${report}`);
    }
    expect(violations).toEqual([]);
  });
});
