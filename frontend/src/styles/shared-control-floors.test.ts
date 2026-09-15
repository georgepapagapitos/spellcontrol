/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The app's shared interactive primitives must declare their own
 * coarse-pointer floor, so a surface that uses one inherits a legal touch
 * target instead of having to remember a local `min-height`.
 *
 * `.btn` is why this exists. It computed 41px from its own padding — three
 * pixels under — everywhere no surface happened to add a floor of its own.
 * Measured during the playtest sweep (batch 2,
 * `.claude/tools/btn-floor-probe.mjs`, phone/coarse): 42 of 43 visible `.btn`
 * on /you and 1 on /rules at 41px, while every other route read 44 because
 * that surface floored them locally. Per-surface floors are precisely the
 * thing a base rule removes the need for, and they hid the hole: the routes
 * anyone checks first looked correct.
 *
 * `.toolbar-pill` joined the list after the sweep measured it at 34px — ten
 * pixels under, the worst shortfall found — which is the honest limitation of a
 * CURATED list: it only guards what someone remembered to add. The nightly
 * journey's real-browser check (scripts/journey.mjs, undersizedTouchTargets)
 * is what finds the ones this list does not know about.
 *
 * Note the failure this CANNOT catch: a floor that is declared but inert.
 * `.btn`'s own base rule carries a comment about exactly that — `min-height`
 * is silently ignored on an inline box, so 34 `.btn` anchors measured 29px
 * while declaring 44 until the rule set `display: inline-flex`. A static
 * assertion sees the declaration, not the computed box, so both halves are
 * asserted here: the floor, and the display mode that lets it land.
 */
const SHARED_CONTROLS = ['.btn', '.tab', '.pill-btn', '.search-pill', '.toolbar-pill'];

/** Every `@media (pointer: coarse)` body across the stylesheet directory. */
function allCoarseBlocks(): string {
  const out: string[] = [];
  for (const file of readdirSync(here).filter((f) => f.endsWith('.css'))) {
    // Strip comments FIRST. Without this a documented rule fails its own
    // check: the text between the previous `}` and the rule's `{` includes
    // the comment above it, so the selector head reads
    // "/* why this exists */ .btn" and never matches `.btn` exactly.
    const css = readFileSync(join(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /@media[^{]*\(pointer:\s*coarse\)[^{]*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      out.push(css.slice(start, i - 1));
    }
  }
  return out.join('\n');
}

/**
 * Rule bodies where `selector` appears as a STANDALONE selector in the list —
 * `.btn` or `.btn, .tab`, never `.some-surface .btn`.
 *
 * The distinction is the whole point and this guard did not make it at first:
 * a descendant-scoped `.card-actions .btn { min-height: 44px }` in some
 * surface's coarse block satisfied a looser match, so the test passed with the
 * base-class floor reverted — i.e. it asserted nothing. A local floor on one
 * surface is exactly the workaround the base rule is meant to retire.
 */
function bodiesFor(block: string, selector: string): string[] {
  const bodies: string[] = [];
  // Selector lists can wrap across lines; match a full rule and test its head.
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = m[1].split(',').map((s) => s.trim());
    if (parts.some((p) => p === selector)) bodies.push(m[2]);
  }
  return bodies;
}

describe('shared control coarse-pointer floors', () => {
  const coarse = allCoarseBlocks();

  it('reads the stylesheets at all', () => {
    // Guard the guard — an empty scan would pass every case below vacuously.
    expect(coarse.length).toBeGreaterThan(500);
  });

  it.each(SHARED_CONTROLS)('%s declares a >=44px coarse floor', (sel) => {
    const bodies = bodiesFor(coarse, sel);
    expect(
      bodies.length,
      `${sel} has no rule inside any @media (pointer: coarse) block. A shared ` +
        `control must carry its own floor — otherwise every surface that uses it ` +
        `has to remember a local min-height, and the ones that forget ship a ` +
        `sub-44px target that reads as fine on the routes you check first.`
    ).toBeGreaterThan(0);
    const floored = bodies.some((b) => {
      const m = b.match(/min-height:\s*(\d+)px/) || b.match(/height:\s*(\d+)px/);
      return m ? Number(m[1]) >= 44 : false;
    });
    expect(floored, `${sel} has a coarse rule but no >=44px height in it`).toBe(true);
  });

  it('no rule undercuts a shared control below 44px', () => {
    /**
     * The failure this catches is the one that actually shipped, and a
     * "does a floor exist?" check cannot see it: a floor WAS declared, and a
     * later rule at the same specificity quietly lowered it.
     * `responsive-nav.css`'s phone density pass set `.btn { min-height: 36px }`
     * inside `@media (max-width: 600px)` — same specificity as the coarse
     * floor, later in the bundle, so it won on every phone.
     *
     * A `(pointer: fine)` context is the one legitimate place to go below 44:
     * a mouse only needs WCAG 2.5.8's 24px.
     */
    const offenders: string[] = [];
    for (const file of readdirSync(here).filter((f) => f.endsWith('.css'))) {
      const css = readFileSync(join(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const parts = m[1].split(',').map((s) => s.trim());
        const sel = SHARED_CONTROLS.find((s) => parts.includes(s));
        if (!sel) continue;
        const mh = m[2].match(/min-height:\s*(\d+)px/);
        if (!mh || Number(mh[1]) >= 24) continue;
        offenders.push(`${file}: ${sel} { min-height: ${mh[1]}px }`);
      }
      // Anything at/above 24 but below 44 is only legal for a fine pointer.
      for (const m of css.matchAll(/@media([^{]*)\{/g)) {
        if (/pointer:\s*fine/.test(m[1])) continue;
        const start = m.index + m[0].length;
        let depth = 1;
        let i = start;
        while (i < css.length && depth > 0) {
          if (css[i] === '{') depth++;
          else if (css[i] === '}') depth--;
          i++;
        }
        const body = css.slice(start, i - 1);
        for (const r of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const parts = r[1].split(',').map((s) => s.trim());
          const sel = SHARED_CONTROLS.find((s) => parts.includes(s));
          if (!sel) continue;
          const mh = r[2].match(/min-height:\s*(\d+)px/);
          if (!mh || Number(mh[1]) >= 44) continue;
          offenders.push(`${file}: @media${m[1].trim()} → ${sel} { min-height: ${mh[1]}px }`);
        }
      }
    }
    expect(
      offenders,
      `a shared control is floored below 44px outside a (pointer: fine) context:\n  ` +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('.btn stays a flex box, or its min-height is silently ignored', () => {
    // An inline box drops min-height entirely; `.btn` sits on 34 <Link>
    // anchors, which compute `display: inline` by default.
    const css = readFileSync(join(here, 'tabs.css'), 'utf8');
    const base = css.match(/\n\.btn\s*\{([^}]*)\}/);
    expect(base, '.btn base rule is gone from tabs.css').toBeTruthy();
    expect(base![1]).toMatch(/display:\s*(inline-)?flex/);
  });
});
