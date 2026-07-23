/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// A11y guard (STYLE_GUIDE.md § Accessibility): every interactive element that
// carries a :hover visual rule must also carry a :focus-visible ring. The
// hover-gate (@media (hover: hover)) makes hover conditional on pointer type;
// :focus-visible is unconditional and serves keyboard / switch-access users.
// Writing the hover and forgetting the ring was the single most common a11y gap
// in the full-app UX-cohesion sweep (present on all 20 views). This guard fails
// CI if any interactive :hover selector lacks a :focus-visible counterpart, so a
// new component can't silently ship a keyboard-invisible control.
//
// "Covered" = a :focus-visible rule exists whose class-set is a subset of the
// hover selector's class-set (i.e. the same element, possibly less qualified,
// already gets a ring). The allowlist holds selectors covered by a *different*
// co-occurring base class (e.g. `.btn-danger` elements also carry `.btn`, which
// has a ring) plus a parse-only artifact.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const INTERACTIVE =
  /(btn|button|\blink\b|-link|\btab\b|-tab|chip|pill|-action|-open|-toggle|-cta|-rematch|-remove|-retry|-delete|-add\b|option|summary|facing|sort-btn|signin|stats-link|menu|hub-row|opening|pile|zones|expander|template|segmented|pagination|qty-btn|disc-toggle|swatch|trigger|item)/i;

// Selectors covered by a co-occurring base class on the element (the subset rule
// can't see cross-class coverage), or a non-hover parse artifact. Keep this list
// short and justified — it is the escape hatch, not the norm.
const ALLOWLIST = new Set([
  '.btn-danger', // element also carries .btn (.btn:focus-visible in tabs.css)
  '.btn-primary', // element also carries .btn
  '.upload-action-danger', // element also carries .upload-action
  '.upload-action-primary', // element also carries .upload-action
  '.deck-row-menu-item--danger', // element also carries .deck-row-menu-item
  '.scanner-search-pill > input:-webkit-autofill', // autofill style, not a hover affordance
]);

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(full));
    else if (e.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function classSet(sel: string): Set<string> {
  return new Set(sel.match(/\.[A-Za-z0-9_-]+/g) ?? []);
}
function subset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// A second, stricter guard (UX wave 2): the test above only confirms a
// :focus-visible rule EXISTS — it doesn't check that the rule actually shows
// anything. STYLE_GUIDE § Accessibility: "outline: none inside a
// :focus-visible block is invalid. A block that sets outline: none and
// relies only on a border-color or background shift does not meet WCAG
// 2.4.11's visible-ring requirement. The outline property is the mechanism —
// keep it." An app-wide sweep (UX wave 2) found ~56 selectors doing exactly
// this — real outline was restored to all of them. This guard fails CI if
// the anti-pattern regrows, so it can't quietly come back one component at a
// time the way it was introduced.
//
// The ONLY escape hatch is a documented case where a genuinely visible,
// equivalent-strength ring already ships via a different mechanism (e.g. a
// box-shadow ring on an element whose shape `outline` can't follow). A plain
// background/border-color/filter shift does NOT qualify — STYLE_GUIDE is
// explicit that shift alone fails the bar, however strong the shift reads
// subjectively. Keep this allowlist short; each entry needs its own
// justification comment naming the real replacement.
const NO_VISIBLE_OUTLINE_ALLOWLIST = new Set<string>([
  '.commander-color-pip', // circular swatch — outline can't follow the circle;
  // real ring is a double box-shadow instead: `0 0 0 2px var(--accent), 0 0 0
  // 4px var(--surface)` (deck-builder-commander.css) — a genuine 2px ring,
  // just drawn via box-shadow rather than the outline property.
]);

function focusVisibleBlocks(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selectorList = m[1];
    if (!selectorList.includes(':focus-visible')) continue;
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    for (const raw of selectorList.split(',')) {
      const s = raw.trim();
      if (s.includes(':focus-visible')) out.push({ selector: s, body });
    }
  }
  return out;
}

// Last `outline` declaration wins (normal CSS cascade within one rule). A
// real shorthand value (`2px solid var(--accent)`) is fine; `none`/`0`/`0px`
// suppresses it. No `outline` mentioned at all is NOT a violation here — the
// rule may be intentionally deferring to a lower-specificity base rule that
// already sets a ring (the first test above enforces that a ring exists
// somewhere; this one only forbids explicitly killing it without a visible
// replacement).
function outlineIsSuppressed(body: string): boolean {
  const matches = [...body.matchAll(/outline\s*:\s*([^;]+);/g)];
  if (matches.length === 0) return false;
  const last = matches[matches.length - 1][1].trim();
  return /^(none|0|0px)$/i.test(last);
}

describe('focus-visible rings (a11y)', () => {
  const files = cssFiles(srcRoot);

  it('every interactive :hover has a :focus-visible ring', () => {
    const focusSets: Set<string>[] = [];
    const hovers: Array<{ file: string; base: string }> = [];

    for (const f of files) {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{/g)) {
        for (const raw of m[1].split(',')) {
          const s = raw.trim();
          if (!s) continue;
          if (s.includes(':hover')) {
            const base = s.split(':hover')[0].trim();
            if (base) hovers.push({ file: f.replace(`${srcRoot}/`, ''), base });
          }
          if (s.includes(':focus-visible')) {
            const base = s.split(':focus-visible')[0].trim();
            if (base) focusSets.push(classSet(base));
          }
        }
      }
    }

    const offenders = hovers
      .filter(({ base }) => INTERACTIVE.test(base) && !ALLOWLIST.has(base))
      .filter(({ base }) => {
        const cb = classSet(base);
        if (cb.size === 0) return false; // element/attr-only hover
        return !focusSets.some((fs) => subset(fs, cb));
      })
      .map(({ file, base }) => `${file}:  ${base}`);

    expect(
      [...new Set(offenders)].sort(),
      'interactive :hover without a :focus-visible ring — add `outline: 2px solid var(--accent); outline-offset: 2px` for the same selector (see STYLE_GUIDE.md § Accessibility)'
    ).toEqual([]);
  });

  it('every :focus-visible ring is actually visible (no unreplaced outline: none)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const { selector, body } of focusVisibleBlocks(css)) {
        if (!outlineIsSuppressed(body)) continue;
        const base = selector.split(':focus-visible')[0].trim();
        if (NO_VISIBLE_OUTLINE_ALLOWLIST.has(base)) continue;
        offenders.push(`${f.replace(`${srcRoot}/`, '')}:  ${selector}`);
      }
    }

    expect(
      [...new Set(offenders)].sort(),
      "outline: none inside :focus-visible with no visible replacement — add `outline: 2px solid var(--accent); outline-offset: 2px` (white ring on always-dark surfaces, or the component's own color var for a colored badge), or add a justified NO_VISIBLE_OUTLINE_ALLOWLIST entry (see STYLE_GUIDE.md § Accessibility)"
    ).toEqual([]);
  });
});
