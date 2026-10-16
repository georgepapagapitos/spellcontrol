/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The turn control that follows the turn (2026-10-16 clock-position ruling).
 * On the `seat` and `hub` positions the active seat carries its own "End turn"
 * bar (or chip) inside its panel. It has to fit the smallest seat (a 6-player
 * board at 320px is 148px across), keep a 44px target on a touch screen,
 * never sit on the life numeral, and size itself from the SEAT, not the
 * viewport: under "keep the board still" the board's width is not the
 * screen's, and a seat's width is neither.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(dir, 'play-enhancements.css'), 'utf8');
const menus = readFileSync(join(dir, 'play-panel-menus.css'), 'utf8');
const start = css.indexOf('The turn control that follows the turn');
const turn = css.slice(start, css.indexOf('Low-life warning', start));

function block(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`);
  expect(at, `${selector} not found`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at));
}

describe('the turn bar sizes from its seat, never the viewport', () => {
  it('the bar wrapper is its own inline-size container', () => {
    expect(block(turn, '.pp-turn-bar-wrap.is-bar')).toMatch(
      /container:\s*pp-turn-bar \/ inline-size/
    );
  });

  it('a narrow seat drops the words and keeps the time and chevron', () => {
    // 9.5rem = 152px: 6p at 320px is 148px across, so the compact form fires
    // exactly there and a 4p seat (183px+) keeps its words.
    const at = turn.indexOf('@container pp-turn-bar (max-width: 9.5rem)');
    expect(at).toBeGreaterThan(-1);
    const tier = turn.slice(at, turn.indexOf('\n}\n', at));
    expect(tier).toMatch(/\.pp-turn-bar-label\s*\{\s*display:\s*none/);
  });

  it('uses no viewport query for per-seat sizing', () => {
    expect(turn).not.toMatch(/@media\s*\((min|max)-(width|height)/);
  });
});

describe('the turn bar is a real target and stays off the numeral', () => {
  it('the bar is the 44px target on a coarse pointer', () => {
    const at = turn.indexOf('@media (pointer: coarse) {\n  .player-panel.has-turn-bar');
    expect(at).toBeGreaterThan(-1);
    expect(turn.slice(at, turn.indexOf('\n}\n', at))).toMatch(/--turn-bar-h:\s*2\.75rem/);
    expect(block(turn, '.pp-turn-bar.is-bar')).toMatch(/min-height:\s*var\(--turn-bar-h\)/);
  });

  it('the compact chip is 32px to look and reaches 44px with a ghost on a coarse pointer', () => {
    const chip = block(turn, '.pp-turn-bar.is-chip');
    const look = parseFloat(chip.match(/min-height:\s*([\d.]+)rem/)![1]);
    const ghostAt = turn.indexOf('button.pp-turn-bar.is-chip::before');
    expect(ghostAt).toBeGreaterThan(-1);
    const ghost = turn.slice(ghostAt, turn.indexOf('}', ghostAt));
    const inset = parseFloat(ghost.match(/inset:\s*-([\d.]+)rem/)![1]);
    expect(look + 2 * inset).toBeGreaterThanOrEqual(2.75);
    expect(turn.lastIndexOf('@media (pointer: coarse)', ghostAt)).toBeGreaterThan(-1);
  });

  it('reserves its height off the numeral, the counter badges and the vertical-tap stack', () => {
    expect(block(turn, '.player-panel.has-turn-control .player-panel-life-wrap')).toMatch(
      /bottom:\s*var\(--turn-bar-h\)/
    );
    expect(block(turn, '.player-panel.has-turn-control .player-panel-counters')).toMatch(
      /bottom:\s*calc\(var\(--space-2\) \+ var\(--turn-bar-h\)\)/
    );
    expect(block(turn, '.player-panel.has-turn-control.is-vertical-taps')).toMatch(
      /--pp-v-bottom:\s*var\(--turn-bar-h\)/
    );
  });

  it('caps the numeral on its own axis: the cell height upright, its width sideways', () => {
    expect(block(turn, '.player-panel.has-turn-control .player-panel-life')).toContain(
      '100cqh - var(--turn-bar-h)'
    );
    expect(block(turn, '.player-panel.has-turn-control[data-sideways] .player-panel-life')).toMatch(
      /100cqw - var\(--turn-bar-h\) \* 1\.5/
    );
  });

  it('a sideways seat gives up half a bar at its far edge, so the numeral does not crowd the hub', () => {
    expect(
      block(turn, '.player-panel.has-turn-control[data-sideways] .player-panel-life-wrap')
    ).toMatch(/top:\s*calc\(var\(--turn-bar-h\) \/ 2\)/);
  });
});

describe('the turn bar is a rectangle and moves politely', () => {
  it('its call to action is a rect, not a pill (STYLE_GUIDE shape language)', () => {
    expect(block(turn, '.pp-turn-bar.is-bar .pp-turn-bar-cta')).toMatch(
      /border-radius:\s*var\(--radius\)/
    );
    expect(block(turn, '.pp-turn-bar.is-chip')).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(turn).not.toMatch(/border-radius:\s*999px/);
  });

  it('the arrival animation is gated on no-preference, so reduced motion places it still', () => {
    const at = turn.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(at).toBeGreaterThan(-1);
    expect(turn.slice(at, turn.indexOf('\n}\n', at))).toContain('animation: pp-turn-bar-in');
  });
});

describe('the top-edge variant (an unrotated board whose hub sits on the seat bottom)', () => {
  it('moves the wrapper, the numeral box and the name/chips down together', () => {
    expect(block(turn, '.pp-turn-bar-wrap.is-top-edge')).toMatch(/top:\s*0/);
    expect(
      block(turn, '.player-panel.has-turn-control.has-turn-top .player-panel-life-wrap')
    ).toMatch(/top:\s*var\(--turn-bar-h\)/);
    expect(turn).toMatch(
      /has-turn-top \.player-panel-corner,\s*\.player-panel\.has-turn-control\.has-turn-top \.pp-designation-chips\s*\{\s*margin-top:\s*var\(--turn-bar-h\)/
    );
    expect(
      block(turn, '.player-panel.has-turn-control.has-turn-top .player-panel-counters')
    ).toMatch(/bottom:\s*var\(--space-2\)/);
  });
});

describe('the hub that carries the game total', () => {
  it('is a stamped rect, not a circle, with tabular figures', () => {
    const hub = block(menus, '.game-board-menu-btn.has-time');
    expect(hub).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(hub).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('stacks into a narrow column on a column seam, so it never reaches over a seat numeral', () => {
    const stacked = block(menus, '.game-board-menu-btn.has-time.is-stacked');
    expect(stacked).toMatch(/flex-direction:\s*column/);
  });

  it('keeps the 44px floor on a coarse pointer', () => {
    const at = menus.indexOf('.game-board-menu-btn.has-time {\n    min-width: 2.75rem');
    expect(at).toBeGreaterThan(-1);
    expect(menus.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
  });
});

describe('the top edge strip', () => {
  it('turns the strip to face the far side and moves its gap to the grid side', () => {
    const top = block(css, '.game-clock-strip.is-top');
    expect(top).toMatch(/transform:\s*rotate\(180deg\)/);
    expect(top).toMatch(/margin-top:\s*0/);
    expect(top).toMatch(/margin-bottom:\s*var\(--space-2\)/);
  });
});
