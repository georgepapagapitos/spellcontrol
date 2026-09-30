// @vitest-environment node
//
// Guard: config controls come from the form kit (board T139).
//
// style-guide/components.md § Config surfaces: an on/off setting is `SwitchRow`, a one-of is
// `SegmentedControl` / `ChoiceList` (native radios) or `SelectMenu`. Before
// T139 the app carried five on/off styles and three one-of styles, and every
// hand-rolled copy drifted: switches without hints, aria-pressed pairs with no
// arrow keys, native selects in the OS's styling. So this counts three
// patterns per file and fails when one appears in a new file or grows in an
// allowlisted one:
//
//   - `role="switch"` outside the kit (use SwitchRow)
//   - `aria-pressed={a === b}` (or `pressed={a === b}` on a Chip), the shape
//     of an exclusive choice on toggle buttons (use SegmentedControl / ChoiceList)
//   - a native `<select>` (use SelectMenu)
//
// Every allowlist entry says why, and each is kept by a written STYLE_GUIDE
// ruling (or is the kit itself). The debt T139 left (board E423) is cleared,
// so a new match is fixed with the kit, not added here.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const selfPath = fileURLToPath(import.meta.url);
const srcDir = resolve(dirname(selfPath), '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments legitimately name the old patterns to explain why they're gone. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const PATTERNS = {
  switch: /role=["']switch["']/g,
  // `pressed` too: a Chip filter toggle is the same exclusive-choice shape.
  pressedChoice: /(?:aria-)?pressed=\{[^}]*===/g,
  nativeSelect: /<select\b/g,
} as const;
type Pattern = keyof typeof PATTERNS;

const KIT = 'components/shared/form.tsx';
const FILTER_CHIPS = 'RULING: a filter-chip row acts on a list (§ Filter-chip row)';
const RSVP = 'RULING: an RSVP answer writes at once (§ Home, inline RSVP)';

const ALLOWED: Record<Pattern, Record<string, { count: number; why: string }>> = {
  switch: {
    [KIT]: { count: 1, why: 'the kit itself: SwitchRow' },
    'components/play/OnlineLobby.tsx': {
      count: 1,
      why: 'RULING: the lobby RuleToggle is a plain settings row, hint on title (§ Lobby)',
    },
  },
  pressedChoice: {
    'components/deck/CoachFeed.tsx': { count: 1, why: FILTER_CHIPS },
    'components/deck/DeckCombosPanel.tsx': { count: 3, why: FILTER_CHIPS },
    'components/deck/DeckDisplayBands.tsx': { count: 1, why: FILTER_CHIPS },
    'playtest/components/LogDock.tsx': { count: 1, why: FILTER_CHIPS },
    'components/import/ProductSearchPanel.tsx': { count: 1, why: FILTER_CHIPS },
    'components/home/AroundTheTable.tsx': { count: 1, why: RSVP },
    'components/play/GameNights.tsx': { count: 1, why: RSVP },
    'pages/GameNightView.tsx': { count: 1, why: RSVP },
    'components/ViewModeToggle.tsx': {
      count: 1,
      why: 'RULING: a view switcher, not a setting (§ View-mode toggle option order)',
    },
    'components/play/LifeKeypad.tsx': { count: 1, why: 'one on/off button, not a choice' },
    'components/play/OnlineLobby.tsx': { count: 1, why: 'the Ready button: one on/off' },
  },
  nativeSelect: {
    'playtest/components/CardContextMenu.tsx': {
      count: 1,
      why: 'a picker inside a context menu: the platform list works at any board size',
    },
  },
};

const HOW: Record<Pattern, string> = {
  switch: 'Use SwitchRow from components/shared/form.',
  pressedChoice: 'An exclusive choice is SegmentedControl or ChoiceList (native radios).',
  nativeSelect: 'Use SelectMenu (five or more options) or the kit one-of controls.',
};

function counts(): Record<Pattern, Map<string, number>> {
  const out = {
    switch: new Map<string, number>(),
    pressedChoice: new Map<string, number>(),
    nativeSelect: new Map<string, number>(),
  };
  for (const file of sourceFiles(srcDir)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(srcDir, file).split(sep).join('/');
    for (const key of Object.keys(PATTERNS) as Pattern[]) {
      const n = code.match(PATTERNS[key])?.length ?? 0;
      if (n > 0) out[key].set(rel, n);
    }
  }
  return out;
}

/**
 * The opening tags of every `<input>` / `<textarea>` that is a Field's first
 * child. Walks braces so an `onChange={(e) => …}` arrow doesn't end the tag.
 */
function fieldControls(code: string): string[] {
  const out: string[] = [];
  const opener = /<Field\b[^>]*>\s*<(input|textarea)\b/g;
  for (let m = opener.exec(code); m; m = opener.exec(code)) {
    const start = m.index + m[0].length - m[1].length - 1;
    let depth = 0;
    let i = start;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(code.slice(start, i + 1));
  }
  return out;
}

describe('a text control in a Field is styled', () => {
  // The kit's Field draws the label and hint, not the control. A bare
  // <input> or <textarea> in one renders as the browser's own box: the
  // game-night dialog shipped a narrow title and a monospace notes box
  // beside a styled format picker. Give it `form-input` (form.css).
  it('every input / textarea directly in a Field has a className', () => {
    const bare: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const tag of fieldControls(code)) {
        if (!/\bclassName=/.test(tag)) {
          bare.push(`${relative(srcDir, file).split(sep).join('/')}: ${tag.split('\n')[0]}`);
        }
      }
    }
    expect(bare, 'Add className="form-input":\n  ' + bare.join('\n  ')).toEqual([]);
  });

  it('finds the controls it checks', () => {
    // Keeps the scan honest: if the regex stops matching, the test above
    // passes vacuously.
    const code = readFileSync(join(srcDir, 'components/play/GameNights.tsx'), 'utf8');
    expect(fieldControls(code).length).toBeGreaterThanOrEqual(4);
  });
});

describe('config controls come from the form kit', () => {
  const found = counts();

  for (const key of Object.keys(PATTERNS) as Pattern[]) {
    it(`no new ${key} outside the allowlist`, () => {
      const over = [...found[key]]
        .filter(([file, n]) => n > (ALLOWED[key][file]?.count ?? 0))
        .map(([file, n]) => `${file} (${n}, allowed ${ALLOWED[key][file]?.count ?? 0})`);
      expect(over, `${HOW[key]}\n  ${over.join('\n  ')}`).toEqual([]);
    });

    it(`the ${key} allowlist has no stale entries`, () => {
      // A migrated file must leave the list, or the room it left would let
      // the pattern come back unnoticed.
      const stale = Object.entries(ALLOWED[key])
        .filter(([file, { count }]) => (found[key].get(file) ?? 0) < count)
        .map(
          ([file, { count }]) => `${file} (allowed ${count}, found ${found[key].get(file) ?? 0})`
        );
      expect(stale, 'Lower or delete these entries:\n  ' + stale.join('\n  ')).toEqual([]);
    });
  }
});
