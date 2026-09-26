/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-counters-panel.css'), 'utf8');

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchored at the start of a line, so `.pp-cmd-focus-bar` finds its own
  // rule and not a longer selector that merely ends in it.
  const m = new RegExp(`(?:^|\\n) *${escaped}\\s*\\{([^}]*)\\}`).exec(css);
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
    // ...and BELOW the halves: above them it sat on the seat's name on every
    // board (1075px² measured at 320-820px).
    const tsx = readFileSync(join(here, '..', 'components', 'play', 'GameBoard.tsx'), 'utf8');
    const wrap = tsx.indexOf('<div className="pp-cmd-split-wrap">');
    const halves = tsx.indexOf('<div className="pp-cmd-split-halves">', wrap);
    const chip = tsx.indexOf('<span className="pp-life-chip">', wrap);
    expect(halves).toBeGreaterThan(wrap);
    expect(chip).toBeGreaterThan(halves);
  });

  it('the focused seat hides its own name corner and designation chips instead of shrinking its numeral', () => {
    // The ruling: the focused player's own life stays readable while it
    // ticks down. The name, subtitle (both inside the corner) and the
    // designation rail give their space back; the bar says what the panel is.
    const at = css.indexOf(
      '.player-panel.is-cmd-self .player-panel-corner,\n.player-panel.is-cmd-self .pp-designation-chips {'
    );
    expect(at, 'the focused seat no longer hides its corner and chips').toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/display:\s*none/);
    // No blanket shrink on the focused seat: not the old 0.72, and not the
    // 0.42 that took a 10-player sideways seat's total from 38px to 16px.
    const selfBase = ruleBody('.player-panel.is-cmd-self');
    expect(selfBase).not.toContain('--life-scale');
    expect(css).not.toMatch(/is-cmd-self[^{]*\{[^}]*--life-scale:/);
    // And no top inset: nothing is left above the numeral to clear.
    expect(css).not.toMatch(/is-cmd-self[^{]*life-wrap\s*\{[^}]*\btop:/);
  });

  it("the focused total is capped to the box above the bar, in the panel's own axes", () => {
    // A cap only bites where the box is shorter than the tier's numeral
    // (2p-side's 148px sideways seats went 9% under the bar without it).
    const upright = ruleBody('.player-panel.is-cmd-self .player-panel-life');
    expect(upright).toMatch(
      /min\(\s*calc\(var\(--life-size\)[\s\S]*calc\(100cqh - var\(--cmd-focus-bar-h\)/
    );
    // Sideways: the panel's local height is the cell's WIDTH.
    const sideways = ruleBody('.player-panel.is-cmd-self[data-sideways] .player-panel-life');
    expect(sideways).toMatch(/calc\(100cqw - var\(--cmd-focus-bar-h\)/);
  });

  it('a narrow focused seat stacks the title above Return rather than cutting it to one letter', () => {
    for (const q of [
      '@container (max-height: 12rem) and (min-width: 8.5rem)',
      '@container (max-width: 12rem) and (min-height: 10rem)',
    ]) {
      const at = css.indexOf(q);
      expect(at, `${q} is missing`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf('\n  }\n', css.indexOf('flex-direction', at)));
      expect(body).toMatch(/--cmd-focus-bar-h:\s*[\d.]+rem/);
      expect(body).toMatch(/flex-direction:\s*column/);
    }
  });

  it("on touch a partner half's ± are hints: its own tap zones take the press", () => {
    // Same F2 ruling as the life numeral's ±: a live 44px circle over a zone
    // swallowed the long press (+1 instead of +10). Scoped through the row so
    // it beats play-board.css's `.player-panel-content button` auto.
    const at = css.indexOf('.pp-cmd-half-row > .pp-cmd-half-step {');
    expect(at, 'no coarse hint rule for the half steps').toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(
      css.lastIndexOf('.pp-cmd-half-step:focus-visible', at)
    );
    expect(ruleBody('.pp-cmd-half-row > .pp-cmd-half-step')).toMatch(/pointer-events:\s*none/);
    expect(ruleBody('.pp-cmd-half-row')).toMatch(/pointer-events:\s*none/);
  });

  it("a split seat's halves clear the name line it actually has, in every tier", () => {
    // A flat 1.6rem sat inside the name once the seam keep-out moved the
    // corner down; the 7-10 player tier's ~7px name needs far less.
    expect(ruleBody('.pp-cmd-split-wrap')).toMatch(
      /padding:\s*calc\(var\(--space-2\) \+ var\(--seam-keepout\) \+ (?:[\d.]+rem|var\(--space-\d\))\)/
    );
    const at = css.indexOf('.game-board:not(.game-board-2) .pp-cmd-split-wrap {');
    expect(at).toBeGreaterThan(-1);
    // Inside the 9.5rem tier's own block: no top-level rule closes between.
    const tier = css.lastIndexOf('@container (max-height: 9.5rem)', at);
    expect(tier).toBeGreaterThan(-1);
    expect(css.slice(tier, at)).not.toMatch(/\n\}/);
  });

  it('partner halves stack when the seat is too narrow for them side by side', () => {
    expect(ruleBody('.pp-cmd-split-wrap')).toMatch(/container:\s*cmd-split\s*\/\s*size/);
    const at = css.indexOf('@container cmd-split (max-width: 11rem)');
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf('\n}\n', at))).toMatch(/grid-template-columns:\s*1fr;/);
  });

  it('the title says "Commander damage" — truncates via CSS, doesn\'t reword the copy', () => {
    // The bar's fixed height comes from `.pp-cmd-focus-title` staying single-
    // line + ellipsis (already asserted above), not from shortening the copy
    // itself — "Commander damage" is the word that carries the mode's
    // meaning to whoever reads a truncated title.
    const gameBoardTsx = readFileSync(
      join(here, '..', 'components', 'play', 'GameBoard.tsx'),
      'utf8'
    );
    expect(gameBoardTsx).toContain('Commander damage received');
  });

  it('the Return pill carries the hub\'s own "Return to game" copy, with a narrow-panel-only short fallback', () => {
    // Full copy shown by default; the short span is opt-in via a container
    // query, not the default — same thresholds the drawer/keypad already use.
    const short = ruleBody('.pp-cmd-focus-done-short');
    expect(short).toMatch(/display:\s*none/);
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const start = css.indexOf(`@container (${query})`);
      expect(start, `@container (${query}) is missing for the Return pill`).toBeGreaterThan(-1);
      const end = css.indexOf('\n}\n', start);
      const block = css.slice(start, end);
      expect(block).toContain('.pp-cmd-focus-done-full');
      expect(block).toMatch(/\.pp-cmd-focus-done-full\s*\{\s*display:\s*none;/);
      expect(block).toMatch(/\.pp-cmd-focus-done-short\s*\{\s*display:\s*inline;/);
    }
  });
});
