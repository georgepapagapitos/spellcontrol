/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * Blur is for a surface over moving content (STYLE_GUIDE § Color & spacing).
 *
 * `backdrop-filter: blur()` on bars, chips and panels is the glassmorphism tell
 * (ui-tells.md, "Surfaces, borders and depth"). It is right only where
 * something really moves underneath and the text on the surface must stay
 * legible: the playtest table's chrome over cards being played, the
 * scanner's panels over the live camera. The 2026-10-15 audit found 24
 * blurred rules and kept 12. The rest were dim scrims over a still life-board
 * (the app's own Modal scrim doesn't blur), chips on a flat seat color, seam
 * buttons already 95% opaque, a sticky header over a list (its sibling sticky
 * row is plain --bg) and a pill bar at 94%.
 *
 * Every rule that sets a `backdrop-filter` other than `none` must be listed
 * below, by file and selector, with the moving thing underneath. A new blur
 * fails: give the surface an opaque token instead, or make the case here.
 * An entry nothing matches fails too, so the list can't rot.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const TABLE = 'over the playtest table, where cards are played, moved and tapped under it';
const ALLOWED: Record<string, Record<string, string>> = {
  'playtest/components/OpeningHandSheet.css': {
    '.playtest-opening-root.is-takeover': `the opening hand is dealt ${TABLE}`,
  },
  'styles/playtest.css': {
    '.modal-backdrop.playtest-rotate-backdrop':
      'the rotate prompt is the takeover scrim itself, and its words sit on it with no panel',
    '.playtest-life-table, .playtest-turn-chip, .playtest-corner-btn, .playtest-corner-waiting': `corner chrome ${TABLE}`,
    '.playtest-mana-pool--column': `the mana pool dock ${TABLE}`,
  },
  'playtest/components/LogDock.css': {
    '.playtest-log-dock': `the game log floats ${TABLE}`,
  },
  'playtest/components/OpponentQuadrant.css': {
    '.opponent-quadrant__life': "an opponent's life, over that opponent's live battlefield",
    '.opponent-quadrant__name': "an opponent's name, over that opponent's live battlefield",
    '.opponent-quadrant__pile': "an opponent's piles, over that opponent's live battlefield",
  },
  'playtest/components/TableTicker.css': {
    '.table-ticker-dock__toggle': `the table-log toggle ${TABLE}`,
  },
  'styles/horde-table.css': {
    '.horde-table-status': "the Horde's name and status, over the horde's live battlefield",
  },
  'styles/admin-scanner.css': {
    '.scanner-hint': 'scanner help, over the live camera video',
    '.scanner-card-panel': 'the last-scan panel, over the live camera video',
  },
};

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

const normalize = (sel: string) =>
  sel
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();

type Hit = { file: string; sel: string };
const hits: Hit[] = [];
for (const full of cssFiles(srcRoot)) {
  const file = relative(srcRoot, full).replace(/\\/g, '/');
  const css = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const values = [...m[2].matchAll(/(?:^|;|\s)(?:-webkit-)?backdrop-filter:\s*([^;]+)/g)];
    if (values.some((v) => v[1].trim() !== 'none')) {
      hits.push({ file, sel: normalize(m[1]) });
    }
  }
}

describe('backdrop-filter only over moving content', () => {
  it('every blurred rule is on the allowlist with its reason', () => {
    const off = hits.filter((h) => !ALLOWED[h.file]?.[h.sel]);
    expect(
      off.map((h) => `${h.file}: ${h.sel}`),
      'blur only where content moves underneath; otherwise an opaque token'
    ).toEqual([]);
  });

  it('every allowlist entry still matches a rule', () => {
    const stale: string[] = [];
    for (const [file, sels] of Object.entries(ALLOWED)) {
      for (const sel of Object.keys(sels)) {
        if (!hits.some((h) => h.file === file && h.sel === sel)) stale.push(`${file}: ${sel}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
