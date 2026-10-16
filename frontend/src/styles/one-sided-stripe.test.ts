/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// One-sided stripe guard (STYLE_GUIDE § Layout system, "No stripe down a
// side", 2026-10-16).
//
// A colored border or inset bar down one side of a card, row, banner or title
// is the most recognized tell of generated UI (the outside "does this read as
// AI-designed" review; trove plugins/polish/reference/ui-tells.md, "Colored
// stripe on one side of a card or row"). The app carried 22 of them: deck and
// binder colors down every index tile on top of the color bar under the art,
// an accent bar beside every page title, warning and verdict rails, an inset
// bar marking a new row, and an inline `borderLeftWidth: 3` on the binder tabs
// that no stylesheet scan could see. Each now says its meaning where the
// reader looks: a tint, the label's ink and weight, a chip or an icon, the
// identity dot, or nothing.
//
// What this fails, in every stylesheet and every TS/TSX `style` prop:
//   - border-left / -right / -inline-start / -inline-end (shorthand, -width or
//     -color) that is 2px or wider, or that takes a non-neutral color at any
//     width;
//   - an inset box-shadow bar offset 2px or more on the x axis with no y
//     offset (`inset 3px 0 var(--accent)`), the stripe's stand-in;
//   - a `borderLeft…`/`borderRight…`/`borderInline…` key in a style object.
// A full border, a 1px neutral divider between columns, a focus ring and a
// tab's underline (a bottom edge, the platform's selected-tab idiom) pass.
//
// ALLOWED holds only a named platform idiom, in a neutral token: the
// blockquote rule beside text quoted from a card or from Gatherer.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** file (relative to src) -> selector -> the idiom that keeps it. */
const ALLOWED: Record<string, Record<string, string>> = {
  'components/card/CardRulings.css': {
    '.card-rulings-item':
      'blockquote rule: each ruling is Gatherer text quoted verbatim, in the neutral --border-strong',
  },
  'styles/deck-builder-commander-profile.css': {
    '.cmdr-profile-ability':
      "blockquote rule: the commander's ability is oracle text quoted from the card, in the neutral --border-strong",
  },
};

/** Tokens that carry no meaning: a divider, a frame, the page. */
const NEUTRAL = /^var\(--(border|border-strong|chrome-border|hair|surface|surface-raised|bg)\)$/;

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full, ext));
    else if (ext.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(srcRoot, f).split(sep).join('/');

/** True when a color value is neutral (or there is no color at all). */
function neutralColor(value: string): boolean {
  const colors = value.match(
    /var\(--[\w-]+(?:,[^)]*)?\)|#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi
  );
  if (!colors) return true;
  return colors.every((c) => {
    if (NEUTRAL.test(c)) return true;
    const rgb = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    return !!rgb && rgb[1] === rgb[2] && rgb[2] === rgb[3]; // a black/white wash
  });
}

/** Widest px length in a value (rem counted at 16px). */
function widthPx(value: string): number {
  let max = 0;
  for (const m of value.matchAll(/(-?[\d.]+)(px|rem|em)\b/g)) {
    const n = Math.abs(parseFloat(m[1])) * (m[2] === 'px' ? 1 : 16);
    max = Math.max(max, n);
  }
  if (/\b(thin)\b/.test(value)) max = Math.max(max, 1);
  if (/\b(medium|thick)\b/.test(value)) max = Math.max(max, 3);
  return max;
}

interface Hit {
  where: string;
  decl: string;
}

function cssStripes(): Hit[] {
  const hits: Hit[] = [];
  for (const f of files(srcRoot, /\.css$/)) {
    const file = rel(f);
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].trim().split(/\s*,\s*/);
      for (const raw of m[2].split(';')) {
        const d = raw.trim();
        const side = d.match(
          /^border-(left|right|inline-start|inline-end)(-width|-color|-style)?\s*:\s*(.+)$/i
        );
        const shadow = d.match(/^box-shadow\s*:\s*(.+)$/i);
        let stripe = false;
        if (side) {
          const [, , part, value] = side;
          if (/^(0|none|transparent|initial|unset|inherit)$/i.test(value.trim())) continue;
          if (part === '-style') continue;
          const wide = part === '-color' ? false : widthPx(value) >= 2;
          const colored = part === '-width' ? false : !neutralColor(value);
          stripe = wide || colored;
        } else if (shadow) {
          stripe = shadow[1].split(/,(?![^(]*\))/).some((layer) => {
            const l = layer.trim();
            const xy = l.match(/^inset\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?(?:\s|$)/);
            return !!xy && Math.abs(parseFloat(xy[1])) >= 2 && parseFloat(xy[2]) === 0;
          });
        }
        if (!stripe) continue;
        const allowed = selectors.every((s) => ALLOWED[file]?.[s] && side && neutralColor(side[3]));
        if (!allowed) hits.push({ where: `${file}: ${selectors.join(', ')}`, decl: d });
      }
    }
  }
  return hits;
}

function styleStripes(): Hit[] {
  const hits: Hit[] = [];
  for (const f of files(srcRoot, /\.(tsx|ts)$/)) {
    if (/\.test\.tsx?$|\.d\.ts$/.test(f)) continue;
    const file = rel(f);
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (
        /\bborder(Left|Right|InlineStart|InlineEnd)\w*\s*:/.test(line) ||
        /boxShadow\s*:\s*['`"]inset\s+-?[2-9]/.test(line)
      ) {
        hits.push({ where: `${file}:${i + 1}`, decl: line.trim() });
      }
    });
  }
  return hits;
}

describe('no stripe down one side (STYLE_GUIDE § Layout system)', () => {
  it('no stylesheet draws a one-sided stripe or an inset side bar', () => {
    const hits = cssStripes();
    expect(hits.map((h) => `${h.where} → ${h.decl}`)).toEqual([]);
  });

  it('no style prop draws a one-sided border', () => {
    const hits = styleStripes();
    expect(hits.map((h) => `${h.where} → ${h.decl}`)).toEqual([]);
  });

  it('every ALLOWED entry still exists, so the list only shrinks', () => {
    for (const [file, sels] of Object.entries(ALLOWED)) {
      const css = readFileSync(join(srcRoot, file), 'utf8');
      for (const sel of Object.keys(sels)) {
        expect(css.includes(`${sel} {`), `${file} ${sel}`).toBe(true);
      }
    }
  });
});
