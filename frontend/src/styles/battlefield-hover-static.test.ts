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
  // cue has to carry contrast against card art in every theme, which is what
  // `--accent` is for — and it is what the hand fan already uses for the card
  // under the pointer.
  it('draws the cue in the accent colour', () => {
    const withoutAccent = hoverRules.filter((r) => !r.body.includes('var(--accent)'));
    expect(
      withoutAccent.map((r) => r.selector),
      'a battlefield hover cue must use var(--accent) — neutral border tokens vanish over card art on dark themes'
    ).toEqual([]);
  });
});
