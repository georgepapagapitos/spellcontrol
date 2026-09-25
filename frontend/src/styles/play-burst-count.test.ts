/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const effects = readFileSync(join(here, 'play-effects.css'), 'utf8');
const board = readFileSync(join(here, 'play-board.css'), 'utf8');

/**
 * The running burst count ("-3") used to sit in normal flow beside the ±
 * glyph inside `.player-panel-step-btn`. That button is positioned by a
 * transform proportional to its OWN width (play-board.css: `translate(calc(
 * -100% - var(--life-half)), -50%)` for the − button, the mirror for +), so a
 * wide count (double digits, a -10 burst) widened the button and pushed the
 * whole thing further out — spilling it past the panel edge (measured with
 * life-board-probe.mjs's STEPS-OUTSIDE). Taking the count out of flow with
 * `position: absolute` keeps the button's own box at glyph size regardless of
 * the count, so the offset transform never moves.
 */
describe('burst count never widens the step button', () => {
  const ruleBody = (css: string, selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    return m?.[1] ?? null;
  };

  it('the count is taken out of flow', () => {
    const rule = ruleBody(effects, '.player-panel-step-count');
    expect(rule, '.player-panel-step-count is missing').toBeTruthy();
    expect(rule).toContain('position: absolute');
  });

  it('the button itself carries no flow-affecting gap from the count anymore', () => {
    // The button is still the positioning context for the ghost hit-area
    // (play-board.css) and the absolutely positioned count — confirmed by the
    // step button remaining `position: absolute` there.
    expect(board).toContain('.player-panel-life-wrap > .player-panel-step-btn {');
    const rule = board.slice(
      board.indexOf('.player-panel-life-wrap > .player-panel-step-btn {'),
      board.indexOf('\n}', board.indexOf('.player-panel-life-wrap > .player-panel-step-btn {'))
    );
    expect(rule).toContain('position: absolute');
  });

  it('the count anchors toward the numeral (inward), never toward the panel edge', () => {
    expect(effects).toContain('.player-panel-step-btn:first-of-type .player-panel-step-count {');
    expect(effects).toContain('.player-panel-step-btn:last-of-type .player-panel-step-count {');
    const first = ruleBody(
      effects,
      '.player-panel-step-btn:first-of-type .player-panel-step-count'
    );
    const last = ruleBody(effects, '.player-panel-step-btn:last-of-type .player-panel-step-count');
    // first-of-type (−) sits at the panel's left edge, translated further
    // left by its own width — so its count must grow rightward (inward).
    expect(first).toContain('left: 100%');
    // last-of-type (+) sits at the panel's right edge — its count must grow
    // leftward (inward).
    expect(last).toContain('right: 100%');
  });
});
