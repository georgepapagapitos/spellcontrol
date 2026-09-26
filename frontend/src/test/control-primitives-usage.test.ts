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

type Shape = 'rawClass' | 'iconOnly';

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
  const n: Record<Shape, number> = { rawClass: 0, iconOnly: 0 };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && /className$/i.test(node.name.getText(sf)) && node.initializer) {
      const tokens = strings(node.initializer).join(' ').split(/\s+/);
      if (tokens.some((t) => SHARED_CLASSES.has(t))) n.rawClass++;
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

/** Files still to migrate, with their current counts. Lower as each wave lands. */
const ALLOWED: Record<Shape, Record<string, number | { count: number; why: string }>> = {
  rawClass: {
    'components/SelectMenu.tsx': { count: 1, why: TOOLBAR_FAMILY },
    'components/shared/ToolbarPopover.tsx': { count: 1, why: TOOLBAR_FAMILY },
    'components/Legend.tsx': { count: 1, why: TOOLBAR_FAMILY },
    'pages/DeckEditorPage.tsx': 3,
  },
  iconOnly: {
    'components/AddCardSearchPanel.tsx': 1,
    'components/AddCardsSheet.tsx': 1,
    'components/AvatarPickerSheet.tsx': 1,
    'components/BinderBadge.tsx': 1,
    'components/BinderCardEditor.tsx': 1,
    'components/BinderEditor.tsx': 2,
    'components/BinderPagePreview.tsx': 1,
    'components/BinderTabs.tsx': 1,
    'components/BookmarkButton.tsx': 1,
    'components/CardPreview.tsx': 1,
    'components/CollectionExportDialog.tsx': 1,
    'components/CollectionFiltersDialog.tsx': 2,
    'components/ColorPicker.tsx': 1,
    'components/ComboFiltersPopover.tsx': 1,
    'components/deck/BuildReportPanel.tsx': 1,
    'components/deck/BuildReportSheet.tsx': 1,
    'components/deck/BuildTimeCoachStrip.tsx': 1,
    'components/deck/BuyListDialog.tsx': 1,
    'components/deck/CommanderSearch.tsx': 1,
    'components/deck/DeckAiRefine.tsx': 2,
    'components/deck/DeckCardGrid.tsx': 2,
    'components/deck/DeckCardInspector.tsx': 1,
    'components/deck/DeckCardPreviewMeta.tsx': 2,
    'components/deck/DeckCardRow.tsx': 2,
    'components/deck/DeckDisplay.tsx': 1,
    'components/deck/DeckFeedbackSheet.tsx': 1,
    'components/deck/DeckMainboardRow.tsx': 4,
    'components/deck/DeckPrimerSheet.tsx': 1,
    'components/deck/DeckPublishNudge.tsx': 1,
    'components/deck/DeckSizePrompt.tsx': 1,
    'components/deck/DeckTagManager.tsx': 4,
    'components/deck/DeckTokensSheet.tsx': 1,
    'components/deck/MoveToDeckSheet.tsx': 2,
    'components/deck/NewArrivalsSheet.tsx': 1,
    'components/deck/PullListSheet.tsx': 1,
    'components/deck/SharedCopiesSheet.tsx': 1,
    'components/deck/WedgeHintStrip.tsx': 1,
    'components/deck/WinConditionPanel.tsx': 1,
    'components/DeckFiltersPopover.tsx': 1,
    'components/FilterFieldEditor.tsx': 1,
    'components/GuestActionPopover.tsx': 1,
    'components/home/HomeSectionSearch.tsx': 1,
    'components/InlineCardSearch.tsx': 1,
    'components/LikeButton.tsx': 1,
    'components/ListEntryTargetPrice.tsx': 1,
    'components/play/DeckPickerDialog.tsx': 1,
    'components/play/GameBoard.tsx': 1,
    'components/play/horde/HordeTable.tsx': 1,
    'components/play/OnlineLobby.tsx': 1,
    'components/play/TableProfiles.tsx': 1,
    'components/ProductSearchDialog.tsx': 1,
    'components/RulesReferenceSheet.tsx': 1,
    'components/ScanFab.tsx': 1,
    'components/shared/DeckExportDialog.tsx': 1,
    'components/shared/FilterChipsRow.tsx': 1,
    'components/SnapCarousel.tsx': 2,
    'components/SortEditor.tsx': 1,
    'components/SortValueOrderEditor.tsx': 1,
    'components/StatsBar.tsx': 1,
    'components/trade/PrintingChoices.tsx': 2,
    'components/trade/TradeAcceptDialog.tsx': 1,
    'components/trade/TradeComposer.tsx': 5,
    'components/trade/TradeOfferList.tsx': 1,
    'components/welcome/WelcomeHero.tsx': 1,
    'components/ZoomControl.tsx': 2,
    'deck-builder/components/brew/BrewRunningDeck.tsx': 2,
    'deck-builder/components/brew/BrewSlotPanel.tsx': 1,
    'pages/DeckEditorPage.tsx': 2,
    'pages/PlayPage.tsx': 1,
    'playtest/components/CardCounters.tsx': 1,
    'playtest/components/CountPage.tsx': 2,
    'playtest/components/CustomCountersDialog.tsx': 3,
    'playtest/components/GameMenuSheet.tsx': 1,
    'playtest/components/LogDock.tsx': 3,
    'playtest/components/MobileZonesPanel.tsx': 1,
    'playtest/components/ScrySheet.tsx': 4,
    'playtest/components/StackPanel.tsx': 4,
    'playtest/components/TriggerReminder.tsx': 1,
  },
};

const HOW: Record<Shape, string> = {
  rawClass:
    'Render Button (or IconButton with a variant) from components/shared/Button instead of the raw class.',
  iconOnly:
    'Render IconButton from components/shared/Button: it requires a label and hides the glyph.',
};

const allowedCount = (entry: number | { count: number } | undefined) =>
  typeof entry === 'number' ? entry : (entry?.count ?? 0);

describe('action controls come from the control primitives', () => {
  const found: Record<Shape, Map<string, number>> = { rawClass: new Map(), iconOnly: new Map() };
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (rel === 'components/shared/Button.tsx') continue;
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
