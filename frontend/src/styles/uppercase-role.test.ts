/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// Uppercase role guard (E595). A "does this read as AI-designed" review named
// "big words above headlines", "overuse of eyebrow type in all caps" and
// "eyebrow text with pill borders" as tells, and our CSS had 174 rules that set
// `text-transform: uppercase`, 150 of them on section labels and chips that
// were never meant to shout. Uppercase now belongs to one role: --font-label
// (chrome, tabs, tape labels, print-table th, stamps and tags). A section label
// above its rows is sentence case in the body face (STYLE_GUIDE § Typography).
//
// The rule this enforces: a block that sets `text-transform: uppercase` must
// also set `font-family: var(--font-label)`. A rule that is caps for a reason
// the label role does not cover goes in ALLOWED below, with the reason. Prefer
// the label role (a stamp, a tag, a ribbon) or sentence case over an entry.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// file (relative to src, forward slashes) -> selector -> why caps is right.
const ALLOWED: Record<string, Record<string, string>> = {
  'components/welcome/WelcomeHero.css': {
    '.welcome-hero-wordmark':
      'STYLE_GUIDE § Display wordmark exempts this micro render: an oldstyle display face dies in tiny tracked caps',
  },
  // Identifiers whose canonical form is uppercase but whose data arrives
  // lowercase (Scryfall set codes) or free-form (hex, a join code typed by hand).
  // They are data, not labels.
  'components/import/ProductSearchPanel.css': {
    '.product-result-seticon-empty': 'set code fallback glyph',
  },
  'pages/SetsPage.css': { '.sets-row-code': 'set code (data)' },
  'styles/binder-rules-editor.css': { '.color-picker-hex-input': 'hex value (data)' },
  'styles/collection.css': {
    '.set-filter-chip-label': 'set code (data)',
    '.collection-grid-set': 'set code (data)',
  },
  'styles/play-setup.css': { '.play-join-code': 'room code, typed and read aloud as capitals' },
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
  const offenders: Hit[] = [];
  const used = new Set<string>();
  for (const file of cssFiles(srcRoot)) {
    const key = relative(srcRoot, file).split('\\').join('/');
    for (const block of leafBlocks(readFileSync(file, 'utf8'))) {
      if (!/text-transform\s*:\s*uppercase/.test(block.body)) continue;
      if (/font-family\s*:[^;]*--font-label/.test(block.body)) continue;
      if (ALLOWED[key]?.[block.sel]) {
        used.add(`${key}|${block.sel}`);
        continue;
      }
      offenders.push({ file: key, line: block.line, sel: block.sel });
    }
  }
  return { offenders, used };
}

describe('uppercase role (E595)', () => {
  const { offenders, used } = measure();

  it('only the --font-label role sets text-transform: uppercase', () => {
    expect(
      offenders.map((o) => `${o.file}:${o.line}  ${o.sel}`),
      'Uppercase belongs to --font-label. A section label is sentence case in the body face: drop text-transform and letter-spacing. A stamp, tag or chip takes font-family: var(--font-label). A data code (set code, hex) goes in ALLOWED with its reason.'
    ).toEqual([]);
  });

  it('every ALLOWED entry still matches a rule', () => {
    const stale = Object.entries(ALLOWED).flatMap(([file, sels]) =>
      Object.keys(sels)
        .filter((sel) => !used.has(`${file}|${sel}`))
        .map((sel) => `${file}  ${sel}`)
    );
    expect(stale, 'Remove these from ALLOWED; the rule is gone or no longer uppercase.').toEqual(
      []
    );
  });
});
