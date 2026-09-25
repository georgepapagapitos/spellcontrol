// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { buildTestHorde } from '@/playtest/lib/horde-solo.fixtures';
import { HordeHalf } from './HordeHalf';

beforeEach(() => {
  usePlaytestStore.setState({ retryHordeLoad: vi.fn() });
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
      onCardMenu={vi.fn()}
      onOpenDamage={vi.fn()}
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

  // The menu/sheet themselves are `HordeOverlays`' job, mounted at board
  // level (see its own doc comment and horde-containing-block.test.ts) — this
  // half only ever REQUESTS them.
  it('requests the card menu on a real pointer tap, never rendering one itself', () => {
    const horde = buildTestHorde();
    const card = horde.board.zones.library[0];
    horde.board = {
      ...horde.board,
      battlefield: [
        { card, tapped: false, counters: {}, stickers: [], x: 0.5, y: 0.5, faceDown: false },
      ],
    };
    const onCardMenu = vi.fn();
    renderHalf({ horde, onCardMenu });
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement;
    realPointerActivate(cardEl);
    expect(onCardMenu).toHaveBeenCalledWith(card.id);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('requests the damage sheet on click, never rendering one itself', () => {
    const onOpenDamage = vi.fn();
    renderHalf({ onOpenDamage });
    fireEvent.click(screen.getByRole('button', { name: 'Damage the horde' }));
    expect(onOpenDamage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the damage action when the library and graveyard are both empty', () => {
    const horde = buildTestHorde();
    horde.board = { ...horde.board, zones: { ...horde.board.zones, library: [], graveyard: [] } };
    renderHalf({ horde });
    const btn = screen.getByRole('button', { name: 'Damage the horde' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
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

  it("overrides the status line with statusText, an online table's own wording", () => {
    renderHalf({ statusText: "Survivors' team turn 3 · Watching" });
    expect(screen.getByText(/Survivors' team turn 3 · Watching/)).toBeTruthy();
  });

  it('replaces the felt with a message and an action button when blocked', () => {
    const onAction = vi.fn();
    renderHalf({
      blocked: { message: 'This table is from a newer build.', actionLabel: 'Reload', onAction },
    });
    expect(screen.getByText('This table is from a newer build.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Damage the horde' })).toBeNull();
  });

  it('hides the damage action and ignores card taps when readOnly', () => {
    const horde = buildTestHorde();
    const card = horde.board.zones.library[0];
    horde.board = {
      ...horde.board,
      battlefield: [
        { card, tapped: false, counters: {}, stickers: [], x: 0.5, y: 0.5, faceDown: false },
      ],
    };
    const onCardMenu = vi.fn();
    renderHalf({ horde, onCardMenu, readOnly: true });
    expect(screen.queryByRole('button', { name: 'Damage the horde' })).toBeNull();
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement;
    realPointerActivate(cardEl);
    expect(onCardMenu).not.toHaveBeenCalled();
  });
});
