/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-counters-panel.css'), 'utf8');

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(m, `${selector} is missing`).toBeTruthy();
  return m![1];
};

/**
 * Commander-damage focus mode fixes (batch 2026-09-25):
 *
 * - The focused seat's own life numeral must stay clear of the focus bar at
 *   the player's edge, on every panel size — measured up to 100% coverage
 *   before this, on several presets. The bar is now a fixed-height, single
 *   -line strip (never wraps to eat the numeral above it), and the life-wrap
 *   it sits under is pulled in from that same edge by the bar's own height.
 * - The per-seat "⚔ dealt to <name>" caption is gone — it used to print over
 *   the panel's name on a short seat (300-900px², measured). Its meaning
 *   still lives in the panel's own aria-label (asserted in
 *   GameBoard.cmddmg.test.tsx), so this only pins that the CSS/markup for it
 *   was actually removed, not just hidden.
 */
describe('commander-damage focus: the bar never covers the numeral', () => {
  it('the caption class is gone entirely — its meaning moved to aria-label', () => {
    expect(css).not.toContain('pp-cmd-caption');
  });

  it('the focus bar is a fixed-height single line, never a wrapping paragraph', () => {
    const bar = ruleBody('.pp-cmd-focus-bar');
    expect(bar).toMatch(/flex-wrap:\s*nowrap/);
    expect(bar).toMatch(/min-height:\s*var\(--cmd-focus-bar-h/);
    const title = ruleBody('.pp-cmd-focus-title');
    expect(title).toMatch(/white-space:\s*nowrap/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("the self panel's life-wrap reserves exactly the bar's own height at the player's edge", () => {
    const wrap = ruleBody('.player-panel.is-cmd-self .player-panel-life-wrap');
    expect(wrap).toMatch(/bottom:\s*var\(--cmd-focus-bar-h\)/);
  });

  it('the reserved height is a real variable, not a guess that can silently drift from the bar', () => {
    const selfBase = ruleBody('.player-panel.is-cmd-self');
    expect(selfBase).toMatch(/--cmd-focus-bar-h:/);
    const bar = ruleBody('.pp-cmd-focus-bar');
    expect(bar).toContain('var(--cmd-focus-bar-h');
    const wrap = ruleBody('.player-panel.is-cmd-self .player-panel-life-wrap');
    expect(wrap).toContain('var(--cmd-focus-bar-h');
  });

  it('coarse pointers reserve more (the Return button takes the 44px floor there)', () => {
    const at = css.indexOf('--cmd-focus-bar-h: 3.75rem');
    expect(at, 'no coarse-pointer override for --cmd-focus-bar-h').toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
  });

  it('a partner (split) seat renders its own life IN FLOW, never as a corner overlay that can land on a step button', () => {
    // The non-split panel's life-chip is a separate absolutely-positioned
    // corner overlay (`.player-panel-counters`); a split panel's halves fill
    // most of the panel, so that same corner chip used to land on a half's
    // own − button (measured). The split-wrap's own child chip is in normal
    // flow instead.
    const splitChip = ruleBody('.pp-cmd-split-wrap > .pp-life-chip');
    expect(splitChip).toBeTruthy();
  });

  it('an upright self panel clears the name corner with a top inset, except the two shortest boards', () => {
    const wrap = ruleBody('.player-panel.is-cmd-self:not([data-sideways]) .player-panel-life-wrap');
    expect(wrap).toMatch(/top:\s*[\d.]+rem/);
    // A sideways panel's local top/bottom axis is its screen WIDTH, a
    // scarcer resource — the top inset is deliberately scoped out of it.
    expect(css).not.toMatch(/\.player-panel\.is-cmd-self\s*\.player-panel-life-wrap\s*\{\s*top:/);
  });

  it('8 and 10 players shrink the self numeral further — the top inset alone left a residual there', () => {
    const at = css.indexOf('.game-board-8 .player-panel.is-cmd-self');
    expect(at, 'no .game-board-8 is-cmd-self override').toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    expect(css.slice(at, close)).toMatch(/--life-scale:\s*0\.42/);
    // Same ratio already used for a 5/6-digit total (play-board.css) — a
    // floor this codebase already treats as legible.
    expect(css.slice(at, open)).toContain('.game-board-10 .player-panel.is-cmd-self');
  });
});
