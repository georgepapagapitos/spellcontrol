/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Vertical tap areas (`game.tapOrientation === 'vertical'`) make the top half
 * of a seat +1 and the bottom half −1. The ± hints used to stay beside the
 * numeral, so the "+" sat on the zone boundary and a real long press on it
 * gave −10 on every 0° and 270° seat (4p-sides seats 1-2, 2p-stacked seat 1,
 * 3p-wide-top-sides seat 1). The hints follow the zones: + above the numeral,
 * − below, in the seat's own axes, and a partner half's pair sits one per
 * zone. Measured by real touch (a long press on each visible glyph) on
 * 2p/3p/4p/10p boards at 320 and 390: every glyph gives its own sign.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

/** The body of the first `{...}` block whose selector text contains `needle`. */
function block(css: string, needle: string): string {
  const at = css.indexOf(needle);
  expect(at, `"${needle}" is missing`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('vertical tap areas: the life numeral', () => {
  const css = read('play-board.css');
  const STEP = '.player-panel.is-vertical-taps .player-panel-life-wrap > .player-panel-step-btn';

  it('centres both hints on the numeral axis', () => {
    const b = block(css, `${STEP} {`);
    expect(b).toMatch(/left:\s*50%/);
    expect(b).toMatch(/right:\s*auto/);
  });

  it('puts the − wholly below the numeral and the + wholly above it', () => {
    expect(block(css, `${STEP}:first-of-type {`)).toMatch(
      /transform:\s*translate\(-50%,\s*var\(--life-vhalf\)\)/
    );
    expect(block(css, `${STEP}:last-of-type {`)).toMatch(
      /transform:\s*translate\(-50%,\s*calc\(-100% - var\(--life-vhalf\)\)\)/
    );
  });

  it('keeps the stack clear of the name corner and inside the seat', () => {
    // Centred in the box below the name band, sized so the stack fits it.
    expect(block(css, '.player-panel.is-vertical-taps .player-panel-life-wrap {')).toMatch(
      /top:\s*var\(--pp-v-top\)/
    );
    expect(block(css, '.player-panel.is-vertical-taps {')).toMatch(
      /--life-v:\s*min\(var\(--life-size\),\s*calc\(\(100cqh - var\(--pp-v-top\) - var\(--pp-v-bottom\)\)/
    );
    // A sideways panel's own height is its cell's width.
    expect(block(css, '.player-panel.is-vertical-taps[data-sideways] {')).toMatch(/100cqw/);
  });
});

describe('vertical tap areas: commander damage', () => {
  const css = read('play-counters-panel.css');

  it("turns a partner half's zones to top (+) and bottom (−)", () => {
    expect(block(css, '.is-vertical-taps .pp-cmd-half-zone.is-plus {')).toMatch(/top:\s*0/);
    expect(block(css, '.is-vertical-taps .pp-cmd-half-zone.is-minus {')).toMatch(/bottom:\s*0/);
  });

  it("centres each of a half's hints in its own zone", () => {
    expect(block(css, '.is-vertical-taps .pp-cmd-half-row > .pp-cmd-half-step {')).toMatch(
      /top:\s*75%/
    );
    expect(
      block(css, '.is-vertical-taps .pp-cmd-half-row > .pp-cmd-half-step:last-child {')
    ).toMatch(/top:\s*25%/);
  });

  it('moves "N to lethal" below the − and reserves its line', () => {
    const b = block(
      css,
      '.game-board .player-panel.is-vertical-taps.is-cmd-source:not(.is-cmd-split) {'
    );
    expect(b).toMatch(/--pp-v-bottom:/);
    expect(b).toMatch(/--cmd-offset:\s*calc\(var\(--life-v\)/);
  });
});
