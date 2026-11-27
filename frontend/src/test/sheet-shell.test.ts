// @vitest-environment node
//
// Guard: a sheet is built on <Sheet> (components/overlays/Sheet.tsx), not typed
// out by hand on the `.card-picker-*` classes.
//
// Twenty-six sheets used to assemble the shell themselves: the portal, the
// scrim root, the panel, the handle, the header, the footer and the exit
// wiring. The CSS was shared but the markup wasn't, so each one also decided
// its own header inset, title style and dismiss path. The binder "Add card"
// sheet dropped a search field into the panel with no inset, and it ran edge
// to edge with the header's divider through it. Others grew five different
// title treatments, and two skipped the exit hook, so they had no exit
// animation and no Back-button dismiss. <Sheet> owns all of that now.
//
// The allowlist below is the sheets that stay off <Sheet>, with the reason
// each one doesn't fit it. They are not a to-do list: each would need <Sheet>
// to grow a prop that only it uses, or to stop being the primitive it is.
// The list only shrinks: a file that moves onto <Sheet> must leave it (the
// second test fails until it does).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NOT_YET_ON_SHEET: Record<string, string> = {
  'components/shared/CtxMenuShell.tsx':
    'a menu first: useMenuKeyboard drives its sheet variant and needs the panel element (outside press, Tab trap, focus return) and owns Escape from a menu layer above the sheet. <Sheet> keeps its panel private and answers Escape itself',
  'components/deck/MoveToDeckSheet.tsx':
    'a Back button that leads the title on the second step, and a close labeled Cancel. No other sheet needs a leading slot',
  'playtest/components/OpeningHandSheet.tsx':
    'not dismissable at all: a full-screen takeover with no exit, a peek mode that hides the panel and puts a "Back to hand" button beside it, and a Back link above the title. <Sheet> runs useSheetExit, which closes on the browser Back button even when dismissable={false}',
  'pages/deck-editor/DeckEditorCardPickerSheet.tsx':
    'a wrapper whose callers draw the top of the panel: the deck Add cards sheet has no title at all (a zone toggle leads it), and <Sheet> always renders a titled header',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(SRC, p).split(sep).join('/');

// A file renders the shell by hand when it names the panel class itself.
const handRolled = walk(SRC)
  .filter((p) => rel(p) !== 'components/overlays/Sheet.tsx')
  .filter((p) => /["`\s]card-picker-sheet\b/.test(readFileSync(p, 'utf8')))
  .map(rel);

describe('sheets are built on <Sheet>', () => {
  it('no new sheet types the card-picker shell out by hand', () => {
    const fresh = handRolled.filter((f) => !(f in NOT_YET_ON_SHEET));
    expect(
      fresh,
      'Build these on <Sheet> from @/components/overlays/Sheet (title, description, toolbar, footer slots) instead of the raw .card-picker-* markup'
    ).toEqual([]);
  });

  it('the allowlist only lists sheets that are still hand-rolled', () => {
    const moved = Object.keys(NOT_YET_ON_SHEET).filter((f) => !handRolled.includes(f));
    expect(moved, 'These moved onto <Sheet>: delete them from NOT_YET_ON_SHEET').toEqual([]);
  });
});
