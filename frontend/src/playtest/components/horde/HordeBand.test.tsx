// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { buildTestHorde } from '@/playtest/lib/horde-solo.fixtures';
import { HordeBand } from './HordeBand';

beforeEach(() => {
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
    const { rerender } = renderBand({ horde: buildTestHorde({ phase: 'waiting' }) });
    let section = document.querySelector('.horde-band') as HTMLElement;
    expect(section.className).not.toContain('is-open');

    const feltRef = createRef<HTMLDivElement>();
    rerender(
      <HordeBand
        horde={buildTestHorde({ phase: 'reveal' })}
        hordeLoad={{ status: 'idle', error: null }}
        playerTurn={1}
        feltRef={feltRef}
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
