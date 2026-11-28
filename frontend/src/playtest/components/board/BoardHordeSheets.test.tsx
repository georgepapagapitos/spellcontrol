// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BoardHordeSheets } from './BoardHordeSheets';

type Props = ComponentProps<typeof BoardHordeSheets>;

// A phone: no reduced motion and below 1024px, so a sheet's close animates.
beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
});

const ended = {
  phase: 'ended',
  outcome: 'lost',
  config: { hordeId: 'zombies' },
  hordeTurn: 2,
  damageTaken: 0,
  cardsMilledByDamage: 0,
  board: { zones: { graveyard: [] } },
};

function props(over: Partial<Props>): Props {
  return {
    onlineTable: null,
    onlineHorde: null,
    onlineHordeView: null,
    onlineHordeOutcome: null,
    onlineHordePendingReveal: null,
    horde: null,
    hordeLoad: null,
    hordeDeckCardNames: [],
    hordeFeltRef: { current: null },
    showHordeSetup: false,
    resistanceOn: false,
    hordeCardMenuId: null,
    hordeDamageOpen: false,
    turn: 3,
    dispatch: vi.fn(),
    disarmHorde: vi.fn(),
    confirmHordeReveal: vi.fn(),
    leaveTable: vi.fn().mockResolvedValue(undefined),
    withHordeActions: (node) => node,
    onCloseSetup: vi.fn(),
    onCloseCardMenu: vi.fn(),
    onCloseDamage: vi.fn(),
    ...over,
  } as Props;
}

describe('BoardHordeSheets end sheet Done', () => {
  // Solo: Done ends the game outright, so it slides out first like any sheet.
  it('solo: plays the exit, then disarms the horde', () => {
    const disarmHorde = vi.fn();
    render(
      <BoardHordeSheets {...props({ horde: ended as unknown as Props['horde'], disarmHorde })} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('is-closing')).toBe(true);
    expect(disarmHorde).not.toHaveBeenCalled();
    fireEvent.animationEnd(dialog, { animationName: 'binder-sheet-slide-out' });
    expect(disarmHorde).toHaveBeenCalledTimes(1);
  });

  // Online: Leave table asks first, and a Cancel must find the sheet live.
  it('online: asks to leave at once and stays live for another try', () => {
    const leaveTable = vi.fn().mockResolvedValue(undefined);
    render(
      <BoardHordeSheets
        {...props({
          onlineTable: { isHost: true, dispatch: vi.fn() } as unknown as Props['onlineTable'],
          onlineHordeView: ended as unknown as Props['onlineHordeView'],
          onlineHordeOutcome: 'lost',
          leaveTable,
        })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(leaveTable).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog').classList.contains('is-closing')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(leaveTable).toHaveBeenCalledTimes(2);
  });
});
