/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Uppercase role guard (E595, tightened 2026-10-16). A "does this read as
// AI-designed" review named "big words above headlines", "overuse of eyebrow
// type in all caps" and "eyebrow text with pill borders" as tells, and so does
// the shared directive (trove plugins/polish/reference/ui-tells.md, "Small
// all-caps letter-spaced label above every heading"). Our CSS had 174 rules
// that set `text-transform: uppercase`, 150 of them on section labels and
// chips that were never meant to shout.
//
// The first version of this guard passed any caps rule that also set
// `font-family: var(--font-label)`, so an eyebrow could wear the label face and
// pass: the 2026-10-15 audit found 15 (COLOR / PLAYSTYLE in Brew, the upgrade
// plan's eyebrow, Home's "Waiting on you" and stat captions, menu group titles,
// sort-sheet heads). Caps are a ROLE, not a font. So the rule now is: every
// rule that sets `text-transform: uppercase` is listed below with its role and
// the reason, and the label roles must also wear `--font-label`:
//
//   chrome      the app's own navigation: the nav links, the tab bar, hub tabs
//   table-head  a real table's or grid's column heads (the print voice)
//   stamp       a stamp, tag or ribbon on a thing: a turn chip, a status pill,
//               TOKEN, PROXY, "New" on a menu row
//   tape        the Dymo-tape label (STYLE_GUIDE § Shape language, tape labels)
//   data        an identifier whose canonical form is capitals (a set code, a
//               hex value, a room code): data, not a label
//   wordmark    the welcome hero's micro wordmark (STYLE_GUIDE § Display wordmark)
//
// A line above a group of fields or rows is a section label, never caps: sentence
// case in the body face, weight 600 (STYLE_GUIDE § Typography). Don't add an
// entry for one; fix the rule. A new entry names a role above and says why.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

type Role = 'chrome' | 'table-head' | 'stamp' | 'tape' | 'data' | 'wordmark';
const LABEL_FACE_ROLES: Role[] = ['chrome', 'table-head', 'stamp', 'tape'];

// file (relative to src, forward slashes) -> selector -> [role, why caps is right]
const ROLES: Record<string, Record<string, [Role, string]>> = {
  'styles/responsive-nav.css': {
    '.site-nav-link': ['chrome', 'the header nav and the hub tab strips'],
    '.mobile-tab-bar-link': ['chrome', 'the phone tab bar'],
  },
  'styles/admin-scanner.css': {
    '.admin-users-table th': ['table-head', 'the admin users table'],
  },
  'styles/collection.css': {
    '.collection-table-th': ['table-head', 'the collection table'],
    '.set-filter-chip-label': ['data', 'a set code'],
    '.collection-grid-set, .copy-places-set': ['data', 'a set code, as a chip or on the one plate'],
  },
  'styles/shared.css': {
    '.shared-list-table th': ['table-head', 'a shared list table'],
  },
  'styles/social-shared.css': {
    '.play-records-table th': ['table-head', 'the play records table'],
  },
  'pages/DailyPage.css': {
    '.daily-grid-head': ['table-head', "the guess grid's column heads"],
  },
  'components/home/HomeHero.css': {
    '.home-hero-caption-tape': ['tape', "the day's card's name on its tape label"],
  },
  'components/play/OnlineGameView.css': {
    '.ogv-you-label': ['stamp', 'the "You" tag on your own seat'],
  },
  'pages/ProxySheetPage.css': {
    '.proxy-watermark': ['stamp', 'the PROXY stamp printed across a proxy'],
  },
  'playtest/components/CardHoverPreview.css': {
    '.playtest-hover-preview__token': ['stamp', 'the TOKEN tag on a token'],
  },
  'playtest/components/StackPanel.css': {
    '.stack-panel__token': ['stamp', 'the TOKEN tag on a stack item'],
  },
  'playtest/components/GameMenuSheet.css': {
    '.playtest-game-menu__item-note': ['stamp', 'a "New" tag on a menu row'],
  },
  'playtest/components/OpponentQuadrant.css': {
    '.opponent-quadrant__turn-chip': ['stamp', 'the turn chip on the active seat'],
  },
  'playtest/components/OpponentRail.css': {
    '.opponent-entry__turn-chip': ['stamp', 'the turn chip on the active seat'],
    '.opponent-entry__status': ['stamp', "a seat's status pill"],
  },
  'styles/play-board.css': {
    '.player-panel-offline': ['stamp', 'the OFFLINE stamp on a seat'],
    '.player-panel-winner-tag, .player-panel-eliminated-tag': [
      'stamp',
      'the winner and eliminated tags on a seat',
    ],
  },
  'styles/playtest.css': {
    '.playtest-card__stack-ribbon': ['stamp', 'the corner ribbon on a stacked card'],
    '.playtest-card__token-ribbon': ['stamp', 'the corner ribbon on a token'],
    '.playtest-hand__revealed': ['stamp', 'the REVEALED tag on a card the table can see'],
  },
  'components/welcome/WelcomeHero.css': {
    '.welcome-hero-wordmark': [
      'wordmark',
      'STYLE_GUIDE § Display wordmark exempts this micro render: an oldstyle display face dies in tiny tracked caps',
    ],
  },
  'components/import/ProductSearchPanel.css': {
    '.product-result-seticon-empty': ['data', 'set code fallback glyph'],
  },
  'pages/SetsPage.css': { '.sets-row-code': ['data', 'a set code'] },
  'styles/binder-rules-editor.css': { '.color-picker-hex-input': ['data', 'a hex value'] },
  'styles/play-setup.css': {
    '.play-join-code': ['data', 'a room code, typed and read aloud as capitals'],
  },
};

type Hit = { file: string; line: number; sel: string };

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Every leaf declaration block (not an @media/@supports wrapper) with its selector. */
function leafBlocks(css: string): { sel: string; body: string; line: number }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: { sel: string; body: string; line: number }[] = [];
  const stack: { sel: string; open: number }[] = [];
  let selStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ sel: text.slice(selStart, i).trim(), open: i });
      selStart = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) {
        const body = text.slice(top.open + 1, i);
        if (!top.sel.startsWith('@') && !body.includes('{')) {
          out.push({
            sel: top.sel.replace(/\s+/g, ' '),
            body,
            line: text.slice(0, top.open).split('\n').length,
          });
        }
      }
      selStart = i + 1;
    } else if (ch === ';' && stack.length === 0) {
      selStart = i + 1;
    }
  }
  return out;
}

function measure() {
  const unlisted: Hit[] = [];
  const offFace: Hit[] = [];
  const used = new Set<string>();
  for (const file of cssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    for (const block of leafBlocks(readFileSync(file, 'utf8'))) {
      if (!/text-transform\s*:\s*uppercase/.test(block.body)) continue;
      const entry = ROLES[key]?.[block.sel];
      if (!entry) {
        unlisted.push({ file: key, line: block.line, sel: block.sel });
        continue;
      }
      used.add(`${key}|${block.sel}`);
      if (
        LABEL_FACE_ROLES.includes(entry[0]) &&
        !/font-family\s*:[^;]*--font-label/.test(block.body)
      ) {
        offFace.push({ file: key, line: block.line, sel: block.sel });
      }
    }
  }
  return { unlisted, offFace, used };
}

describe('uppercase role (E595)', () => {
  const { unlisted, offFace, used } = measure();

  it('every caps rule is a listed role, so a caps eyebrow fails even in --font-label', () => {
    expect(
      unlisted.map((o) => `${o.file}:${o.line}  ${o.sel}`),
      'Caps are a role (chrome, a table head, a stamp or tag, tape, a data code), not a font. A label above a group of fields or rows is sentence case in the body face at weight 600: drop text-transform, letter-spacing and the label face. Only a real role goes in ROLES, with its reason.'
    ).toEqual([]);
  });

  it('the label roles wear --font-label', () => {
    expect(
      offFace.map((o) => `${o.file}:${o.line}  ${o.sel}`),
      'A chrome, table-head, stamp or tape rule sets font-family: var(--font-label).'
    ).toEqual([]);
  });

  it('every ROLES entry still matches a caps rule', () => {
    const stale = Object.entries(ROLES).flatMap(([file, sels]) =>
      Object.keys(sels)
        .filter((sel) => !used.has(`${file}|${sel}`))
        .map((sel) => `${file}  ${sel}`)
    );
    expect(stale, 'Remove these from ROLES; the rule is gone or no longer uppercase.').toEqual([]);
  });
});
