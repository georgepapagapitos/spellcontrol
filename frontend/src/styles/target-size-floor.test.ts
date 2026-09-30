/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * WCAG 2.2 SC 2.5.8 (Target Size, Minimum): every pointer target is at least
 * 24x24 CSS px, or is spaced so a 24px circle on it hits no other target.
 * axe's `target-size` rule reads the element's own box: a `::after` ghost (the
 * 44px coarse-pointer floor) is invisible to it, and the ghosts here only exist
 * under `(pointer: coarse)`, so a desktop build shipped 18-23px controls (69
 * elements in the 2026-09 axe sweep: card-row kebab 18px, quantity editor
 * 22.4px, collection tile menu 22px, identity marks 23px, rules kebab 20px,
 * curve segments 6px tall).
 *
 * The fix is the box itself: `min-width`/`min-height: 24px`, with a negative
 * margin where the row is dense so the layout does not grow. This test pins
 * each known control's base (all-pointer) rule at 24px, and sweeps every
 * stylesheet for a button-like rule that declares a smaller explicit size.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : cssFiles(p);
    return n.endsWith('.css') ? [p] : [];
  });
}

interface Rule {
  selector: string;
  body: string;
  file: string;
}

/** Top-level (not inside an at-rule) style rules, comments stripped. */
function topLevelRules(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let depth = 0;
  let start = 0;
  let head = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) head = css.slice(start, i).trim();
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        if (!head.startsWith('@'))
          rules.push({ selector: head, body: css.slice(css.indexOf('{', start) + 1, i), file });
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return rules;
}

function px(v: string): number | null {
  const m = v.trim().match(/^(-?[\d.]+)(px|rem)$/);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1);
}

function decl(body: string, prop: string): number | null {
  const m = body.match(new RegExp(String.raw`(?:^|[;\s])${prop}\s*:\s*([^;]+)`));
  return m ? px(m[1]) : null;
}

const all = cssFiles(root).flatMap(topLevelRules);

describe('target size floor (WCAG 2.5.8)', () => {
  // selector (exact, as written), axes that must reach 24px in the base rule
  const known: [string, ('w' | 'h')[]][] = [
    ['.deck-row-menu-trigger', ['w', 'h']],
    ['.deck-row-qty-edit', ['w']],
    ['.collection-grid-menu-btn', ['w', 'h']],
    ['.overflow-menu-trigger', ['w', 'h']],
    [':where(.art-badge[data-identity]:is(a, button))', ['w', 'h']],
  ];

  it.each(known)('%s has a 24px box in every pointer mode', (selector, axes) => {
    const rules = all.filter((r) => r.selector === selector);
    expect(rules.length, `no base rule for ${selector}`).toBeGreaterThan(0);
    const size = (p: string, q: string) =>
      Math.max(...rules.map((r) => Math.max(decl(r.body, p) ?? 0, decl(r.body, q) ?? 0)));
    if (axes.includes('w')) expect(size('min-width', 'width')).toBeGreaterThanOrEqual(24);
    if (axes.includes('h')) expect(size('min-height', 'height')).toBeGreaterThanOrEqual(24);
  });

  it('a stacked curve segment is never a button', () => {
    const css = readFileSync(join(root, 'components/deck/DeckCurvePhases.css'), 'utf8');
    expect(css).not.toMatch(/deck-curve-phases-seg-btn/);
    const tsx = readFileSync(join(root, 'components/deck/DeckCurvePhases.tsx'), 'utf8');
    expect(tsx).not.toMatch(/deck-curve-phases-seg-btn/);
  });

  it('no button-like rule declares an explicit size under 24px without a floor', () => {
    const offenders = all
      .filter((r) => /(btn|button|trigger)(?![\w-])/.test(r.selector))
      // pseudo-element ghosts, focus/hover states and descendants are not the target box
      .filter(
        (r) =>
          !/>\s*(svg|img|i)\s*$|::|:hover|:focus|\[data-open\]|\[aria-expanded/.test(r.selector)
      )
      // visually-hidden (clipped) controls are not pointer targets
      .filter((r) => !/clip:\s*rect/.test(r.body))
      .filter((r) => {
        const w = decl(r.body, 'width');
        const h = decl(r.body, 'height');
        const mw = decl(r.body, 'min-width') ?? 0;
        const mh = decl(r.body, 'min-height') ?? 0;
        return (w !== null && w < 24 && mw < 24) || (h !== null && h < 24 && mh < 24);
      })
      .map((r) => `${r.file.replace(root, '')}: ${r.selector}`);
    expect(offenders.filter((o) => !ALLOW.some((a) => o.endsWith(a)))).toEqual([]);
  });
});

// Undersized by design and verified not to be a pointer target: none yet.
// Adding here needs a reason (a non-interactive glyph, or a control whose own
// box is padded to 24px by another rule in the same file).
const ALLOW: string[] = [];
