/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * E415, measured at 390px touch on a 100-card Commander deck:
 *
 * - The Deck tab's glance strip wrapped three stats and a straggler, Sort and
 *   View sat at opposite ends of their row, and the role chips wrapped onto a
 *   second line, so the first card row started below the fold. The strip is
 *   one line on a phone, the controls pack left with the ⋮ on the right, and
 *   the role chips are one scrolling line at every width.
 * - The Coach suggestions were bordered cards inside the Suggestions panel.
 *   They are hairline rows, and from a 48rem feed a table with its own
 *   "played in" column.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  readFileSync(join(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the first top-level `selector { … }` rule. */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  return css.match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`))?.[2] ?? '';
}

/** Body of the LAST block for an at-rule prelude, braces balanced. */
function lastBlock(css: string, prelude: RegExp): string {
  let found = '';
  for (const m of css.matchAll(new RegExp(prelude.source + '\\s*\\{', 'g'))) {
    let depth = 0;
    const start = m.index! + m[0].length - 1;
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        found = css.slice(start + 1, i);
        break;
      }
    }
  }
  return found;
}

describe('Deck tab, phone top', () => {
  it('keeps the role chips on one scrolling line', () => {
    const bar = rule(read('deck-builder-deck-extras.css'), '.deck-role-bar');
    expect(bar).toMatch(/flex-wrap:\s*nowrap/);
    expect(bar).toMatch(/overflow-x:\s*auto/);
  });

  it('fits the glance strip on one line on a phone', () => {
    const phone = lastBlock(read('deck-builder-analysis.css'), /@media \(max-width: 600px\)/);
    expect(rule(phone.trim(), '.deck-stat-strip')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule(phone.replace(/^\s+/gm, ''), '.deck-stat-label-long')).toMatch(/display:\s*none/);
  });

  it('packs Sort and View left with the ⋮ on the right', () => {
    // The last 600px block: an earlier one loses to the 1024px block below it.
    const phone = lastBlock(read('deck-builder-responsive.css'), /@media \(max-width: 600px\)/);
    const flat = phone.replace(/^\s+/gm, '');
    expect(rule(flat, '.deck-toolbar-controls')).toMatch(/justify-content:\s*flex-start/);
    expect(rule(flat, '.deck-toolbar-more')).toMatch(/margin-left:\s*auto/);
  });
});

describe('Coach suggestions', () => {
  const css = read('../components/deck/CoachFeed.css');

  it('are hairline rows, not bordered cards in the panel', () => {
    const row = rule(css, '.coach-feed-rows > li > .deck-card-row');
    expect(row).toMatch(/border:\s*0/);
    expect(row).toMatch(/border-bottom:\s*0\.5px solid var\(--border\)/);
    expect(row).toMatch(/background:\s*none/);
  });

  it('become a table from a 48rem feed', () => {
    const wide = lastBlock(css, /@container \(min-width: 48rem\)/).replace(/^\s+/gm, '');
    expect(wide).toMatch(/grid-template-columns:\s*var\(--coach-art-col\)/);
    // A swap's out -> in thumbs overflowed a 52px column into the name.
    expect(rule(css, '.coach-feed-panel:has(.deck-card-row-swap-art)')).toMatch(
      /--coach-art-col:\s*7rem/
    );
    expect(rule(wide, '.coach-feed-rows > li > .deck-card-row > .deck-card-row-body')).toMatch(
      /display:\s*contents/
    );
    expect(rule(wide, '.coach-feed-rows > li > .deck-card-row .deck-card-row-incl-meter')).toMatch(
      /display:\s*block/
    );
  });
});

describe('Next best move', () => {
  const css = read('../components/deck/NextBestMove.css');

  it('lists its steps as hairline rows, not boxes inside the panel', () => {
    const row = rule(css, '.next-best-move-row');
    expect(row).toMatch(/border-bottom:\s*0\.5px solid var\(--border\)/);
    expect(row).not.toMatch(/(^|[^-])border:|background:|border-radius:/);
    const primary = rule(css, '.next-best-move-row.is-primary');
    expect(primary).toBe('');
    expect(rule(css, '.next-best-move-row.is-primary .next-best-move-rank')).toMatch(
      /background:\s*var\(--tier-color\)/
    );
  });
});
