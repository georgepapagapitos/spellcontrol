// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { buildTestHorde } from '@/playtest/lib/horde-solo.fixtures';
import { HordeBand } from './HordeBand';

beforeEach(() => {
  usePlaytestStore.setState({
    resolveHordeAttack: vi.fn(),
    retryHordeLoad: vi.fn(),
  });
});

function renderBand(overrides: Partial<Parameters<typeof HordeBand>[0]> = {}) {
  const feltRef = createRef<HTMLDivElement>();
  return render(
    <HordeBand
      horde={buildTestHorde()}
      hordeLoad={{ status: 'idle', error: null }}
      playerTurn={1}
      feltRef={feltRef}
      onCardMenu={vi.fn()}
      onOpenDamage={vi.fn()}
      {...overrides}
    />
  );
}

describe('HordeBand', () => {
  it('folds by default while waiting, and the toggle opens/closes it', () => {
    renderBand({ horde: buildTestHorde({ phase: 'waiting' }) });
    const section = document.querySelector('.horde-band') as HTMLElement;
    expect(section.className).not.toContain('is-open');
    const btn = screen.getByRole('button', { name: /arrives after your turn/ }) as HTMLElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(btn);
    expect(section.className).toContain('is-open');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens by itself on reveal and closes again once back to waiting', () => {
    const feltRef = createRef<HTMLDivElement>();
    const { rerender } = render(
      <HordeBand
        horde={buildTestHorde({ phase: 'waiting' })}
        hordeLoad={{ status: 'idle', error: null }}
        playerTurn={1}
        feltRef={feltRef}
        onCardMenu={vi.fn()}
        onOpenDamage={vi.fn()}
      />
    );
    let section = document.querySelector('.horde-band') as HTMLElement;
    expect(section.className).not.toContain('is-open');

    rerender(
      <HordeBand
        horde={buildTestHorde({ phase: 'reveal' })}
        hordeLoad={{ status: 'idle', error: null }}
        playerTurn={1}
        feltRef={feltRef}
        onCardMenu={vi.fn()}
        onOpenDamage={vi.fn()}
      />
    );
    section = document.querySelector('.horde-band') as HTMLElement;
    expect(section.className).toContain('is-open');

    rerender(
      <HordeBand
        horde={buildTestHorde({ phase: 'waiting' })}
        hordeLoad={{ status: 'idle', error: null }}
        playerTurn={1}
        feltRef={feltRef}
        onCardMenu={vi.fn()}
        onOpenDamage={vi.fn()}
      />
    );
    section = document.querySelector('.horde-band') as HTMLElement;
    expect(section.className).not.toContain('is-open');
  });

  it('shows the combat total in the bar and calls resolveHordeAttack with the typed value', () => {
    renderBand({
      horde: buildTestHorde({
        phase: 'combat',
        pendingAttack: { attackers: 3, power: 9, groups: [] },
      }),
    });
    expect(screen.getByText('Attacks · 9 power')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take 9' }));
    expect(usePlaytestStore.getState().resolveHordeAttack).toHaveBeenCalledWith(9);
  });

  it('reads Skip and calls resolveHordeAttack(0) once the damage field is cleared to 0', () => {
    renderBand({
      horde: buildTestHorde({
        phase: 'combat',
        pendingAttack: { attackers: 1, power: 4, groups: [] },
      }),
    });
    const input = screen.getByDisplayValue('4');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(usePlaytestStore.getState().resolveHordeAttack).toHaveBeenCalledWith(0);
  });

  // Soulless One (`*`/`*`) attacking alone: the power total reads 0, but the
  // field must still accept the real damage it dealt, not clamp to 0 (#2178).
  it('names a variable-power attacker in the compact line and lets it deal past its (0) power', () => {
    renderBand({
      horde: buildTestHorde({
        phase: 'combat',
        pendingAttack: {
          attackers: 1,
          power: 0,
          groups: [{ name: 'Soulless One', power: '*', toughness: '*', count: 1 }],
        },
      }),
    });
    expect(screen.getByText('Attacks · 0 power + 1 variable')).toBeTruthy();
    const input = screen.getByDisplayValue('0');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take 7' }));
    expect(usePlaytestStore.getState().resolveHordeAttack).toHaveBeenCalledWith(7);
  });

  // The band shipped with no way to damage the horde on a phone (E387 PR 5
  // follow-up) — this is the guard for that fix.
  it('requests the damage sheet from the bar while waiting, next to the toggle', () => {
    const onOpenDamage = vi.fn();
    renderBand({ horde: buildTestHorde({ phase: 'waiting' }), onOpenDamage });
    const btn = screen.getByRole('button', { name: 'Damage the horde' });
    fireEvent.click(btn);
    expect(onOpenDamage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no damage action during combat or once the fight has ended', () => {
    const { rerender } = renderBand({
      horde: buildTestHorde({
        phase: 'combat',
        pendingAttack: { attackers: 1, power: 4, groups: [] },
      }),
    });
    expect(screen.queryByRole('button', { name: 'Damage the horde' })).toBeNull();

    const feltRef = createRef<HTMLDivElement>();
    rerender(
      <HordeBand
        horde={buildTestHorde({ phase: 'ended', outcome: 'won' })}
        hordeLoad={{ status: 'idle', error: null }}
        playerTurn={1}
        feltRef={feltRef}
        onCardMenu={vi.fn()}
        onOpenDamage={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Damage the horde' })).toBeNull();
  });

  it('requests the card menu on a real pointer tap of an open felt card, never rendering one itself', () => {
    const horde = buildTestHorde({ phase: 'reveal' });
    const card = horde.board.zones.library[0];
    horde.board = {
      ...horde.board,
      battlefield: [
        { card, tapped: false, counters: {}, stickers: [], x: 0.5, y: 0.5, faceDown: false },
      ],
    };
    const onCardMenu = vi.fn();
    renderBand({ horde, onCardMenu });
    const cardEl = document.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement;
    fireEvent.pointerDown(cardEl, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(cardEl, { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.click(cardEl);
    expect(onCardMenu).toHaveBeenCalledWith(card.id);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a quiet loading line instead of an empty band', () => {
    renderBand({ horde: null, hordeLoad: { status: 'loading', error: null } });
    expect(screen.getByText(/Loading the horde/)).toBeTruthy();
  });

  it('shows an error line with Try again, which calls retryHordeLoad', () => {
    renderBand({ horde: null, hordeLoad: { status: 'error', error: "Couldn't load that horde." } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(usePlaytestStore.getState().retryHordeLoad).toHaveBeenCalledTimes(1);
  });
});
