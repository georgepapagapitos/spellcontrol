/**
 * Every input a deck can be named from carries the cap (board E342).
 *
 * The editor's rename field had no `maxLength` at all and the import dialog's
 * per-file name had its own 120, so "how long may a deck name be" had three
 * different answers depending on where you typed it — and a 400-character name
 * titled the browser tab, filled the `og:title`, set the hero `h1` and
 * stretched the /u/ profile tile.
 *
 * The server clamps display metadata regardless (`clampDeckName`, guarded in
 * `backend/src/shares/projections.test.ts`), so this is the UX half: a person
 * should not be able to type a name the page will then quietly cut. A scan
 * rather than a render test because the point is that NO future input escapes
 * it — a third naming field added uncapped fails here.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Marks an `<input>` as a place a deck gets named. */
const DECK_NAME_INPUT =
  /aria-label=\{?["`]?Deck name|deck-editor-name-input|import-deck-draft-name/;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/** Each `<input …>` element's own source text. */
function inputElements(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/<input\b/g)) {
    const end = source.indexOf('/>', m.index);
    if (end === -1) continue;
    out.push(source.slice(m.index, end + 2));
  }
  return out;
}

describe('deck-name inputs are capped', () => {
  it('finds the inputs at all', () => {
    // Guard the guard: a rename that broke the marker would otherwise make
    // every assertion below vacuous.
    const found = tsxFiles(srcDir).flatMap((f) =>
      inputElements(readFileSync(f, 'utf8')).filter((el) => DECK_NAME_INPUT.test(el))
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('every deck-name input uses DECK_NAME_MAX, not its own number', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(srcDir)) {
      const source = readFileSync(file, 'utf8');
      for (const el of inputElements(source)) {
        if (!DECK_NAME_INPUT.test(el)) continue;
        if (!/maxLength=\{DECK_NAME_MAX\}/.test(el)) {
          offenders.push(`${relative(srcDir, file)}: ${el.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      'A deck name typed longer than DECK_NAME_MAX is a name the page then cuts ' +
        'on its own (E342). Import `DECK_NAME_MAX` from `@/lib/deck-name`.'
    ).toEqual([]);
  });
});
