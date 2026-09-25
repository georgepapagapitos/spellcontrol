// @vitest-environment node
/**
 * Guard: no horde half/band container ever becomes the containing block for
 * a `position: fixed` descendant.
 *
 * `.horde-half` used to carry `filter: saturate() brightness()` for its
 * "step back" tint. `filter` — like `transform`, `perspective`, `contain`,
 * `backdrop-filter`, or `will-change: transform`/`filter` — makes the
 * element the containing block for any fixed-position descendant, so the
 * damage sheet and the card menu (both `position: fixed` via the shared
 * card-picker shell) mounted "inside" a horde half/band clipped to that
 * box instead of the viewport and their own Done/Close buttons went
 * unreachable (E387 PR 5 follow-up). The real fix is that neither overlay
 * renders inside these containers at all any more (see `HordeOverlays.tsx`)
 * — this guard is the belt for that suspenders: even if one came back as a
 * descendant, it must never inherit a trap from its container's own CSS.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_PROPS = [
  'filter',
  'transform',
  'perspective',
  'contain',
  'backdrop-filter',
  'will-change',
];

// Exact class NAMES (no leading dot) that must never carry one of the
// properties above — every container an overlay could conceivably be
// mounted inside.
const GUARDED_CLASSES = ['horde-half', 'horde-band', 'horde-band__field'];

function ruleBlocks(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: { selector: string; body: string }[] = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    blocks.push({ selector: m[1].trim(), body: m[2] });
  }
  return blocks;
}

/** Class tokens making up the selector's first compound (ignores any
 *  descendant/child combinator — a containing-block property only matters
 *  on the element the rule directly targets, not its ancestors). */
function firstCompoundClasses(selector: string): string[] {
  const first = selector.trim().split(/\s+/)[0] ?? '';
  return [...first.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

function declaresForbidden(body: string): string[] {
  const hits: string[] = [];
  for (const prop of FORBIDDEN_PROPS) {
    // A real declaration, not a value/comment mentioning the word — must be
    // followed by `:` (optionally preceded by whitespace/`;`), and `none`/
    // absent is fine (e.g. a reset), any other value trips the guard.
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(body);
    if (m && m[1].trim().toLowerCase() !== 'none') hits.push(prop);
  }
  return hits;
}

const cssFiles = readdirSync(dir).filter((f) => f.endsWith('.css'));

describe('horde containing-block guard', () => {
  it('discovers the horde CSS files (sanity)', () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('never sets filter/transform/perspective/contain/backdrop-filter/will-change on a horde half/band container', () => {
    const offenders: string[] = [];
    for (const file of cssFiles) {
      const css = readFileSync(join(dir, file), 'utf8');
      for (const { selector, body } of ruleBlocks(css)) {
        for (const compound of selector.split(',')) {
          const classes = firstCompoundClasses(compound);
          if (!classes.some((c) => GUARDED_CLASSES.includes(c))) continue;
          for (const prop of declaresForbidden(body)) {
            offenders.push(`${file} "${compound.trim()}" sets ${prop}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
