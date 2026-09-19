/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');

/**
 * The table tier (≥1024px) is corners, not rows: the header, action bar and
 * tracker rows are gone and the life cluster, game menu, zone piles and hand
 * fan float over one full-bleed felt. The ≤1023px tier is deliberately
 * unchanged, which is the half of this that is easy to break by accident —
 * every rule the fan and the corners need is either on a class only the wide
 * tier's markup carries, or inside `@media (min-width: 1024px)`, never inside
 * (or above) the narrow block.
 */
function block(header: string): string {
  const start = css.indexOf(header);
  expect(start, `${header} is missing`).toBeGreaterThan(-1);
  const end = css.indexOf('\n}\n', start);
  return css.slice(start, end);
}

/** Same, but the LAST rule with this header — several selectors appear once in
 *  the shared panel-surface group and again as their own positioned rule, and
 *  `indexOf` always answers with the group. */
function lastBlock(header: string): string {
  const start = css.lastIndexOf(header);
  expect(start, `${header} is missing`).toBeGreaterThan(-1);
  const end = css.indexOf('\n}\n', start);
  return css.slice(start, end);
}

describe('table chrome at the wide tier', () => {
  it('fans the hand: overlap, rotation origin and a lift that leaves neighbours alone', () => {
    // Overlap is a negative margin in card widths, so it tracks the density
    // custom property instead of a per-breakpoint pixel guess.
    expect(css).toContain('.playtest-hand--fan');
    expect(block('.playtest-hand__slot {')).toContain('transform-origin: bottom center');
    // The lift is on the CARD inside the slot — putting it on the slot would
    // fight the inline fan rotation and shove the neighbours.
    expect(css).toContain('.playtest-hand--fan .playtest-hand__slot:hover .playtest-card {');
    expect(css).toContain(
      '.playtest-hand--fan .playtest-hand__slot .playtest-card:focus-visible {'
    );
    // Keyboard users get the same lift, and the slot still raises above its
    // neighbours when anything inside it takes focus.
    expect(css).toContain('.playtest-hand--fan .playtest-hand__slot:focus-within');
  });

  it('makes your own life the panel headline, with the others demoted and mana folded in', () => {
    // The old corner was the narrow strip floated: four equal chips plus a
    // stray mana chip. The table panel is one surface.
    const total = block('.playtest-life-table__total {');
    expect(total).toContain('font-size: var(--text-3xl)');
    expect(block('.playtest-life-table__step {')).toContain('width: 44px');
    expect(block('.playtest-life-table__step {')).toContain('height: 44px');
    expect(css).toContain('.playtest-life-table__seats {');
    // Mana is the panel's last row, not a second floating chip.
    expect(css).toContain('.playtest-life-table .playtest-mana-pool {');
    expect(css).not.toContain('.playtest-trackers--corner .playtest-life-strip');
  });

  it('bottom-anchors the hand toggle instead of floating it above the cards', () => {
    const toggle = lastBlock('.playtest-hand--fan .playtest-hand__toggle {');
    expect(toggle).toContain('bottom: 0');
    expect(toggle).not.toContain('bottom: 100%');
  });

  it('keeps the empty-table hint quiet, and silent once the hand is collapsed', () => {
    const wide = css.slice(css.lastIndexOf('@media (min-width: 1024px) {'));
    expect(wide).toContain('.playtest-battlefield__empty {');
    expect(wide).toContain('opacity: 0.6');
    expect(wide).toContain(
      '.playtest-battlefield-wrap:has(.playtest-hand--fan.is-collapsed) .playtest-battlefield__empty'
    );
  });

  it('pins the four corner clusters absolutely rather than stacking them as rows', () => {
    const corners = block('.playtest-trackers--corner,\n.playtest-corner {');
    expect(corners).toContain('position: absolute');
    expect(block('.playtest-corner--tr {')).toContain('right: var(--space-3)');
    expect(block('.playtest-piles {')).toContain('position: absolute');
    expect(block('.playtest-piles {')).toContain('flex-direction: row');
    expect(block('.playtest-banners {')).toContain('position: absolute');
  });

  it('paints the felt and rings it gold only on your own online turn', () => {
    const start = css.lastIndexOf('@media (min-width: 1024px) {');
    const wide = css.slice(start);
    expect(wide).toContain('repeating-linear-gradient');
    expect(wide).toContain('.playtest-battlefield-wrap.is-my-turn');
    expect(wide).toContain('var(--brand-seal-gold)');
    // Solo play must never light the ring: the modifier is the only carrier.
    expect(css).not.toContain('.playtest-battlefield-wrap {\n    box-shadow: inset');
  });

  it('keeps every new control on the 44px floor and with a visible focus ring', () => {
    expect(block('.playtest-corner-btn {')).toContain('min-height: 44px');
    // Matched on the newline so the shared panel group (whose last selector
    // is `.playtest-hand--fan .playtest-hand__toggle`) can't answer for it.
    expect(block('\n.playtest-hand__toggle {')).toContain('min-height: 44px');
    expect(css).toContain('.playtest-corner-btn:focus-visible,');
    expect(css).toContain('.playtest-hand__toggle:focus-visible {');
    expect(block('@media (pointer: coarse) {\n  .playtest-pile__action {')).toContain(
      'min-height: 44px'
    );
  });

  it('recomputes the density cap off the fan, not the deleted chrome rows', () => {
    // 4.3 card heights (three type rows + the fan's reserved bottom) = 6.02
    // card widths, plus the fan's own ~40px of padding/toggle.
    expect(css).toContain('--pt-card-w: clamp(90px, min(7vw, (100vh - 40px) / 7.6), 140px);');
    expect(css).not.toContain('(100vh - 340px) / 4.6');
  });
});

describe('the narrow tier keeps everything it had', () => {
  const narrow = (() => {
    const start = css.indexOf('@media (max-width: 1023px) {');
    expect(start).toBeGreaterThan(-1);
    // Brace-match so the nested rules inside don't end the slice early.
    let depth = 0;
    let i = css.indexOf('{', start);
    const from = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    return css.slice(from, i);
  })();

  it('still stacks the board, hides the desktop piles and fixes the card size', () => {
    expect(narrow).toContain('.playtest-main {');
    expect(narrow).toContain('flex-direction: column');
    expect(narrow).toContain('.playtest-piles {\n    display: none;\n  }');
    expect(narrow).toContain('--pt-card-w: 72px;');
    expect(narrow).toContain('--pt-card-h: 100px;');
  });

  it('still keeps the action bar, hand strip and zones tab it has always had', () => {
    expect(narrow).toContain('.playtest-actionbar {');
    expect(narrow).toContain('.playtest-hand {');
    expect(narrow).toContain('min-height: 110px');
    expect(narrow).toContain('.playtest-zones-tab {\n    display: block;\n  }');
    expect(narrow).toContain('.playtest-card--sm {');
  });

  it('never carries a fan or corner rule into the narrow block', () => {
    for (const cls of [
      'playtest-hand--fan',
      'playtest-corner',
      'playtest-trackers--corner',
      'playtest-turn-chip',
      'playtest-banners',
    ]) {
      expect(narrow, `${cls} leaked into the ≤1023px tier`).not.toContain(cls);
    }
  });
});
