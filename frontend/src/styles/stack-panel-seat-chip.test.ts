/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'playtest', 'components', 'StackPanel.css'), 'utf8');

/** The declarations of the first rule whose selector matches, whitespace collapsed. */
function rule(selector: string): string | null {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split('\n').pop()!.trim();
    if (sel === selector)
      return m[2]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim();
  }
  return null;
}

/**
 * E502: on the stack panel's text-bar rows (a card with no art, usually an
 * opponent's whose art is not cached), the seat chip was laid over the bar
 * and the bar reserved a 4.25rem left pad to clear it. The chip is sized by
 * the seat name, so the pad cleared "A player" and any real username ran
 * over the card name; the Token chip covered the other end the same way.
 *
 * The chips now sit in the row's own flow, on a line above the name. These
 * tests pin that structure, so a later "just widen the pad" fix fails here.
 * The art rows keep the chips over the card's top border, on purpose.
 */
describe('stack panel text-bar rows', () => {
  it('put the chips on their own line above the name, in the grid flow', () => {
    const card = rule('.stack-panel__card--bar') ?? '';
    expect(card).toMatch(/display: grid;/);
    expect(card).toMatch(/grid-template-areas: 'seat token' 'bar bar';/);
    expect(rule('.stack-panel__bar')).toMatch(/grid-area: bar;/);

    const seat = rule('.stack-panel__card--bar .stack-panel__seat') ?? '';
    expect(seat).toMatch(/position: static;/);
    expect(seat).toMatch(/grid-area: seat;/);
    const token = rule('.stack-panel__card--bar .stack-panel__token') ?? '';
    expect(token).toMatch(/position: static;/);
    expect(token).toMatch(/grid-area: token;/);
  });

  it('reserve no room for a chip: the bar pads with scale steps only', () => {
    const padding = /padding: ([^;]+);/.exec(rule('.stack-panel__bar') ?? '');
    expect(padding).not.toBeNull();
    expect(padding![1]).not.toMatch(/\d(?:px|rem|em)\b/);
    expect(padding![1]).toMatch(/^(?:var\(--space-[\d-]+\)\s*)+$/);
  });

  it('leave the art rows as they were: chips over the top border', () => {
    const seat = rule('.stack-panel__seat') ?? '';
    expect(seat).toMatch(/position: absolute; top: 0; left: 0;/);
    const token = rule('.stack-panel__token') ?? '';
    expect(token).toMatch(/position: absolute; top: 0; right: 0;/);
  });
});
