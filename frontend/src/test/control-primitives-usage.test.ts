// @vitest-environment node
//
// Guard: action controls come from the control primitives (board T152, E435).
//
// `components/shared/Button` renders `Button` and `IconButton` over the
// long-standing classes (.btn, .pill-btn, .btn-link, .toolbar-pill and their
// variants), and it is what puts the label in its own element, hides the
// icon, defaults `type="button"` and makes navigation a link. A raw
// `className="btn …"` skips all of that, so this counts two shapes per file
// and fails when one appears in a new file or grows in a listed one:
//
//   - rawClass: a *className attribute carrying one of the shared control
//     classes (use Button, or IconButton with a variant)
//   - iconOnly: a native <button> whose only child is a glyph (use IconButton,
//     which requires a label and hides the glyph)
//
// The files below are the migration still to do, one wave at a time; a
// migrated file must leave the list (the stale check enforces it). PERMANENT
// entries carry a reason. Everything else in the list is debt, not precedent:
// fix a new match with the primitive, never by adding it here.
//
// Parsed with the TypeScript AST rather than a regex, because the classes
// arrive through ternaries, template literals and trigger props that a
// pattern over the source misses or double-counts.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SHARED_CLASSES = new Set([
  'btn',
  'btn-primary',
  'btn-danger',
  'btn-link',
  'pill-btn',
  'pill-btn-primary',
  'pill-btn-danger',
  'toolbar-pill',
  // No stylesheet defines these three. They paint as plain `.btn` and are
  // dropped as each site migrates.
  'btn-sm',
  'btn-secondary',
  'btn-quiet',
]);

type Shape = 'rawClass' | 'iconOnly' | 'rawChip';

/** A chip family's class (`verdict-chip`, `coach-feed-filter-chip--owned-empty`), not a part (`-chip-label`) or a container (`-chips`). */
const CHIP_CLASS = /^[a-z][a-z0-9-]*-chip(--[a-z0-9-]+)?$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every string piece in an attribute's value: literals, template parts, ternary arms. */
function strings(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      strings(span.expression, out);
      out.push(span.literal.text);
    }
  } else ts.forEachChild(node, (child) => void strings(child, out));
  return out;
}

const isGlyph = (node: ts.JsxChild, sf: ts.SourceFile): boolean =>
  (ts.isJsxSelfClosingElement(node) && /^[A-Z]/.test(node.tagName.getText(sf))) ||
  (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'svg');

function count(file: string): Record<Shape, number> {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const n: Record<Shape, number> = { rawClass: 0, iconOnly: 0, rawChip: 0 };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && /className$/i.test(node.name.getText(sf)) && node.initializer) {
      const tokens = strings(node.initializer).join(' ').split(/\s+/);
      if (tokens.some((t) => SHARED_CLASSES.has(t))) n.rawClass++;
      // A chip class on a raw element (lowercase tag, or a router Link):
      // `<Chip className=…>` is the primitive and does not count.
      const tag = (node.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf);
      if ((/^[a-z]/.test(tag) || tag === 'Link') && tokens.some((t) => CHIP_CLASS.test(t)))
        n.rawChip++;
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'button') {
      const kids = node.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
      if (kids.length === 1 && isGlyph(kids[0], sf)) n.iconOnly++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

const TOOLBAR_FAMILY =
  'PERMANENT: a toolbar-control primitive rendering its own .toolbar-pill trigger';
const CARD_ART =
  'PERMANENT: a card-art thumbnail used as a button is a bespoke control (E435 scope ruling), not a glyph';
const STRUCTURE =
  'PERMANENT: named -chip but a container with its own controls or structure (a rule-builder token, a list wrapper, a drag-reorder item), not a Chip role';
const NAV_LINK = 'PERMANENT: a router Link styled as a chip; Chip has no link role for one site';
const BOARD_CHROME =
  'PERMANENT: playtest and live-table board chrome is a bespoke control (E435 scope ruling)';

/** Files still to migrate, with their current counts. Lower as each wave lands. */
const ALLOWED: Record<Shape, Record<string, number | { count: number; why: string }>> = {
  rawClass: {
    'components/SelectMenu.tsx': { count: 1, why: TOOLBAR_FAMILY },
    'components/shared/ToolbarPopover.tsx': { count: 1, why: TOOLBAR_FAMILY },
    'components/Legend.tsx': { count: 1, why: TOOLBAR_FAMILY },
    'pages/DeckEditorPage.tsx': 3,
  },
  iconOnly: {
    'components/CollectionFiltersDialog.tsx': 1,
    'components/ComboFiltersPopover.tsx': 1,
    'components/deck/CommanderSearch.tsx': 1,
    'components/deck/DeckCardRow.tsx': { count: 2, why: CARD_ART },
    'components/deck/DeckSizePrompt.tsx': { count: 1, why: CARD_ART },
    'components/DeckFiltersPopover.tsx': 1,
    'components/trade/TradeAcceptDialog.tsx': { count: 1, why: CARD_ART },
    'components/trade/TradeComposer.tsx': { count: 2, why: CARD_ART },
    'playtest/components/CardCounters.tsx': { count: 1, why: BOARD_CHROME },
  },
  rawChip: {
    'components/CardOtagsSheet.tsx': { count: 1, why: NAV_LINK },
    'components/ChipExpressionBuilder.tsx': { count: 1, why: STRUCTURE },
    'components/deck/BracketBreakdown.tsx': { count: 1, why: STRUCTURE },
    'components/deck/GenerationModePicker.tsx': 2,
    'components/DiscoverFiltersPopover.tsx': 6,
    'components/play/GameBoard.tsx': { count: 5, why: BOARD_CHROME },
    'components/play/GameMenu.tsx': { count: 5, why: BOARD_CHROME },
    'components/play/OnlineGameView.tsx': { count: 4, why: BOARD_CHROME },
    'components/play/PhaseChip.tsx': { count: 2, why: BOARD_CHROME },
    'components/SortValueOrderEditor.tsx': { count: 1, why: STRUCTURE },
    'components/trade/TradeOfferList.tsx': { count: 1, why: CARD_ART },
    'playtest/components/CardStatusStrip.tsx': { count: 2, why: BOARD_CHROME },
    'playtest/components/LifeStrip.tsx': { count: 2, why: BOARD_CHROME },
    'playtest/components/PlaytestBoard.tsx': { count: 5, why: BOARD_CHROME },
  },
};

const HOW: Record<Shape, string> = {
  rawClass:
    'Render Button (or IconButton with a variant) from components/shared/Button instead of the raw class.',
  iconOnly:
    'Render IconButton from components/shared/Button: it requires a label and hides the glyph.',
  rawChip:
    'Render Chip from components/shared/Chip: it picks the element for the role and puts the label in its own element.',
};

const allowedCount = (entry: number | { count: number } | undefined) =>
  typeof entry === 'number' ? entry : (entry?.count ?? 0);

describe('action controls come from the control primitives', () => {
  const found: Record<Shape, Map<string, number>> = {
    rawClass: new Map(),
    iconOnly: new Map(),
    rawChip: new Map(),
  };
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (rel === 'components/shared/Button.tsx' || rel === 'components/shared/Chip.tsx') continue;
    const n = count(file);
    for (const shape of Object.keys(n) as Shape[]) if (n[shape]) found[shape].set(rel, n[shape]);
  }

  for (const shape of Object.keys(ALLOWED) as Shape[]) {
    it(`no new ${shape} outside the allowlist`, () => {
      const over = [...found[shape]]
        .filter(([file, n]) => n > allowedCount(ALLOWED[shape][file]))
        .map(([file, n]) => `${file} (${n}, allowed ${allowedCount(ALLOWED[shape][file])})`);
      expect(over, `${HOW[shape]}\n  ${over.join('\n  ')}`).toEqual([]);
    });

    it(`the ${shape} allowlist has no stale entries`, () => {
      const stale = Object.entries(ALLOWED[shape])
        .filter(([file, entry]) => (found[shape].get(file) ?? 0) < allowedCount(entry))
        .map(
          ([file, entry]) =>
            `${file} (allowed ${allowedCount(entry)}, found ${found[shape].get(file) ?? 0})`
        );
      expect(stale, 'Lower or delete these entries:\n  ' + stale.join('\n  ')).toEqual([]);
    });
  }

  it('the scan sees the codebase (guards the guard)', () => {
    // A parser change that silently matched nothing would pass every case
    // above. The primitive's own tests use it, and so must real call sites.
    const total = [...found.rawClass.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });
});
