/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A confirm dialog may not claim finality for an action that offers Undo.
 *
 * Playtest batch 5 drove the deck delete end to end and watched the app
 * contradict itself inside one second:
 *
 *   ConfirmDialog:  'Delete "Krenko"? This can't be undone.'
 *   → confirm →
 *   toast:          'Deleted Krenko  [Undo]'      ...and the Undo works.
 *
 * `store/decks.ts:deleteDeck` ALWAYS shows that toast, whose `onAction`
 * re-inserts the captured deck. The /decks index bulk delete — same store, same
 * toast — already worded it correctly ("You can undo from the toast."), so the
 * codebase disagreed with itself in two files.
 *
 * `copy-guards.test.ts` pins the finality clause's exact WORDING and therefore
 * could never catch this: the string was perfectly formed and simply untrue.
 * This guard asks the different question — is the action actually final?
 *
 * The rule is narrow on purpose: a store action that shows an undo toast is
 * reversible, so any confirm dialog that triggers it must not carry the
 * finality clause. Deletes with no undo (clearing a collection, revoking a
 * share link) keep it, and should.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..');
const FINALITY = "This can't be undone.";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|__fixtures__|__snapshots__/.test(e.name)) continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Store actions whose implementation shows an undo toast — i.e. reversible. */
function undoableActions(): string[] {
  const names: string[] = [];
  for (const file of sourceFiles(join(SRC, 'store'))) {
    const css = readFileSync(file, 'utf8');
    // `name: (args) => { ... toast.show({ ... actionLabel: 'Undo' ... }) }`
    for (const m of css.matchAll(/^\s{4,6}(\w+):\s*\(/gm)) {
      const start = m.index ?? 0;
      // the body runs to the next sibling action at the same indent
      const rest = css.slice(start + m[0].length);
      const nextIdx = rest.search(/\n\s{4,6}\w+:\s*\(/);
      const body = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
      if (/actionLabel:\s*'Undo'/.test(body)) names.push(m[1]);
    }
  }
  return [...new Set(names)];
}

describe('finality copy matches reality', () => {
  const undoable = undoableActions();

  it('finds the undoable store actions at all', () => {
    // Guard the guard: an empty list would pass everything below vacuously.
    expect(undoable.length).toBeGreaterThan(0);
    expect(undoable).toContain('deleteDeck');
    expect(undoable).toContain('deleteBinder');
    expect(undoable).toContain('deleteList');
    expect(undoable).toContain('removeSaved');
  });

  // Every finality clause in the source, traced to what its confirm reaches:
  // a <ConfirmDialog>'s onConfirm (a named handler resolved to its body), or,
  // for the useConfirm() promise form, the code right after the clause. The
  // first version of this guard only followed handlers named `handle…`, so
  // /decks kept "This can't be undone." on a single delete and on delete-all,
  // both of which show Undo.
  it('no confirm that reaches an undoable action claims finality', () => {
    const calls = new RegExp(`\\b(${undoable.join('|')})\\s*\\(`);
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      // Comments blanked in place (line numbers survive): a note explaining
      // why the clause was dropped is not a dialog.
      const blank = (m: string) => m.replace(/[^\n]/g, ' ');
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^\s*\/\/.*$/gm, blank);
      for (let at = src.indexOf(FINALITY); at !== -1; at = src.indexOf(FINALITY, at + 1)) {
        const hit = reachedFrom(src, at).match(calls);
        if (!hit) continue;
        const line = src.slice(0, at).split('\n').length;
        offenders.push(`${file.replace(SRC, 'src')}:${line} → ${hit[1]}`);
      }
    }
    expect(
      offenders,
      `These actions show an Undo toast, so their confirm must not say "${FINALITY}". ` +
        `Say "You can undo from the toast." as the /decks bulk delete does.\n  ` +
        offenders.join('\n  ')
    ).toEqual([]);
  });
});

/**
 * T157 — a SINGLE-item undoable action doesn't confirm first at all (not just
 * "doesn't claim finality"): Gmail/Linear precedent, decided on the board.
 * Bulk and delete-all variants (deleteDecks, deleteAllDecks, deleteBinders,
 * deleteAllBinders, deleteLists, deleteAllLists) are OUT of scope and keep
 * their confirm — the toast there only shows a count, so the blast radius
 * still warrants asking first. The regex below requires the call parenthesis
 * immediately after the bare name, so it can't match a plural/All sibling.
 */
const SINGLE_ITEM_UNDOABLE = ['deleteDeck', 'deleteBinder', 'deleteList', 'removeSaved'];

describe('a single-item undoable action never confirms first', () => {
  it('no <ConfirmDialog> onConfirm, and no useConfirm() confirm() gate, reaches deleteDeck/deleteBinder/deleteList/removeSaved', () => {
    const calls = new RegExp(`\\b(${SINGLE_ITEM_UNDOABLE.join('|')})\\s*\\(`);
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      // Comments blanked in place (line numbers survive), same as the guard above.
      const blank = (m: string) => m.replace(/[^\n]/g, ' ');
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^\s*\/\/.*$/gm, blank);

      // Every <ConfirmDialog>'s onConfirm target, named handler or inline.
      for (const m of src.matchAll(/<ConfirmDialog\b/g)) {
        const open = m.index ?? 0;
        const close = src.indexOf('/>', open);
        if (close === -1) continue;
        const element = src.slice(open, close + 2);
        const named = element.match(/onConfirm=\{\s*(\w+)\s*\}/);
        const body = named
          ? (() => {
              const def = src.search(new RegExp(`(const|function)\\s+${named[1]}\\b`));
              return def === -1 ? '' : bracedBody(src, def);
            })()
          : element;
        const hit = body.match(calls);
        if (hit) {
          const line = src.slice(0, open).split('\n').length;
          offenders.push(`${file.replace(SRC, 'src')}:${line} → ${hit[1]} (via <ConfirmDialog>)`);
        }
      }

      // The useConfirm() promise form: `const ok = await confirm({…}); if (ok) action(...)`.
      for (const m of src.matchAll(/\bawait\s+confirm\s*\(/g)) {
        const at = m.index ?? 0;
        const rest = src.slice(at, at + 800);
        const hit = rest.match(calls);
        if (hit) {
          const line = src.slice(0, at).split('\n').length;
          offenders.push(`${file.replace(SRC, 'src')}:${line} → ${hit[1]} (via useConfirm())`);
        }
      }
    }

    expect(
      offenders,
      'A single-item delete is undoable from the toast, so it must not confirm first ' +
        '(T157 — Gmail/Linear precedent). Call the store action directly.\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });
});

/** The code a finality clause's confirm leads to. */
function reachedFrom(src: string, at: number): string {
  const open = src.lastIndexOf('<ConfirmDialog', at);
  const close = open === -1 ? -1 : src.indexOf('/>', open);
  if (open !== -1 && close > at) {
    const element = src.slice(open, close + 2);
    const named = element.match(/onConfirm=\{\s*(\w+)\s*\}/);
    if (!named) return element;
    const def = src.search(new RegExp(`(const|function)\\s+${named[1]}\\b`));
    return def === -1 ? '' : bracedBody(src, def);
  }
  return src.slice(at, at + 800);
}

/** From `from`, the first {…} block with its braces balanced. */
function bracedBody(src: string, from: number): string {
  const open = src.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}
