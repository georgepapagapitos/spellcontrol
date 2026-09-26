// @vitest-environment happy-dom
/**
 * B7-02: `.seat-menu-body` can genuinely overflow the panel (worst case: a
 * 2-player game, the largest panel size) — it must publish which edge(s)
 * still have content behind them, mirroring Tabs.tsx's `data-overflow`
 * scroll-edge-fade convention (there horizontal, here vertical).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGameState, makePlayer } from '../../lib/game-state';
import { SeatMenu } from './SeatMenu';

function makeGame() {
  const state = createGameState({
    id: 'game-test',
    code: 'ABCD',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players: [
      makePlayer({ id: 'p0', userId: null, seat: 0, name: 'Alice', startingLife: 40 }),
      makePlayer({ id: 'p1', userId: null, seat: 1, name: 'Bob', startingLife: 40 }),
    ],
  });
  // 'active' (not the createGameState default 'lobby') so the in-play quick
  // actions (Commander damage / Start turn / Monarch / Initiative) render —
  // the compact-row tests below assert every one of them is reachable.
  return { ...state, status: 'active' as const };
}

/**
 * Compact row (a short seat, Lotus's model): CSS switches `.seat-menu-body`
 * into one horizontally scrolling row on a short seat and shows every
 * section inline on a tall one, but the underlying markup and the
 * `activeEditor` state machine are the SAME either way — jsdom doesn't
 * evaluate container queries, so these assert the plumbing CSS depends on:
 * every action/section is reachable in the DOM regardless of seat size, and
 * tapping a trigger swaps `data-active-editor` (what the container queries
 * key off) rather than actually removing anything from the tree.
 */
describe('SeatMenu — compact row plumbing', () => {
  it('every action, counter, and section trigger is reachable in the DOM', () => {
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        onCommanderDamage={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    // Quick actions (icon-over-label in compact mode, same buttons either way).
    for (const label of [/Commander damage/, /Start turn here/, /Monarch/, /Initiative/, /Out/]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    // The four section triggers that swap the row for one editor on a short seat.
    for (const label of ['Name', 'Partner', 'Color', 'Facing']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    // Poison counter's stepper is present too (game has poisonEnabled: true by default).
    expect(screen.getByRole('button', { name: '-1 ☠ Poison' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+1 ☠ Poison' })).toBeTruthy();
  });

  it('a section trigger swaps the row for that editor; Back returns to it', () => {
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    const body = document.querySelector('.seat-menu-body')!;
    expect(body.getAttribute('data-active-editor')).toBeNull();
    expect(screen.queryByRole('button', { name: '‹ Back' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(body.getAttribute('data-active-editor')).toBe('name');
    const nameEditor = document.querySelector('.seat-menu-editor[data-editor="name"]')!;
    expect(nameEditor).toBeTruthy();
    const back = screen.getByRole('button', { name: '‹ Back' });
    expect(back).toBeTruthy();

    fireEvent.click(back);
    expect(body.getAttribute('data-active-editor')).toBeNull();
    expect(screen.queryByRole('button', { name: '‹ Back' })).toBeNull();
  });

  it('the "+ Counter" trigger swaps the row for the add-counter form', () => {
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    const body = document.querySelector('.seat-menu-body')!;
    expect(body.getAttribute('data-active-editor')).toBe('counter');
    expect(
      document.querySelector('.seat-menu-editor[data-editor="counter"] .pp-counters-add')
    ).toBeTruthy();
  });

  it('a tall seat never opens an editor by construction — CSS shows every section without a trigger tap', () => {
    // Regression guard for the state machine itself, not the CSS: a tall
    // seat's sections are visible without ever setting activeEditor, so the
    // markup for every editor exists whether or not a trigger was tapped.
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    for (const editor of ['name', 'partner', 'color', 'facing']) {
      expect(document.querySelector(`.seat-menu-editor[data-editor="${editor}"]`)).toBeTruthy();
    }
  });
});

describe('SeatMenu — scroll strip', () => {
  it('reports no overflow when the body fits its panel', () => {
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    const body = document.querySelector('.seat-menu-body')!;
    expect(body.getAttribute('data-overflow')).toBe('none');
  });

  it('publishes which edge still has content as the body scrolls', () => {
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    const body = document.querySelector('.seat-menu-body')!;
    // happy-dom lays nothing out, so fake a body twice as tall as its box —
    // the exact live repro (scrollHeight 412 vs clientHeight 307).
    Object.defineProperty(body, 'scrollHeight', { value: 412, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 307, configurable: true });
    body.scrollTop = 0;
    fireEvent.scroll(body);
    expect(body.getAttribute('data-overflow')).toBe('bottom');
    body.scrollTop = 50;
    fireEvent.scroll(body);
    expect(body.getAttribute('data-overflow')).toBe('both');
    body.scrollTop = 105;
    fireEvent.scroll(body);
    expect(body.getAttribute('data-overflow')).toBe('top');
  });

  it('publishes the same tell on the horizontal axis, for the compact row', () => {
    // A short seat's body scrolls horizontally instead of vertically — the
    // scroll cue needs its own axis, not a reuse of `data-overflow` (which
    // stays 'none' here since this body never overflows vertically).
    const game = makeGame();
    render(
      <SeatMenu
        player={game.players[0]}
        game={game}
        canEdit
        canLayout
        rotation={0}
        dispatch={() => {}}
        onClose={() => {}}
        isActiveTurn={false}
        isMonarch={false}
        isInitiative={false}
      />
    );
    const body = document.querySelector('.seat-menu-body')!;
    Object.defineProperty(body, 'scrollWidth', { value: 600, configurable: true });
    Object.defineProperty(body, 'clientWidth', { value: 320, configurable: true });
    body.scrollLeft = 0;
    fireEvent.scroll(body);
    expect(body.getAttribute('data-overflow-x')).toBe('right');
    body.scrollLeft = 140;
    fireEvent.scroll(body);
    expect(body.getAttribute('data-overflow-x')).toBe('both');
    body.scrollLeft = 280;
    fireEvent.scroll(body);
    expect(body.getAttribute('data-overflow-x')).toBe('left');
  });
});
