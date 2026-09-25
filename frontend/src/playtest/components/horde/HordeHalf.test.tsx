// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { buildTestHorde } from '@/playtest/lib/horde-solo.fixtures';
import { HordeHalf } from './HordeHalf';

beforeEach(() => {
  // Reduced motion true so `useSheetExit` (the damage sheet) closes/opens
  // synchronously under happy-dom, which never fires `animationend`.
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
    retryHordeLoad: vi.fn(),
  });
});

/** Real browser sequence for a click/tap — a bare `fireEvent.click` skips
 *  the `pointerdown` dnd-kit's `PointerSensor` needs to (falsely) pass;
 *  see HordeTable.test.tsx's own doc comment for the full story. */
function realPointerActivate(el: Element) {
  fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(el, { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' });
  fireEvent.click(el);
}

function renderHalf(overrides: Partial<Parameters<typeof HordeHalf>[0]> = {}) {
  const feltRef = createRef<HTMLDivElement>();
  const horde = overrides.horde !== undefined ? overrides.horde : buildTestHorde();
  return render(
    <HordeHalf
      horde={horde}
      hordeLoad={{ status: 'idle', error: null }}
      playerTurn={1}
      feltRef={feltRef}
      {...overrides}
    />
  );
}

describe('HordeHalf', () => {
  it('renders the name, status, and library meter', () => {
    renderHalf();
    expect(screen.getByText('Zombies')).toBeTruthy();
    expect(screen.getByText(/Standard ·/)).toBeTruthy();
    expect(screen.getByText(/Horde library ·/)).toBeTruthy();
  });

  it('opens the card menu on a real pointer tap and records a choice', () => {
    const horde = buildTestHorde();
    // Put one real card on the horde's battlefield to tap.
    const card = horde.board.zones.library[0];
    horde.board = {
      ...horde.board,
      battlefield: [
        { card, tapped: false, counters: {}, stickers: [], x: 0.5, y: 0.5, faceDown: false },
      ],
    };
    renderHalf({ horde });
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement;
    realPointerActivate(cardEl);
    expect(screen.getByRole('dialog', { name: card.name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Destroyed' }));
    expect(usePlaytestStore.getState().moveHordeCard).toHaveBeenCalledWith(card.id, 'graveyard');
  });

  it('opens the damage sheet and calls damageHorde with the confirmed amount', () => {
    renderHalf();
    fireEvent.click(screen.getByRole('button', { name: 'Damage the horde' }));
    expect(screen.getByRole('dialog', { name: 'Damage the horde' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(usePlaytestStore.getState().damageHorde).toHaveBeenCalled();
    const [amount] = (usePlaytestStore.getState().damageHorde as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(amount).toBeGreaterThanOrEqual(0);
  });

  it('hides the damage action once the fight has ended', () => {
    renderHalf({ horde: buildTestHorde({ phase: 'ended', outcome: 'won' }) });
    expect(screen.queryByRole('button', { name: 'Damage the horde' })).toBeNull();
  });

  it('shows a quiet loading line instead of an empty half while re-arming', () => {
    renderHalf({ horde: null, hordeLoad: { status: 'loading', error: null } });
    expect(screen.getByText(/Loading the horde/)).toBeTruthy();
  });

  it('shows an error line with Try again, which calls retryHordeLoad', () => {
    renderHalf({ horde: null, hordeLoad: { status: 'error', error: "Couldn't load that horde." } });
    expect(screen.getByText("Couldn't load that horde.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(usePlaytestStore.getState().retryHordeLoad).toHaveBeenCalledTimes(1);
  });
});
