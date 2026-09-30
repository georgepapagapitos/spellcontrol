// @vitest-environment node
//
// Guard: an overlay root portals to <body>.
//
// A sheet, drawer or dialog root is `position: fixed` with a z-index, and both
// of those are only as good as the place it renders. Rendered inline, it
// inherits every ancestor's stacking context: `.collection-grid-cell` sets
// `position: relative; z-index: 0`, so "View card tags" from a grid card's
// menu opened a sheet whose z-index counted only inside that one cell, and
// every card painted after it covered it. A transformed ancestor (the
// virtualized grid's rows) also becomes the containing block for `fixed`, so
// the sheet anchored to the row instead of the viewport.
//
// Modal always portaled; twenty-odd sheets on the `.card-picker-*` shell (and
// the stats drawer, rules reference, binder page viewer, deck context menu
// and hover peek) did not, and were fine only while their call site happened
// to have no stacking ancestor. So: a component that renders one of these
// roots calls `createPortal(…, document.body)`, as Modal does.
//
// Exempt: the play table and the playtest board. Their overlays mount at the
// top of a full-viewport fixed surface on purpose, and the board sheets must
// stay inside `.game-board-rotator` so they face the seat that opened them.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

const OVERLAY_ROOTS = [
  'card-picker-root',
  'modal-backdrop',
  'stats-drawer-root',
  'binder-pages-backdrop',
  'ctx-menu__backdrop',
  'deck-card-hover-peek',
];

const EXEMPT_DIRS = ['components/play/', 'playtest/'];

// The deck editor's card-picker sheet has always rendered inline. This guard
// only passed while the page shared a file with the overflow menu's
// createPortal; the split (T176) made the gap visible. Moving it to <body>
// changes where the sheet paints, so it is a behaviour change owned by its own
// ticket, not by the file split. Delete this entry when it is portaled.
const EXEMPT_FILES = ['pages/deck-editor/DeckEditorCardPickerSheet.tsx'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('overlay roots portal to <body>', () => {
  it('every component rendering an overlay root calls createPortal', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const rel = relative(srcDir, file).replace(/\\/g, '/');
      if (EXEMPT_DIRS.some((d) => rel.startsWith(d)) || EXEMPT_FILES.includes(rel)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      const root = OVERLAY_ROOTS.find((c) =>
        new RegExp(`className=\\{?[\`'"]${c}[\\s\`'"$]`).test(code)
      );
      if (root && !code.includes('createPortal(')) offenders.push(`${rel} (.${root})`);
    }
    expect(
      offenders,
      'Wrap the overlay root in createPortal(…, document.body), as Modal does. Inline, it is trapped in the nearest ancestor stacking context and painted under neighbouring content.'
    ).toEqual([]);
  });
});
