// Guard: no source file grows past MAX_LINES, and the files already past it
// only shrink.
//
// WHY. A 4,000-line page is where navigation dies: nobody can hold it in
// their head, every feature PR on that surface collides in it, and the
// component boundaries that would make it testable never get drawn. When this
// guard landed (2026-09-29, board T176) 37 files in frontend/src were over
// 1,000 lines; CEILINGS below is that debt.
//
// HOW IT RATCHETS. A file not in CEILINGS may not exceed MAX_LINES. A file in
// CEILINGS may not exceed its ceiling, which was set at its size rounded up to
// the next 100 so in-flight work had room to land. When a split shrinks a file
// the stale check asks for the ceiling to come down with it, and a file back
// under MAX_LINES leaves the list. Never raise a ceiling or add an entry:
// split the file instead (extract a component, a hook, or a pure helper next
// to it).
//
// Data files are exempt: *.fixtures.ts (test oracles kept out of the test file
// so they can be shared) are tables, not code.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { SRC, sourceFiles } from './import-graph';

const MAX_LINES = 1000;
/** A ceiling this far above the file's real size is stale. */
const SLACK = 200;

const CEILINGS: Record<string, number> = {
  'components/binder/BinderEditor.tsx': 1800,
  'components/collection/CardListTable.tsx': 2700,
  'components/card/CardPreview.tsx': 1200,
  'components/scanner/CardScanner.tsx': 1300,
  'components/deck/CardSearchPanel.tsx': 2000,
  'components/deck/CoachFeed.tsx': 1100,
  'components/deck/CommanderSearch.tsx': 1300,
  'components/deck/DeckCustomizer.tsx': 1400,
  'components/deck/DeckDisplay.tsx': 2800,
  'components/deck/ImportDeckDialog.tsx': 1300,
  'components/play/GameBoard.tsx': 1900,
  'components/play/GameNights.tsx': 1800,
  'components/play/OnlineGameView.tsx': 1200,
  'components/play/OnlineLobby.tsx': 1300,
  'components/trade/TradeComposer.tsx': 1100,
  'components/import/UploadPanel.tsx': 1300,
  'deck-builder/services/cardFacts/parse.ts': 2000,
  'deck-builder/services/deckBuilder/bracketFit.ts': 1200,
  'deck-builder/services/deckBuilder/commanderDeckAnalysis.ts': 1200,
  'deck-builder/services/deckBuilder/deckAnalyzer.ts': 3000,
  'deck-builder/services/deckBuilder/deckGeneration/dataAcquisition.ts': 1200,
  'deck-builder/services/deckBuilder/deckGenerator.ts': 5100,
  'deck-builder/services/edhrec/client.ts': 2000,
  'deck-builder/services/scryfall/client.ts': 2200,
  'deck-builder/types/index.ts': 1200,
  'lib/cube/generate.ts': 1100,
  'lib/sync/index.ts': 2100,
  'pages/AdminPage.tsx': 1100,
  'pages/DeckEditorPage.tsx': 4600,
  'pages/DecksIndexPage.tsx': 1100,
  'pages/FriendHubPage.tsx': 1200,
  'pages/PlayPage.tsx': 2400,
  'playtest/components/PlaytestBoard.tsx': 2700,
  'playtest/store.ts': 1500,
  'store/collection.ts': 2100,
  'store/decks.ts': 1700,
  'store/play.ts': 1800,
};

const lineCount = (f: string) => readFileSync(f, 'utf8').split('\n').length;
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

describe('file size ratchet', () => {
  const sizes = new Map(
    sourceFiles()
      .filter((f) => !/\.fixtures\.ts$/.test(f))
      .map((f) => [rel(f), lineCount(f)] as const)
  );

  it('walks the real source tree', () => {
    expect(sizes.size).toBeGreaterThan(500);
  });

  it('keeps every file under its limit', () => {
    const over = [...sizes]
      .filter(([f, n]) => n > (CEILINGS[f] ?? MAX_LINES))
      .map(([f, n]) => `  ${f}: ${n} lines (limit ${CEILINGS[f] ?? MAX_LINES})`);
    expect(
      over,
      'Split the file instead of growing it: extract a component, hook or helper next to it. ' +
        'Never raise a ceiling (see the header of src/test/file-size-ratchet.test.ts).'
    ).toEqual([]);
  });

  it('lowers a ceiling when its file shrinks', () => {
    const stale = Object.entries(CEILINGS)
      .filter(([f, ceiling]) => {
        const n = sizes.get(f);
        return n === undefined || n <= MAX_LINES || ceiling - n > SLACK;
      })
      .map(([f, ceiling]) => {
        const n = sizes.get(f);
        if (n === undefined) return `  ${f}: gone, delete the entry`;
        if (n <= MAX_LINES) return `  ${f}: ${n} lines, under ${MAX_LINES}, delete the entry`;
        return `  ${f}: ${n} lines, lower the ceiling ${ceiling} -> ${Math.ceil((n + 1) / 100) * 100}`;
      });
    expect(stale, 'The ratchet only holds if ceilings follow the files down.').toEqual([]);
  });
});
