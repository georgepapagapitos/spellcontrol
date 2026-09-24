/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'playtest.css'), 'utf8');

/**
 * A battlefield card must not MOVE when the cursor passes over it.
 *
 * The hand is a fan: a card lifting out of the strip on hover reads as "this
 * one", and nothing else depends on where it sits. The battlefield is not —
 * position there is information the player put there by hand, cards are read
 * against the row or stack they were placed in, and things are attached to and
 * tapped on top of them. `.playtest-battlefield .playtest-card:hover` shipped
 * with `translate: 0 -6px` copied from the opening-hand card, so every pass of
 * the cursor across a dense board made it twitch and broke the alignment the
 * player was reading.
 *
 * The cue is now a ring plus a shadow — visible, and static. This guard is not
 * a check on one declaration: it reads every hover rule in the sheet that can
 * match a card on the battlefield and fails if any of them sets a property
 * that displaces the element.
 */

/** Properties that move an element rather than decorate it. */
const DISPLACING = [
  'translate',
  'transform',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'margin',
  'scale',
  'rotate',
];

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
      // Collect this block's own declarations, skipping any nested block.
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

/**
 * Selectors that can match a card sitting on the battlefield while hovered.
 * Deliberately loose on the left of `.playtest-card` so a rule written as
 * `.playtest-board .playtest-battlefield .playtest-card:hover` is caught too.
 */
function isBattlefieldCardHover(selector: string): boolean {
  return selector
    .split(',')
    .some(
      (part) =>
        part.includes('.playtest-battlefield') &&
        part.includes('.playtest-card') &&
        part.includes(':hover')
    );
}

describe('battlefield cards do not move on hover', () => {
  const hoverRules = rules(css).filter((r) => isBattlefieldCardHover(r.selector));

  it('has a hover cue on the battlefield at all', () => {
    // If this fails the rule was deleted rather than made static, and a
    // battlefield card now gives no feedback under the cursor.
    expect(hoverRules.length).toBeGreaterThan(0);
  });

  it.each(DISPLACING)('does not set `%s` on hover', (prop) => {
    const offenders = hoverRules.filter((r) => new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(r.body));
    expect(
      offenders.map((r) => r.selector),
      `\`${prop}\` displaces a battlefield card under the cursor — use a ring or shadow instead`
    ).toEqual([]);
  });

  // The first cut of this fix used an inset `--border-strong` ring. It passed
  // every check above and was invisible on screen: on a dark theme that token
  // is a dark navy, drawn on top of a card's own black border, over art. The
  // second used `--accent`, which is visible but is a different colour in
  // every theme — and the board has a SECOND ring to tell apart, the gold one
  // a selected card wears, which an accent near it in some themes blurs into.
  //
  // So the cue is `--pt-ring-hover`: one fixed colour (EDHPlay's cyan) that
  // carries over card art in every theme and can never drift into the
  // selection's gold. A neutral border token or a raw hex here is the
  // regression this guards.
  it('draws the cue in the fixed hover-ring colour', () => {
    const wrongColour = hoverRules.filter((r) => !r.body.includes('var(--pt-ring-hover)'));
    expect(
      wrongColour.map((r) => r.selector),
      'a battlefield hover cue must use var(--pt-ring-hover) — neutral tokens vanish over card art, and a themed one can collide with the selection ring'
    ).toEqual([]);
  });

  // The other half of the pair: if the two rings ever resolve to the same
  // token, "under the cursor" and "selected" stop being two states.
  it('keeps the selection ring a different colour from the hover ring', () => {
    const selected = rules(css).find((r) => r.selector === '.playtest-card--selected');
    expect(selected, '.playtest-card--selected went missing').toBeTruthy();
    expect(selected?.body).toContain('var(--pt-ring-selected)');
    expect(selected?.body).not.toContain('var(--pt-ring-hover)');
  });
});

/**
 * Nor on a press. A card is `role="button"`, so base-layout.css's pressed
 * floor (`:where(button, [role='button']):active { transform: translateY(1px) }`)
 * nudged it down and back on every click, left or right. Measured in a real
 * window: y 505.64 → 506.64 over the press, back on release, on every card.
 */
describe('cards do not move on press', () => {
  it('cancels the baseline press nudge on every card', () => {
    const active = rules(css).find((r) => r.selector === '.playtest-card:active');
    expect(active, '.playtest-card:active went missing').toBeTruthy();
    expect(active?.body).toMatch(/(^|[;\s])transform:\s*none/);
  });

  // A right-click only opens the menu; a closed hand on it read as a grab.
  // The drag copy (`--dragging`) carries the grabbing cursor for a real drag.
  it('leaves the grabbing cursor to an actual drag', () => {
    const active = rules(css).find((r) => r.selector === '.playtest-card:active');
    expect(active?.body).not.toMatch(/cursor:\s*grabbing/);
    const dragging = rules(css).find((r) => r.selector === '.playtest-card--dragging');
    expect(dragging?.body).toMatch(/cursor:\s*grabbing/);
  });
});

/**
 * Nor when a card takes focus. `overflow: hidden` still makes a scroll
 * container, and the browser scrolls one to reveal whatever gets focus: Tab
 * onto a hand card tucked below the table's edge scrolled the battlefield
 * wrap ~50px, and with no scrollbar nothing could scroll it back, so the
 * whole table stayed shifted up. `clip` clips the same and cannot scroll.
 */
describe('the table does not scroll to reveal a focused card', () => {
  it.each(['.playtest-page', '.playtest-battlefield-wrap'])('%s clips rather than hides', (sel) => {
    // Every rule for it, media-query overrides included.
    const all = rules(css).filter((r) => r.selector === sel);
    expect(all.some((r) => /overflow:\s*clip/.test(r.body))).toBe(true);
    expect(
      all.filter((r) => /overflow(-[xy])?:\s*(hidden|auto|scroll)/.test(r.body)).map((r) => r.body)
    ).toEqual([]);
  });
});
