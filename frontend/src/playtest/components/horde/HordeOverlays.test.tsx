// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { buildTestHorde } from '@/playtest/lib/horde-solo.fixtures';
import { HordeOverlays } from './HordeOverlays';

beforeEach(() => {
  // Reduced motion true so `useSheetExit` closes/opens synchronously under
  // happy-dom, which never fires `animationend`.
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
  usePlaytestStore.setState({
    moveHordeCard: vi.fn(),
    damageHorde: vi.fn(),
    clearHordeDamageResult: vi.fn(),
  });
});

function renderOverlays(overrides: Partial<Parameters<typeof HordeOverlays>[0]> = {}) {
  const feltRef = createRef<HTMLDivElement>();
  return render(
    <HordeOverlays
      horde={buildTestHorde()}
      cardMenuId={null}
      onCloseCardMenu={vi.fn()}
      damageOpen={false}
      onCloseDamage={vi.fn()}
      feltRef={feltRef}
      {...overrides}
    />
  );
}

describe('HordeOverlays', () => {
  it('renders nothing when no card menu is requested and the damage sheet is closed', () => {
    renderOverlays();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the card menu for the requested card and records a choice', () => {
    const horde = buildTestHorde();
    const card = horde.board.zones.library[0];
    horde.board = {
      ...horde.board,
      battlefield: [
        { card, tapped: false, counters: {}, stickers: [], x: 0.5, y: 0.5, faceDown: false },
      ],
    };
    renderOverlays({ horde, cardMenuId: card.id });
    expect(screen.getByRole('dialog', { name: card.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Destroyed' }));
    expect(usePlaytestStore.getState().moveHordeCard).toHaveBeenCalledWith(card.id, 'graveyard');
  });

  it('opens the damage sheet and calls damageHorde with the confirmed amount', () => {
    const onCloseDamage = vi.fn();
    renderOverlays({ damageOpen: true, onCloseDamage });
    expect(screen.getByRole('dialog', { name: 'Damage the horde' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(usePlaytestStore.getState().damageHorde).toHaveBeenCalled();
  });

  it('clears the result and closes on Done, once a result is in', () => {
    const onCloseDamage = vi.fn();
    const horde = buildTestHorde({
      lastDamageResult: { amount: 3, before: 40, after: 37, milled: [], bossesEntered: [] },
    });
    renderOverlays({ horde, damageOpen: true, onCloseDamage });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(usePlaytestStore.getState().clearHordeDamageResult).toHaveBeenCalledTimes(1);
    expect(onCloseDamage).toHaveBeenCalledTimes(1);
  });
});
