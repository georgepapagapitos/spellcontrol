/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * STYLE_GUIDE § Tabs, the TRACK ruling (revised E410): the selected segment of
 * a segmented control inside a track is a raised chip WITH an inset
 * `1px var(--border-strong)` ring and weight-600 text. The chip alone read
 * faint on the light themes, where --surface-raised is a few shades off the
 * track (Public on the new-deck Visibility control looked unselected).
 *
 * Two checks: every known track carries the ring and the weight, and a sweep
 * of all CSS finds any other selected-state rule built from the raised-chip
 * recipe (surface fill + a small `0 1px 2px` drop shadow) that lacks the ring,
 * so a new track copied from an old one fails here.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (rel: string) => strip(readFileSync(join(src, rel), 'utf8'));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

/** [selector, body] for every rule in a stylesheet (media blocks flattened). */
function rulesOf(css: string): [string, string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

function body(css: string, selector: string): string {
  return rulesOf(css)
    .filter(([sel]) => sel === selector)
    .map(([, b]) => b)
    .join(';');
}

const RING = /box-shadow:[^;]*inset 0 0 0 1px var\(--border-strong\)/;
const WEIGHT = /font-weight:\s*600/;

const TRACKS: { file: string; selected: string; weightOn?: string }[] = [
  { file: 'styles/settings-sync.css', selected: '.settings-currency-option:has(input:checked)' },
  { file: 'styles/deck-builder-display.css', selected: '.toolbar-viewmode-btn.active' },
  { file: 'playtest/components/ScrySheet.css', selected: '.playtest-scry-mode.is-active' },
  {
    file: 'components/shared/form.css',
    selected: '.segmented-option.is-selected',
    weightOn: '.segmented-option.is-selected span',
  },
];

describe('a selected segment in a track is a ringed raised chip', () => {
  for (const t of TRACKS) {
    it(`${t.selected} carries the ring and weight 600`, () => {
      const css = read(t.file);
      expect(body(css, t.selected), `${t.selected} not found in ${t.file}`).not.toBe('');
      expect(body(css, t.selected)).toMatch(RING);
      expect(body(css, t.weightOn ?? t.selected)).toMatch(WEIGHT);
    });
  }

  it('no other selected-state raised chip is missing the ring', () => {
    const selectedState = /\.is-active|\.active\b|:checked|\.is-selected/;
    const raisedChip = (b: string) =>
      /background:\s*var\(--surface(-raised)?\)\s*;/.test(b) && /box-shadow:[^;]*0 1px 2px/.test(b);
    const missing = cssFiles(src).flatMap((file) =>
      rulesOf(strip(readFileSync(file, 'utf8')))
        .filter(([sel, b]) => selectedState.test(sel) && raisedChip(b) && !RING.test(b))
        .map(([sel]) => `${relative(src, file)}: ${sel}`)
    );
    expect(missing).toEqual([]);
  });
});
