/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'deck-builder-card-list.css'), 'utf8');

/**
 * In the stacks view a card must not become unreachable because its neighbour
 * is open.
 *
 * The column overlaps its tiles so only each card's name strip shows, and the
 * card under the cursor opens to full size. The first cut opened it by z-order
 * alone: the open card then covered the strips of the four or five cards below
 * it, and the only way to reach one of those was to leave the stack entirely
 * and re-enter from underneath. Archidekt pushes the rest of the column down
 * instead, which keeps every strip on screen.
 *
 * The push is one declaration — the tile directly after the open one drops its
 * negative margin, and the tail travels down with it — so this guard checks
 * that the declaration exists for BOTH ways a card opens (pointer and
 * keyboard), and that the overlap it cancels is still there to cancel.
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

/** Rules that set the stacked tile's own margin-top, in any state. */
function marginRules(match: (selector: string) => boolean): Rule[] {
  return all.filter(
    (r) =>
      r.selector.includes('.deck-card-stack') &&
      match(r.selector) &&
      /(^|[;{\s])margin-top\s*:/.test(r.body)
  );
}

describe('stacks view keeps buried cards reachable', () => {
  it('still overlaps the tiles at rest', () => {
    // If this goes, the stack is a plain column and the rest of the file's
    // geometry (the peek strip, the qty pip shrink) is dead weight.
    const rest = marginRules(
      (s) => s.includes('+') && !s.includes(':hover') && !s.includes('focus')
    );
    expect(rest.length, 'the stack no longer overlaps its tiles').toBeGreaterThan(0);
    expect(rest.some((r) => r.body.includes('var(--stack-card-h)'))).toBe(true);
  });

  it('pushes the column down when a card opens under the cursor', () => {
    const pushed = marginRules((s) => s.includes(':hover') && s.includes('+'));
    expect(
      pushed.map((r) => r.selector),
      'a hovered stack tile must push its following sibling down — z-index alone buries the cards under it'
    ).not.toEqual([]);
    for (const r of pushed) expect(r.body).toMatch(/margin-top\s*:\s*0/);
  });

  it('pushes it down for keyboard focus too', () => {
    const pushed = marginRules((s) => s.includes('focus') && s.includes('+'));
    expect(
      pushed.map((r) => r.selector),
      'tabbing through a stack must open a card the same way hovering does'
    ).not.toEqual([]);
    for (const r of pushed) {
      expect(r.body).toMatch(/margin-top\s*:\s*0/);
      // Plain :focus would leave the column parted after a click, with the
      // cursor long gone and nothing visibly focused.
      expect(r.selector).toContain(':focus-visible');
    }
  });

  it("keeps each card's own chrome inside that card", () => {
    // A buried tile is still a full card tall behind the cards stacked on it,
    // and its badge cluster (z-index: 2) and kebab (z-index: 3) sit at that
    // full card's edges — deep inside whatever card is in front. Without a
    // stacking context per cell those z-indexes resolve against the whole
    // column, and every buried card's icons punch through the open card's art
    // in a ragged line down its right-hand side.
    const cell = all.find((r) => r.selector.trim() === '.deck-card-stack .deck-card-grid-cell');
    expect(cell?.body, 'the stacked cell rule went missing').toBeTruthy();
    expect(
      cell?.body,
      'a stacked cell must isolate, or a buried card’s badges paint over the open card'
    ).toMatch(/isolation\s*:\s*isolate/);
  });

  it('lifts the open card by the cell, not by something inside it', () => {
    // The corollary of isolating: a z-index raised on the tile can no longer
    // lift the card it belongs to, so the lift has to be on the cell itself.
    const lifts = all.filter(
      (r) => r.selector.includes('.deck-card-stack') && /z-index\s*:\s*[1-9]/.test(r.body)
    );
    expect(lifts.length, 'nothing lifts the open card over its neighbours').toBeGreaterThan(0);
    const onTile = lifts.filter((r) => r.selector.includes('.deck-card-grid-tile'));
    expect(
      onTile.map((r) => r.selector),
      'an isolated cell contains its children — lift .deck-card-grid-cell instead'
    ).toEqual([]);
  });

  it('opens the card downward, never by moving it under the cursor', () => {
    // The cursor sits in the exposed top strip of the card it opens. Growing
    // downward keeps it there; a transform or a negative margin on the OPEN
    // tile would slide the card out from under the pointer and flicker.
    const active = all.filter(
      (r) =>
        r.selector.includes('.deck-card-stack') &&
        /:hover\s*(,|\{|$)/.test(`${r.selector}{`) &&
        !r.selector.includes('+')
    );
    for (const r of active) {
      expect(r.body, `${r.selector} displaces the card the cursor is already on`).not.toMatch(
        /(^|[;{\s])(transform|translate|scale|top|bottom|margin)\s*:/
      );
    }
  });
});
