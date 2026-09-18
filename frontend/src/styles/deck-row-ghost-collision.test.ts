/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

/**
 * Two `::after` touch ghosts cannot share a stride narrower than their width.
 *
 * The deck list row puts the quantity editor and the role badge 24px apart in a
 * 36px row, and BOTH declared a 44px-wide centred ghost. The badge is the later
 * sibling, so it painted on top and won the overlap: the quantity editor's hit
 * area collapsed to 25x28 instead of the 44 its own rule intends, and a tap
 * 13px right of the quantity digit activated the ROLE FILTER rather than the
 * editor. Measured per-pixel in the playtest sweep (batch 6,
 * `.claude/tools/b6-rowscan.mjs`) on a real browser at phone width:
 *
 *     17px  deck-row-qty-edit     <- intended 44
 *     45px  role-badge-btn
 *    253px  ROW (opens the preview)
 *     30px  deck-row-menu-trigger
 *
 * …on 43 of that deck's 71 rows — every row that shows a role badge. Rows
 * WITHOUT a badge measured the intended 45px, which is what identified the
 * badge as the thief.
 *
 * The ruling: the quantity editor wins the contested space. It is a primary
 * inline edit with no other in-row path, while the badge is a filter shortcut
 * that keeps its visible box. Grid tiles keep their ghost — nothing collides
 * there, and that is why this guard is scoped to the ROW variant.
 *
 * This is a static assertion and cannot see a computed box; the geometry was
 * verified separately with the row-scan probe. What it pins is the thing a
 * future edit would silently undo — re-adding a ghost to the row badge.
 */
describe('deck row — the qty editor and the role badge do not both ghost', () => {
  const css = read('deck-builder-display.css');

  it('cancels the role badge ghost on the deck-list row', () => {
    // The rule must exist, target the ROW variant, and cancel the ghost.
    const rule = css.match(/\.role-badge-btn\.deck-row-role-badge::after\s*\{([^}]*)\}/);
    expect(rule, 'no ::after cancel for .role-badge-btn.deck-row-role-badge').toBeTruthy();
    expect(rule![1]).toMatch(/content:\s*none/);
  });

  it('keeps the ghost for the generic badge, so grid tiles are unaffected', () => {
    // The base ghost still has to be there — the fix narrows it, not removes it.
    const base = css.match(/\.role-badge-btn::after\s*\{([^}]*)\}/);
    expect(base, 'the base .role-badge-btn ghost was removed entirely').toBeTruthy();
    expect(base![1]).toMatch(/width:\s*44px/);
  });

  it('leaves the quantity editor its 44px ghost, which is the whole point', () => {
    const qty = read('deck-builder-row-qty.css');
    const ghost = qty.match(/\.deck-row-qty-edit::after\s*\{([^}]*)\}/);
    expect(ghost, 'the qty editor lost its ghost').toBeTruthy();
    expect(ghost![1]).toMatch(/width:\s*44px/);
  });
});
