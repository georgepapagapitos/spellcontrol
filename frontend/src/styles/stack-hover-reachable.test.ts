/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-list.css'), 'utf8');

/**
 * In the stacks view a card must not become unreachable because its neighbour
 * is open, and the opening has to read as the stack moving OFF that card.
 *
 * The column overlaps its tiles so only each card's name strip shows, and the
 * card under the cursor opens to full size. Three cuts got this wrong, each by
 * reaching for the obvious rule, so each one is pinned here:
 *
 *  1. Opening by z-order alone. The open card then covered the strips of the
 *     four or five cards below it, and the only way to reach one of those was
 *     to leave the stack entirely and re-enter from underneath.
 *  2. Pushing the tail by animating `margin-top` on the tile directly after
 *     the open one. The overlap is where a card LIVES in the stack: animating
 *     it re-lays-out the deck every frame (the growing column shoved every
 *     later column of the wrapped row down, a frame at a time), and it moves
 *     the tail by reflowing the card in front of it rather than by moving each
 *     card, so the cards never travel from their own place in the stack.
 *  3. Lifting the open card over its neighbours with `z-index`. It then paints
 *     whole on the first frame and the tail slides out from under it, which is
 *     the card popping in rather than the stack moving. Left in DOM order, the
 *     tail slides across its face and uncovers it top to bottom.
 *
 * What survives: a static overlap, and `transform: translateY(--stack-open)` on
 * every following sibling (`~`) so the whole tail travels as one stack, for
 * both ways a card opens (pointer and keyboard).
 */

type Rule = { selector: string; body: string };

/** Every style rule in the sheet, flattened out of any at-rule nesting. */
function rules(sheet: string): Rule[] {
  const stripped = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let head = '';
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      const selector = head.trim();
      head = '';
      if (selector.startsWith('@')) continue;
      let depth = 1;
      let body = '';
      let j = i + 1;
      while (j < stripped.length && depth > 0) {
        if (stripped[j] === '{') depth++;
        else if (stripped[j] === '}') depth--;
        if (depth > 0) body += stripped[j];
        j++;
      }
      out.push({ selector, body });
    } else if (ch === '}') {
      head = '';
    } else {
      head += ch;
    }
  }
  return out;
}

const all = rules(css);
const stack = all.filter((r) => r.selector.includes('.deck-card-stack'));

/**
 * The rules that displace the cards below the open one, per opening state.
 * Keyed on the selector ENDING at a cell: the column's own reservation rule
 * also names a following sibling, but it targets the list, not the cards.
 */
function tailRules(state: 'hover' | 'focus'): Rule[] {
  return stack.filter(
    (r) =>
      r.selector.includes('~') &&
      r.selector.trim().endsWith('.deck-card-grid-cell') &&
      (state === 'hover' ? r.selector.includes(':hover') : r.selector.includes('focus'))
  );
}

describe('stacks view keeps buried cards reachable', () => {
  it('overlaps the tiles at rest, as static layout', () => {
    // If this goes, the stack is a plain column and the rest of the file's
    // geometry (the peek strip, the qty pip shrink) is dead weight.
    const rest = stack.filter(
      (r) =>
        r.selector.includes('+') &&
        !r.selector.includes(':hover') &&
        !r.selector.includes('focus') &&
        /(^|[;{\s])margin-top\s*:/.test(r.body)
    );
    expect(rest.length, 'the stack no longer overlaps its tiles').toBeGreaterThan(0);
    expect(rest.some((r) => r.body.includes('var(--stack-card-h)'))).toBe(true);
    for (const r of rest) {
      expect(
        r.body,
        'the overlap must never animate. Transition `transform` on the cell instead'
      ).not.toMatch(/transition/);
    }
  });

  it('slides the whole tail below the open card, not just the next one', () => {
    for (const state of ['hover', 'focus'] as const) {
      const tail = tailRules(state);
      expect(
        tail.map((r) => r.selector),
        `nothing moves the cards below the card opened by ${state}`
      ).not.toEqual([]);
      for (const r of tail) {
        expect(r.body).toMatch(/transform\s*:\s*translateY\(var\(--stack-open\)\)/);
      }
    }
    // A `+` displacement moves the tail by reflowing the card in front of it,
    // so the cards do not travel from their own place in the stack.
    const nextOnly = stack.filter(
      (r) => /(:hover|focus)[^,{]*\+/.test(r.selector) && /margin|transform/.test(r.body)
    );
    expect(
      nextOnly.map((r) => r.selector),
      'displace every following sibling (`~`), not just the next one (`+`)'
    ).toEqual([]);
  });

  it('opens on the keyboard the same way, and only for :focus-visible', () => {
    for (const r of tailRules('focus')) {
      // Plain :focus would leave the column parted after a click, with the
      // cursor long gone and nothing visibly focused.
      expect(r.selector).toContain(':focus-visible');
    }
  });

  it('travels on a transform the cards can be composited on', () => {
    const cell = all.find((r) => r.selector.trim() === '.deck-card-stack .deck-card-grid-cell');
    expect(cell?.body, 'the stacked cell rule went missing').toBeTruthy();
    // Every card carries the same duration and curve, so the tail keeps its
    // overlap exactly and arrives as one block of cards.
    expect(cell?.body).toMatch(/transition\s*:\s*transform\s+var\(--motion-\w+\)\s+var\(--ease-/);
    expect(
      all.find((r) => r.selector.trim() === '.deck-grid-section--stack')?.body,
      'the travel distance is the card minus the strip it already shows'
    ).toMatch(/--stack-open:\s*calc\(var\(--stack-card-h\) - var\(--stack-peek\)\)/);
  });

  it('reserves the room the tail slides into, on the column and in one step', () => {
    // The section draws a surface and a border, so a card that overflowed it
    // would sit outside its own column; and the reservation cannot be animated,
    // because that is the per-frame layout this rewrite exists to remove.
    const reserves = stack.filter((r) => /padding-bottom:\s*var\(--stack-open\)/.test(r.body));
    expect(
      reserves.map((r) => r.selector),
      'nothing reserves the room'
    ).not.toEqual([]);
    for (const r of reserves) {
      expect(
        r.selector,
        'reserve on the COLUMN, which is the box the cards would otherwise overflow'
      ).toMatch(/\.deck-grid-section--stack:has\(/);
      // A one-card stack, and the last card of any stack, move nothing. Keying
      // the reserve off the column being hovered left those sitting under an
      // empty half-column of surface, which is what the user saw first.
      expect(
        r.selector,
        'reserve only when the open card HAS a tail: `:has(<open> ~ <cell>)`'
      ).toMatch(/~\s*\.deck-card-grid-cell/);
      // The reservation is NOT allowed to be a single step. Released on a
      // delay, the box holds its full height for a slide after the cards are
      // home and the stack sits above an empty half-column of surface;
      // released at once, the returning cards spill out of the panel.
      expect(
        r.body,
        'the reservation must not be released in one step — it has to track the tail'
      ).not.toMatch(/transition[^;]*padding-bottom\s+0s/);
    }
    // The column's floor rides the same duration and curve as the cards, so it
    // tracks the tail exactly instead of snapping before or after it. This is
    // not the reflow-per-frame mistake the header describes: that one animated
    // `margin-top` on a CARD and moved the cards themselves by layout. These
    // cards are on transforms throughout; only the box they sit in animates.
    expect(
      all
        .filter((r) => r.selector.trim() === '.deck-card-stack')
        .some((r) =>
          /transition:\s*padding-bottom\s+var\(--motion-gentle\)\s+var\(--ease-drawer\)/.test(
            r.body
          )
        ),
      'the reserved room must animate on the same pair as the cards it makes room for'
    ).toBe(true);
  });

  it('keeps every card chrome inside that card', () => {
    // A buried tile is still a full card tall behind the cards stacked on it,
    // and its badge cluster (z-index: 2) and kebab (z-index: 3) sit at that
    // full card's edges, deep inside whatever card is in front. Without a
    // stacking context per cell those z-indexes resolve against the whole
    // column, and every buried card's icons punch through the open card's art
    // in a ragged line down its right-hand side.
    const cell = all.find((r) => r.selector.trim() === '.deck-card-stack .deck-card-grid-cell');
    expect(
      cell?.body,
      'a stacked cell must isolate, or a buried card badge paints over the open card'
    ).toMatch(/isolation\s*:\s*isolate/);
  });

  it('never paints the open card over the tail sliding off it', () => {
    // The reveal IS the tail sliding across the card's face. Lifting the card
    // instead shows it whole on the first frame, which reads as a pop.
    const lifts = stack.filter(
      (r) => /:(hover|focus)/.test(r.selector) && /z-index\s*:\s*[1-9]/.test(r.body)
    );
    expect(
      lifts.map((r) => r.selector),
      'z-index on an opening stack card makes it pop in whole; DOM order is the reveal'
    ).toEqual([]);
  });

  it('never moves the card the cursor is already on', () => {
    // The cursor sits in the exposed top strip of the card it opens. Leaving
    // that card exactly where it lives in the stack keeps it there; displacing
    // it would slide the card out from under the pointer and flicker.
    const active = stack.filter(
      (r) => /:hover\s*(,|$)/.test(r.selector.trim()) && !/[+~]/.test(r.selector)
    );
    for (const r of active) {
      expect(r.body, `${r.selector} displaces the card the cursor is already on`).not.toMatch(
        /(^|[;{\s])(transform|translate|scale|top|bottom|margin)\s*:/
      );
    }
  });
});
