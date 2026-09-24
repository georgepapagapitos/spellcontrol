/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PHONE_QUERY } from '@/playtest/hooks/use-narrow-viewport';

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

describe('table chrome at the wide tier', () => {
  it('fans the hand: overlap, rotation origin and a lift that leaves neighbours alone', () => {
    // Overlap is a negative margin in card widths, so it tracks the density
    // custom property instead of a per-breakpoint pixel guess.
    expect(css).toContain('.playtest-hand--fan');
    expect(block('.playtest-hand__slot {')).toContain('transform-origin: bottom center');
    // The lift is on the card's wrapper inside the slot (the card AND its cost
    // badge rise together) — putting it on the slot would fight the inline
    // fan rotation and shove the neighbours; putting it on the card alone left
    // the badge behind on the felt.
    expect(css).toContain('.playtest-hand--fan .playtest-hand__slot:hover .playtest-hand__lift {');
    expect(css).toContain(
      '.playtest-hand--fan .playtest-hand__slot:focus-within .playtest-hand__lift {'
    );
    // The card under the pointer reads as the active one.
    expect(block('.playtest-hand--fan .playtest-hand__slot:hover .playtest-card {')).toContain(
      'var(--accent)'
    );
    // Tucked: the lower part of each card hangs below the table edge, and the
    // lift brings exactly that much back up — at the hand's card height,
    // which a big hand shrinks (Hand.tsx sets `--pt-hand-card-h` to match).
    expect(block('.playtest-hand--fan {')).toContain(
      'bottom: calc(var(--pt-hand-card-h, var(--pt-card-h)) * -0.38)'
    );
    expect(
      block('.playtest-hand--fan .playtest-hand__slot:focus-within .playtest-hand__lift {')
    ).toContain('var(--pt-card-h) * -0.38');
    // The fan centres itself left of the pile row rather than on the viewport.
    expect(block('.playtest-hand--fan {')).not.toContain('left: 50%');
  });

  it('tucks each zone pile to a peek, and opens it on intent', () => {
    // Card WIDTH always (the shelf reads as the same objects as the felt and
    // follows the card-size setting), but only a slice of the height at rest:
    // the corner the piles used to eat belongs to the battlefield.
    // A leading newline in the header, so it matches the rule's own
    // selector and not the is-over/hover rules that END in the same class.
    const stack = block('\n.playtest-pile__stack {');
    expect(stack).toContain('width: var(--pt-card-w)');
    // A slice, not most of the card: the shelf rests ON the table edge (see
    // zone-shelf-tuck.test.ts) and what shows above it is the name and a band
    // of art. This file owns the ratio — the tuck guard asserts only that it
    // stays a slice.
    expect(stack).toContain('height: calc(var(--pt-card-h) * 0.35)');
    expect(stack).not.toContain('height: 72px');
    // Nothing is hidden, only deferred — pointing at a pile, tabbing into it
    // or dragging a card onto it opens the whole card. All three, or the
    // keyboard and drop paths silently keep the peek.
    expect(css).toContain('.playtest-pile:has(:focus-visible) .playtest-pile__stack,');
    expect(css).toContain('.playtest-pile.is-over .playtest-pile__stack {');
    expect(css).toContain('.playtest-pile:hover .playtest-pile__stack {');
    // The peek keeps the card's name and art, not its rules box.
    expect(block('.playtest-pile__stack img {')).toContain('object-position: top');
    // An empty zone is a well, not a filled fake card.
    expect(css).toContain('.playtest-pile.is-empty .playtest-pile__back {');
  });

  /* A zone is its label and the card under it, on the felt. The frosted tile
     that used to wrap each pile made four card-sized panels out of what are
     really four cards, and an empty graveyard read as one big blank card —
     so the pile root carries no box of its own, and the states the box used
     to show (hover, drop-over) live on the card slot instead. */
  it('sits the piles on the felt with no tile around them', () => {
    const pile = block('.playtest-pile {');
    expect(pile).not.toContain('background');
    expect(pile).not.toContain('border');
    expect(pile).not.toContain('backdrop-filter');
    // The label prints on the felt, so it takes the felt's own text colour
    // rather than a surface's — every named felt is dark whatever theme the
    // app is in.
    expect(block('.playtest-pile__label {')).toContain('color: var(--felt-text)');
    expect(block("body[data-felt='green'] {")).toContain('--felt-text');
    // Hover and drop-over ring the slot the card lands in, not a tile.
    expect(block('.playtest-pile.is-over .playtest-pile__stack {')).toContain(
      'outline: 2px solid var(--accent)'
    );
  });

  it('gives the mana row one control per color instead of a box with two steppers', () => {
    const pip = block('.playtest-mana-pip {');
    // Right-click decrements, so the pip must not hand the gesture to the OS
    // menu or start a selection under a touch long-press.
    expect(pip).toContain('user-select: none');
    expect(pip).toContain('-webkit-touch-callout: none');
    // The retired chip carried a bordered box and a +/- pair per color.
    expect(css).not.toContain('.playtest-mana-chip');
    // Still on the touch floor without growing the strip — the coarse-pointer
    // override, not the fine-pointer rule above.
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {', css.indexOf(pip)));
    expect(coarse.slice(0, coarse.indexOf('}'))).toContain('min-height: 44px');
  });

  it('keeps the life panel to a total, its steppers and a chevron', () => {
    // This panel is over the felt every second of every game, so everything
    // that is not your own life moved behind the chevron (opponents, commander
    // damage, counters) or out to its own corner (mana). A headline numeral
    // between two 44px boxes, a row of opponent chips and the mana row is what
    // it used to be; none of those may come back.
    const total = block('.playtest-life-table__total {');
    expect(total).toContain('font-size: var(--text-lg)');
    expect(total).not.toContain('var(--text-3xl)');
    const step = block('.playtest-life-table__step {');
    expect(step).toContain('width: 22px');
    expect(step).not.toContain('width: 44px');
    expect(css).not.toContain('.playtest-life-table__seats {');
    expect(css).not.toContain('.playtest-life-table .playtest-mana-pool {');
    expect(css).not.toContain('.playtest-trackers--corner .playtest-life-strip');
    // Small on screen, still a real target: the 44px floor is a ghost box, so
    // it cannot grow the panel or reach out over the battlefield.
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {', css.indexOf(step)));
    expect(coarse).toContain('width: 44px');
  });

  it('gives the running life change its own transient badge, on live tokens', () => {
    const delta = block('.playtest-life-table__delta {');
    expect(delta).toContain('animation: life-delta-in');
    // Retired tokens render transparent on the always-dark felt (ghost-tokens).
    expect(css).toContain('.playtest-life-table__delta.is-gain {');
    expect(css).toContain('.playtest-life-table__delta.is-loss {');
    expect(block('.playtest-life-table__delta.is-loss {')).toContain('var(--err-text)');
    // One-shot emphasis must be silent under reduced motion.
    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce) {', css.indexOf(delta))
    );
    expect(reduced.slice(0, 200)).toContain('animation: none');
  });

  it('stacks mana over the log in one bottom-left column, never by arithmetic', () => {
    const dock = block('.playtest-left-dock {');
    expect(dock).toContain('position: absolute');
    expect(dock).toContain('left: var(--space-4)');
    expect(dock).toContain('bottom: calc(var(--pt-card-h) + 56px)');
    expect(dock).toContain('flex-direction: column');
    // The log's height is content-driven, capped at a max it rarely reaches,
    // and it is unmounted when closed — so the column must position it, not
    // an offset computed from that max. An early attempt did the arithmetic
    // and put the mana column 117px ABOVE the top of the viewport.
    expect(block('.playtest-left-dock > .playtest-log-dock {')).toContain('position: static');
    expect(css).not.toContain('min(60vh, 640px) + var(--space-2)');
    // A long log must not push mana off the top either.
    expect(dock).toContain('max-height');
    // Same 15rem shift the log dock took alone when the rail owns the edge.
    expect(css).toContain(
      '.playtest-board:has(.playtest-main > .opponent-rail) .playtest-left-dock'
    );
    expect(block('.playtest-mana-pool--column {')).toContain('flex-direction: column');
  });

  it('sizes the Hand button off the one width every fan reservation adds in', () => {
    // It sits in the pile row, so the fan's room for that row has to count
    // it: a fixed width keeps each reservation a sum, and every one in the
    // row (desk, grid seat, tablet) must name it or the fan runs under it.
    expect(block('.playtest-hand-menu-btn {')).toContain('width: var(--pt-hand-btn-w)');
    expect(css).not.toContain('.playtest-hand__toggle');
    expect(css).not.toContain('.playtest-hand--fan.is-collapsed');
    // An upright phone has no room for it in the row (the fan covered it at
    // 390px), so it stands above the library instead and the phone span
    // leaves it out. On its side the phone has the width, so the button is
    // back in the row and that span counts it again.
    const [tablet, phone, sideways] = [...css.matchAll(/--pt-pile-span: calc\([^;]+;/g)].map(
      (m) => m[0]
    );
    expect(tablet).toContain('--pt-hand-btn-w');
    expect(phone).not.toContain('--pt-hand-btn-w');
    expect(sideways).toContain('--pt-hand-btn-w');
    const phoneTier = css.slice(css.lastIndexOf(`@media ${PHONE_QUERY} {`));
    expect(phoneTier).toContain(
      '.playtest-hand-menu-btn {\n    position: absolute;\n    bottom: 100%;'
    );
    expect(block('\n.playtest-hand--fan {')).toContain('var(--pt-hand-btn-w)');
    expect(block('.playtest-main--grid .playtest-hand--fan {')).toContain('var(--pt-hand-btn-w)');
  });

  // The hint it used to style ("Tap or drag a card from your hand to play
  // it") is gone: an empty felt with a full hand in front of it is not a
  // state that needs narrating, and the app does not narrate itself.
  it('has no empty-table hint to style', () => {
    expect(css).not.toContain('.playtest-battlefield__empty');
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
    expect(block('.playtest-hand-menu-btn {')).toContain('min-height: 44px');
    expect(css).toContain('.playtest-corner-btn:focus-visible,');
    expect(css).toContain('.playtest-hand-menu-btn:focus-visible {');
    // The pile has no button of its own to size: the tile IS the target
    // (its click draws or opens the viewer), and the menu is reached by
    // right-click, the Context Menu key, or a finger's long-press. A kebab
    // parked on a card is chrome a real table does not have.
    expect(css).not.toContain('.playtest-pile__kebab');
  });

  it('recomputes the density cap off the fan, not the deleted chrome rows', () => {
    // 4.3 card heights (three type rows + the fan's reserved bottom) = 6.02
    // card widths, plus the fan's own ~40px of padding/toggle.
    expect(css).toContain(
      '--pt-card-w: calc(clamp(90px, min(7vw, (100vh - 40px) / 7.6), 140px) * var(--pt-zoom, 1));'
    );
    expect(css).not.toContain('(100vh - 340px) / 4.6');
  });
});

/**
 * The phone and tablet tier has no layout of its own any more (2026-09-22).
 * It used to be a different board entirely — a title row, eleven buttons in
 * two rows, a life row and a mana row, which between them took 40% of the
 * screen before a card was played. It now gets the SAME corner composition
 * the desktop does, and the ≤1023px rules only size it for a thumb. That is
 * two blocks: the first sizes the shared pieces, and a second one at the end
 * of the file sizes the corner chrome — it has to come after the corner
 * rules it overrides, because a media query adds no specificity.
 */
describe('the narrow tier is the same board, sized for a thumb', () => {
  function narrowBlock(which: 'first' | 'last'): string {
    const start =
      which === 'first'
        ? css.indexOf('@media (max-width: 1023px) {')
        : css.lastIndexOf('@media (max-width: 1023px) {');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let i = css.indexOf('{', start);
    const from = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    return css.slice(from, i);
  }
  const narrow = narrowBlock('first');
  const phone = narrowBlock('last');
  const phoneOnly = (() => {
    const start = css.indexOf(`@media ${PHONE_QUERY} {`);
    expect(start, 'the phone-only block is missing').toBeGreaterThan(-1);
    return css.slice(start);
  })();

  it('keeps the thumb-sized cards', () => {
    expect(narrow).toContain('--pt-card-w: 72px;');
    expect(narrow).toContain('--pt-card-h: 100px;');
  });

  /* The edge tab is a PHONE answer, not a tier answer: four card-width
     piles plus a hand do not fit 412px, but a tablet has the width for all
     four and keeps them on the felt. "Phone" is PHONE_QUERY: narrow, or on
     its side (a phone on its side is wider than 767px). The block is found by
     that exact string, so the CSS and the markup cannot split differently. */
  it('hands the zones tab to phones alone, and sizes the fan around the piles', () => {
    expect(phoneOnly).toContain('.playtest-zones-tab {\n    display: block;\n  }');
    expect(narrow).not.toContain('.playtest-zones-tab');
    // Two piles beside the hand on a phone, four above it.
    expect(phoneOnly).toContain('--pt-pile-span: calc(2 * var(--pt-card-w)');
    expect(phone).toContain('--pt-pile-span: calc(4 * var(--pt-card-w)');
    expect(phone).toContain('left: calc((100% - var(--pt-pile-span)) / 2)');
  });

  it('no longer hides the piles or carries an action bar', () => {
    // The piles stand on the felt at every width now — the library and the
    // graveyard out here, exile and the command zone behind the tab.
    expect(css).not.toContain('.playtest-piles {\n    display: none;\n  }');
    // The action bar is gone from the board, so no rule should style one.
    expect(css).not.toContain('.playtest-actionbar');
  });

  it('sizes the corner composition for a phone AFTER the rules it overrides', () => {
    // Desk-sized pills are a quarter of a phone's width each.
    expect(phone).toContain('.playtest-corner-btn,');
    expect(phone).toContain('min-width: 0');
    // The header row goes: the game menu carries "Back to …".
    expect(phone).toContain('.playtest-page__header {\n    display: none;\n  }');
    // The fan centres in what the piles leave, or its outer card lands off
    // the left edge and under the library.
    expect(phone).toContain('.playtest-hand--fan {');
    // Ordering is the whole point: a media query adds no specificity, so
    // this block only wins by coming last.
    expect(css.lastIndexOf('@media (max-width: 1023px) {')).toBeGreaterThan(
      css.lastIndexOf('.playtest-corner-btn {\n  position: relative;')
    );
  });
});

describe('the desktop seat grid', () => {
  it('lays the seats out as equal quadrants with a gutter, off a class not a media query', () => {
    const grid = block('.playtest-main--grid {');
    expect(grid).toContain('display: grid');
    expect(grid).toContain('grid-template-columns: 1fr 1fr');
    // The gap IS the dark gutter between boards.
    expect(grid).toContain('gap: 2px');
    expect(grid).toContain('background: var(--border)');
    // Two seats are one row, not a 2x2 with two holes.
    expect(block('.playtest-main--seats-2 {')).toContain('grid-template-rows: 1fr');
    // The grid is gated in JS (PlaytestBoard's `gridMode`), so the rules must
    // not be buried in a width query that would double-gate it.
    const gridStart = css.indexOf('.playtest-main--grid {');
    const enclosingMedia = css.lastIndexOf('@media', gridStart);
    const enclosingClose = css.indexOf('\n}\n', enclosingMedia);
    expect(enclosingClose, 'the grid block sits inside a media query').toBeLessThan(gridStart);
  });

  it('redeclares the derived card vars wherever it redeclares the width', () => {
    // `--pt-card-h`/`--pt-edge` are inheriting registered properties: a
    // `--pt-card-w` redeclared alone inherits the ancestor's computed height
    // and every card comes out the wrong shape.
    for (const sel of [
      '.playtest-main--grid > .playtest-battlefield-wrap {',
      '.playtest-main--seats-2 > .playtest-battlefield-wrap {',
    ]) {
      const rule = block(sel);
      expect(rule, sel).toContain('--pt-card-w:');
      expect(rule, sel).toContain('--pt-card-h: calc(var(--pt-card-w) * 1.4)');
      expect(rule, sel).toContain('--pt-edge:');
    }
  });

  it('pins the turn stack and the banners to the viewport, and nothing else', () => {
    expect(block('.playtest-main--grid .playtest-corner--tr {')).toContain('position: fixed');
    expect(block('.playtest-main--grid .playtest-banners {')).toContain('position: fixed');
    // The life panel, the fan and the piles stay inside your own quadrant.
    for (const sel of [
      '.playtest-main--grid .playtest-trackers--corner',
      '.playtest-main--grid .playtest-piles',
    ]) {
      expect(css, `${sel} must not be lifted out of the quadrant`).not.toContain(sel);
    }
  });

  it('re-centres the fan clear of the pile row and lifts the log dock off it', () => {
    expect(block('.playtest-main--grid .playtest-hand--fan {')).toContain(
      'left: calc((100% - 21rem - var(--pt-hand-btn-w)) / 2)'
    );
    const dock = readFileSync(join(here, '../playtest/components/LogDock.css'), 'utf8');
    // Below the grid the rail owns a 15rem column and the dock docked over it.
    expect(dock).toContain(
      '.playtest-board:has(.playtest-main > .opponent-rail) .playtest-log-dock'
    );
    expect(dock).toContain('left: calc(15rem + var(--space-4))');
    const gridDock = dock.slice(dock.indexOf('.playtest-board:has(.playtest-main--grid)'));
    expect(gridDock).toContain('width: 18rem');
    expect(gridDock).toContain('bottom: calc(var(--pt-card-h) + 5rem)');
  });

  it("keeps the top-right seat's board out from under the fixed turn stack", () => {
    const quad = readFileSync(join(here, '../playtest/components/OpponentQuadrant.css'), 'utf8');
    const start = quad.indexOf('.opponent-quadrant--under-stack .opponent-quadrant__felt {');
    expect(start, 'the under-stack inset is missing').toBeGreaterThan(-1);
    expect(quad.slice(start, quad.indexOf('}', start))).toContain(
      'right: calc(14rem + var(--space-3) + var(--pt-edge))'
    );
    // The inset IS the stack's own ceiling, so a longer label or an extra
    // control can never reach past it.
    expect(block('.playtest-main--grid .playtest-corner--tr {')).toContain('max-width: 14rem');
    // And it has to come after the `inset` shorthand, which sets `right` too.
    expect(start).toBeGreaterThan(quad.indexOf('.opponent-quadrant__felt {'));
  });

  it('sizes an opponent quadrant off its own container, never the viewport', () => {
    const quad = readFileSync(join(here, '../playtest/components/OpponentQuadrant.css'), 'utf8');
    expect(quad).toContain('container-type: inline-size');
    // `cqi`, not `vw`: the same viewport holds a half-width quadrant at two
    // seats and a quarter-width one at four.
    expect(quad).toMatch(/--pt-card-w: clamp\([^)]*cqi/);
    expect(quad).not.toContain('vw');
    // The card vars are declared on the INNER element: an element cannot size
    // itself off its own container.
    const inner = quad.slice(quad.indexOf('.opponent-quadrant__inner {'));
    expect(inner.slice(0, inner.indexOf('}'))).toContain(
      '--pt-card-h: calc(var(--pt-card-w) * 1.4)'
    );
  });
});

/**
 * The felt colour setting did nothing for its entire life: the defaults were
 * declared on `.playtest-page, body`, and a custom property resolves from the
 * NEAREST declaring ancestor rather than by specificity across elements — so
 * `.playtest-page` sat between `body[data-felt='…']` and the felt that reads
 * the vars, resetting all three on the way down.
 *
 * This is a CSS-shape guard rather than a computed-style one on purpose: the
 * bug is which SELECTOR declares the defaults, and that is exactly what can
 * be read off the stylesheet.
 */
describe('the felt setting can actually reach the felt', () => {
  it('declares the felt defaults on body alone', () => {
    const decl = block('body {');
    expect(decl).toContain('--felt-base');
    expect(decl).toContain('--felt-glow');
    expect(decl).toContain('--felt-line');
  });

  it('never re-declares them below body, where they would shadow the override', () => {
    // Comments carry the word too, and they are not selectors.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const v of ['--felt-base', '--felt-glow', '--felt-line']) {
      const re = new RegExp('([^{}]*)\\{[^{}]*' + v + '\\s*:', 'g');
      for (const m of bare.matchAll(re)) {
        const selector = m[1].split('}').pop()!.trim();
        expect(selector.startsWith('body'), `${v} declared on "${selector}"`).toBe(true);
      }
    }
  });

  it('keeps a named felt overriding all three, so a colour is one surface', () => {
    for (const felt of ['green', 'blue', 'wine', 'slate']) {
      const b = block(`body[data-felt='${felt}'] {`);
      expect(b, felt).toContain('--felt-base');
      expect(b, felt).toContain('--felt-glow');
      expect(b, felt).toContain('--felt-line');
    }
  });

  it('has no sleeve rules left — the picker is gone', () => {
    expect(css).not.toContain('data-sleeve');
    expect(css).not.toContain('--sleeve-color');
    expect(css).not.toContain('--sleeve-blend');
  });
});
