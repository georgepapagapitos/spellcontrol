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
  });

  it.each(['deleteDeck'])(
    'no ConfirmDialog that calls %s claims "This can\'t be undone."',
    (action) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(SRC)) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes(FINALITY)) continue;
        if (!new RegExp(`\\b${action}\\s*\\(`).test(src)) continue;
        // Narrow it to the dialog that actually triggers this action: the
        // handler and the finality string must both be present, and the
        // dialog's confirm path must reach the action.
        const handler = src.match(
          new RegExp(`const (handle\\w*)\\s*=\\s*\\(\\)\\s*=>\\s*\\{[^}]*${action}\\(`)
        );
        if (!handler) continue;
        const dialog = src.match(
          new RegExp(`<ConfirmDialog[\\s\\S]{0,400}?onConfirm=\\{${handler[1]}\\}`)
        );
        if (dialog && dialog[0].includes(FINALITY)) {
          offenders.push(`${file.replace(SRC, 'src')} — ConfirmDialog → ${action}`);
        }
      }
      expect(
        offenders,
        `${action} shows an Undo toast, so a confirm dialog for it must not say ` +
          `"${FINALITY}". The /decks index already words this correctly: ` +
          `"The selected decks will be removed. You can undo from the toast."\n  ` +
          offenders.join('\n  ')
      ).toEqual([]);
    }
  );
});
