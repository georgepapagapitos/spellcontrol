// @vitest-environment node
//
// Guard (board T162, STYLE_GUIDE § Verbs — Menus): a right-click on an item
// opens the SAME menu its ⋮ opens, at the pointer. The way to get that is
// `OverflowMenu`'s `contextHost` (or `ToolbarPopover`'s `itemHost` for the
// deck row): the menu is the ⋮'s own, so the two cannot offer different
// things, the item is marked while the menu is open, a Shift+right-click,
// a field, selected text or someone else's link keeps the browser's menu,
// and the Context Menu key / Shift+F10 open it too.
//
// A hand-rolled `onContextMenu` gets none of that for free. Before this
// program there were three right-click menus in the app and each had its own
// idea of which targets to leave to the browser, where a keyboard open should
// anchor and whether the right-clicked item stayed visible (the deck's stacks
// lost it behind the menu's backdrop). New surfaces go through `contextHost`;
// the files below own a right-click that is genuinely theirs.
//
// The fix this test expects: pass `contextHost=".your-item"` to the item's
// OverflowMenu instead of adding `onContextMenu` to the item.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(srcDir, file).split(sep).join('/');

/** Directories whose right-click is a table's, not an item menu's. */
const ALLOWED_DIRS: Record<string, string> = {
  'playtest/':
    'the goldfish table: card, pile, felt and counter menus on a board that suppresses the browser menu',
  'components/play/': 'the live table (GameBoard, Horde): the same table menus, online',
};

/** Files that own a right-click the shared path cannot express, with why. */
const ALLOWED_FILES: Record<string, string> = {
  'components/shared/CtxMenuShell.tsx':
    'the pointer-anchored shell itself: its backdrop hands a right-click on to what lies under it',
  'components/deck/DeckMainboardRow.tsx':
    'the deck list row reports right-clicks to DeckDisplay, which renders ONE CtxMenuShell card menu built from the same cardMenuCtx as the row ⋮',
  'components/deck/DeckCardGrid.tsx':
    'the deck grid/stacks tile: the same single DeckDisplay card menu as the row, with its own ⋮',
};

describe('a right-click on an item opens the item’s ⋮ menu', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    const path = rel(file);
    if (Object.keys(ALLOWED_DIRS).some((dir) => path.startsWith(dir))) continue;
    if (path in ALLOWED_FILES) continue;
    if (/\bonContextMenu=/.test(readFileSync(file, 'utf8'))) offenders.push(path);
  }

  it('goes through OverflowMenu’s contextHost, not a hand-rolled onContextMenu', () => {
    expect(
      offenders,
      'Pass contextHost=".your-item" to the item’s OverflowMenu instead of adding onContextMenu'
    ).toEqual([]);
  });

  it('keeps its allowlist honest: every listed file still has a right-click', () => {
    for (const path of Object.keys(ALLOWED_FILES)) {
      const code = readFileSync(join(srcDir, path), 'utf8');
      expect(/\bonContextMenu=/.test(code), `${path} no longer needs its exemption`).toBe(true);
    }
  });
});
