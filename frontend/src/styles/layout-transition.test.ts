/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// Layout-transition guard (STYLE_GUIDE § Motion: transform and opacity only).
//
// Animating width, height, margin, padding or an inset re-lays out the page on
// every frame, and it is a named tell of generated UI (trove
// plugins/polish/reference/ui-tells.md, "Animating width, height or margin";
// `impeccable detect` rule `layout-transition`). Six had crept in: the shared
// MeterBar fill, the commander-damage washes, the playtest pile, the scanner's
// zoomed card and a dead mana-production bar. A bar now clips to its value
// (clip-path) or scales (transform); a box that changes size takes its new
// size at once and its content moves into it by transform.
//
// What this fails, in every stylesheet: a `transition` / `transition-property`
// that names a layout property (or `all`, which includes them), and an
// `@keyframes` that animates one.
//
// ALLOWED needs its own guard that says why the box itself has to move.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const LAYOUT =
  /^(width|height|min-width|min-height|max-width|max-height|margin(-[a-z-]+)?|padding(-[a-z-]+)?|top|left|right|bottom|inset(-[a-z-]+)?|flex-basis|grid-template-(rows|columns)|font-size|line-height|border-width|gap|row-gap|column-gap|all)$/;

/** file (relative to src) -> selector -> property -> why the box moves. */
const ALLOWED: Record<string, Record<string, Record<string, string>>> = {
  'styles/deck-builder-card-list.css': {
    '.deck-card-stack': {
      'padding-bottom':
        'the cards move by transform; only the room their open tail needs grows, on the same duration and easing (styles/stack-hover-reachable.test.ts)',
    },
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

const sheets = cssFiles(srcRoot).map((f) => ({
  file: relative(srcRoot, f).split(sep).join('/'),
  css: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

describe('no layout property is animated (STYLE_GUIDE § Motion)', () => {
  it('no transition names a layout property', () => {
    const hits: string[] = [];
    for (const { file, css } of sheets) {
      const outsideKeyframes = css.replace(
        /@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
        ''
      );
      for (const m of outsideKeyframes.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = m[1].trim().split(/\s*,\s*/);
        for (const raw of m[2].split(';')) {
          const t = raw.trim().match(/^transition(?:-property)?\s*:\s*(.+)$/i);
          if (!t) continue;
          const props = t[1].split(/,(?![^(]*\))/).map((p) => p.trim().split(/\s+/)[0]);
          for (const prop of props.filter((p) => LAYOUT.test(p))) {
            const ok = selectors.every((s) => ALLOWED[file]?.[s]?.[prop]);
            if (!ok) hits.push(`${file}: ${selectors.join(', ')} → transition ${prop}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('no @keyframes animates a layout property', () => {
    const hits: string[] = [];
    for (const { file, css } of sheets) {
      for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)) {
        const props = [...m[2].matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
        for (const prop of new Set(props.filter((p) => LAYOUT.test(p)))) {
          hits.push(`${file}: @keyframes ${m[1]} animates ${prop}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('every ALLOWED entry still exists, so the list only shrinks', () => {
    for (const [file, sels] of Object.entries(ALLOWED)) {
      const css = sheets.find((s) => s.file === file)?.css ?? '';
      for (const [sel, props] of Object.entries(sels)) {
        for (const prop of Object.keys(props)) {
          expect(
            new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{[^}]*transition:\\s*${prop}`).test(css),
            `${file} ${sel} ${prop}`
          ).toBe(true);
        }
      }
    }
  });
});
