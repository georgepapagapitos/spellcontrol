// @vitest-environment happy-dom
/**
 * B7-02: `.seat-menu-body` can genuinely overflow the panel (worst case: a
 * 2-player game, the largest panel size) — it must publish which edge(s)
 * still have content behind them, mirroring Tabs.tsx's `data-overflow`
 * scroll-edge-fade convention (there horizontal, here vertical).
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGameState, makePlayer } from '../../lib/game-state';
import { SeatMenu } from './SeatMenu';

function makeGame() {
  return createGameState({
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
}

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
});
