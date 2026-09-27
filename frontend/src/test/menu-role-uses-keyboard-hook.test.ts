// @vitest-environment node
//
// Guard: every `role="menu"` container runs on the shared `useMenuKeyboard`
// hook — directly, or through a primitive that calls it — so arrow keys,
// Home/End, Escape and focus return work the same way everywhere a menu
// opens (board T157). Before this, `CtxMenuShell` (the pointer-anchored
// card/table context menus) had no arrow-key handling at all, and
// `TableContextMenu` had re-implemented its own copy on top of it. A menu
// that skips the hook is either mute on the keyboard or a second,
// independent implementation that will drift from the first.
//
// The primitive list is DERIVED, not hand-kept: any component whose own file
// imports useMenuKeyboard counts as one, so a new primitive (or one of these
// losing the hook) changes what this test accepts without an edit here.

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
const basename = (file: string) => file.slice(file.lastIndexOf(sep) + 1).replace(/\.tsx$/, '');

const MENU_ROLE = /role=["']menu["']/;
const HOOK_IMPORT = /\buseMenuKeyboard\b/;
const HOOK_MODULE = /use-menu-keyboard['"]/;

/**
 * Files that legitimately render `role="menu"` without owning the hook
 * themselves or importing a primitive that does, each with the reason it is
 * exempt rather than fixed.
 */
const ALLOWLIST: Record<string, string> = {
  // GridCaptionList is body markup only — never mounted on its own. Every
  // caller wraps it in its own ToolbarPopover (CardListTable, ListDetailView,
  // ViewPopoverPanel), so the hook lives in THEIR file, not this one.
  'components/shared/CardGridCell.tsx':
    'body-only content wrapped in a ToolbarPopover by every caller, never by this file',
  // Owned by a different T157 lane (menu keyboard parity is this lane's;
  // BinderTabs' own dropdown is another's). Drop this entry once that lane
  // converts it to useMenuKeyboard directly.
  'components/BinderTabs.tsx': 'a parallel T157 lane is converting this file; remove once it lands',
};

describe('every role="menu" container runs on the shared keyboard hook', () => {
  const files = sourceFiles(srcDir);
  const codeByFile = new Map(files.map((f) => [f, readFileSync(f, 'utf8')] as const));

  const importsHook = (code: string) => HOOK_IMPORT.test(code) && HOOK_MODULE.test(code);

  // Derived, not hard-coded: any component whose OWN file imports the hook.
  const primitives = new Set(
    files.filter((f) => importsHook(codeByFile.get(f)!)).map((f) => basename(f))
  );

  it('sees the known primitives (guards the guard against a parser regression)', () => {
    for (const name of ['OverflowMenu', 'SelectMenu', 'ToolbarPopover', 'GuestActionPopover']) {
      expect(primitives.has(name), `${name} should import useMenuKeyboard`).toBe(true);
    }
  });

  const offenders: string[] = [];
  for (const file of files) {
    const path = rel(file);
    if (path in ALLOWLIST) continue;
    const code = codeByFile.get(file)!;
    if (!MENU_ROLE.test(code)) continue;
    if (importsHook(code)) continue;
    const ownName = basename(file);
    const throughPrimitive = [...primitives].some(
      (name) => name !== ownName && new RegExp(`\\b${name}\\b`).test(code)
    );
    if (!throughPrimitive) offenders.push(path);
  }

  it('no role="menu" file is missing the hook, a primitive, or an allowlist entry', () => {
    expect(
      offenders,
      'These render role="menu" without useMenuKeyboard and without importing a ' +
        'primitive that owns it (OverflowMenu, SelectMenu, ToolbarPopover, ' +
        'GuestActionPopover, CtxMenuShell, …). Wire it to useMenuKeyboard, route ' +
        'it through one of those, or add a commented allowlist entry above:\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((path) => {
      const full = join(srcDir, ...path.split('/'));
      const code = codeByFile.get(full);
      return code === undefined || !MENU_ROLE.test(code);
    });
    expect(
      stale,
      'These no longer render role="menu" (or no longer exist) — remove the entry:\n  ' +
        stale.join('\n  ')
    ).toEqual([]);
  });

  it('the scan sees the codebase (guards the guard)', () => {
    // A parser/path change that silently matched nothing would pass every
    // case above.
    expect(files.length).toBeGreaterThan(50);
    expect(primitives.size).toBeGreaterThan(0);
  });
});
