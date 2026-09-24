/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Touch targets must not overlap each other (board E317).
 *
 * Every assertion here was written against a MEASURED hit area from a real
 * browser at the phone tier on 2026-09-20 — `elementFromPoint` walked outward
 * from each control's centre, never `getBoundingClientRect` alone. That
 * distinction is the whole point: all four defects below reported a 44x44
 * BOX, so the nightly journey's box-reading floor check passed them, while the
 * real target was 39-41px and the missing strip activated the control NEXT to
 * it.
 *
 * The recurring cause is one idiom. A control bleeds over its container's
 * padding with a negative margin equal to its own padding, so the padding does
 * not count in layout. On the inline axis that is correct — nothing is beside
 * it. On the BLOCK axis the thing above and below is another instance of the
 * same control, so consecutive rows overlap and the one painted later wins:
 *
 *   - `.new-from-friends-link` (`margin: calc(var(--space-2) * -1)`) overlapped
 *     by 8px. Each 44px row had a 39px usable target, and tapping the bottom of
 *     one row opened the NEXT friend's deck.
 *   - `.discover-card-link` and `.activity-strip-link` — same declaration,
 *     same rail shape, same defect. The scan below found the fourth one after
 *     the browser check had found the first three.
 *   - `.engine-axis-btn` (`margin: -0.35rem -0.45rem`) overlapped by 2.4px into
 *     the next axis of the power panel.
 *
 * The same rule applies to a `::after` ghost, which is the app's other way of
 * reaching 44px: the ghost may not be wider than the control's own pitch, or it
 * overlaps its neighbour's ghost.
 *
 * The live guard is `overlappingTouchTargets()` in `scripts/journey.mjs`, which
 * hit-tests all 38 screens nightly and FAILS the run — it is what caught the
 * badge pair and `.discover-card-link` after the first two were fixed. This
 * file is its CI-time counterpart: static, so it cannot see a new overlap, but
 * it does stop these specific rules from regressing between nightlies.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..');
const read = (f: string) => readFileSync(join(srcDir, f), 'utf8');

/** Every body declared for a selector, joined — a selector legitimately
 *  appears in both the base sheet and a `@media (pointer: coarse)` block. */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  return bodies.length > 0 ? bodies.join('\n') : null;
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('touch targets do not overlap each other', () => {
  it('reads the stylesheets at all', () => {
    // Guard the guard — an empty read would pass everything below vacuously.
    for (const f of [
      'components/home/HomeCard.css',
      'pages/HomePage.css',
      'components/deck/EnginePanel.css',
      'styles/collection.css',
    ]) {
      expect(read(f).length, `${f} read empty`).toBeGreaterThan(200);
    }
  });

  // ── The negative-margin idiom, per fixed rule ────────────────────────────
  const stackedRows: [string, string][] = [['components/deck/EnginePanel.css', '.engine-axis-btn']];

  for (const [file, selector] of stackedRows) {
    it(`${selector} bleeds over its container on the inline axis only`, () => {
      const body = ruleBody(read(file), selector);
      expect(body, `${selector} not found in ${file}`).toBeTruthy();
      expect(
        body!,
        `${selector} is a stacked row. A negative margin on the BLOCK axis ` +
          'overlaps the row above and below, the row painted later wins the ' +
          'strip, and the tap opens the wrong item — measured, not inferred.'
      ).toMatch(/margin-inline:/);
      const shorthand = body!.match(/(?:^|\n)\s*margin:\s*([^;]+);/);
      expect(
        shorthand && /-/.test(shorthand[1]),
        `${selector} declares a negative \`margin\` shorthand again: ` +
          `"${shorthand?.[1]}". Use margin-inline.`
      ).toBeFalsy();
    });
  }

  it('no other stacked row grows the same idiom', () => {
    // The two rails were written from each other, so the third copy is the
    // likely regression. Scan every stylesheet for a negative margin shorthand
    // on a row-shaped interactive selector.
    const offenders: string[] = [];
    for (const full of cssFiles(srcDir)) {
      const css = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([.#][\w-]*(?:link|btn|row|card|item))\s*\{([^}]*)\}/g)) {
        const decl = m[2].match(/(?:^|\n)\s*margin:\s*([^;]+);/);
        if (!decl) continue;
        // A one-value shorthand (`margin: -1px`) is an axis-agnostic hairline
        // nudge for a border seam, not a padding bleed; the defect shape is a
        // negative value that carries the row's own block padding.
        // Split on top-level whitespace only — `calc(var(--x) * -1)` is one
        // value, and the `-` inside a custom-property name is not a sign.
        const values = (decl[1].trim().match(/calc\([^)]*\)|[^\s]+/g) ?? []).map((v) => v.trim());
        const negative = (v: string) => /^-/.test(v) || /\*\s*-1/.test(v);
        // The block axis is the first value of the shorthand (and a one-value
        // shorthand applies to both axes).
        if (!negative(values[0] ?? '')) continue;
        // A hairline nudge (`margin: -1px`) closes a border seam; it is not a
        // row pulling its own padding out of the flow.
        if (/^-?\d*\.?\d+px$/.test(values[0]) && Math.abs(parseFloat(values[0])) <= 1) continue;
        offenders.push(`${relative(srcDir, full)} ${m[1]} → margin: ${decl[1].trim()}`);
      }
    }
    expect(
      offenders,
      'A negative block margin on a stacked interactive row overlaps its ' +
        'neighbours and steals their taps (E317). Use `margin-inline`.'
    ).toEqual([]);
  });

  // ── Ghosts may not be wider than the control's own pitch ─────────────────
  it('the collection tile badges ghost to their pitch, not past their neighbour', () => {
    const css = read('styles/collection.css');
    for (const selector of ['.card-list-binder-badge::after', '.card-list-deck-badge::after']) {
      const body = ruleBody(css, selector);
      expect(body, `${selector} lost its ghost`).toBeTruthy();
      expect(
        body!,
        `${selector} measured a 29px badge with a 44px ghost, 33.8px from its ` +
          'sibling: ~10px of overlap, won by whichever badge paints later, so ' +
          'a tap on the deck badge opened the binder sheet.'
      ).toMatch(/width:\s*calc\(100% \+ var\(--space-1\)\)/);
      // The height cap is the OTHER ruling and must stay: a 44px-tall ghost
      // overhangs the card art and steals the tile's own tap.
      expect(body!, 'the 36px height cap is deliberate — see the rule above it').toMatch(
        /height:\s*36px/
      );
    }
  });

  it('an in-pill search submit ghost grows away from the field, not over it', () => {
    for (const [file, selector] of [
      ['pages/HomePage.css', '.home-section-search-submit::after'],
      ['components/welcome/WelcomeHero.css', '.welcome-hero-search-submit::after'],
    ] as const) {
      const body = ruleBody(read(file), selector);
      expect(body, `${selector} lost its ghost`).toBeTruthy();
      expect(
        body!,
        'A 44px ghost centred on the 1.6rem circle reached 2.8px into the ' +
          'search input, so a tap at the end of the query submitted it instead ' +
          'of placing the caret. Anchor it to the left edge so the extra target ' +
          "lands in the row's trailing padding."
      ).toMatch(/left:\s*0/);
      expect(body!, 'only the vertical centring survives the re-anchor').toMatch(
        /transform:\s*translateY\(-50%\)/
      );
    }
  });
});
