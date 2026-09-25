// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { buildTestHorde } from '@/playtest/lib/horde-solo.fixtures';
import { pending } from '@/test/pending';
import { HordeSetupSheet } from './HordeSetupSheet';

beforeEach(() => {
  // Reduced motion so `useSheetExit` closes synchronously under happy-dom.
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
});

function renderSheet(overrides: Partial<Parameters<typeof HordeSetupSheet>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <HordeSetupSheet
      horde={null}
      hordeLoad={{ status: 'idle', error: null }}
      cardNames={['Sol Ring']}
      resistanceOn={false}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onClose };
}

describe('HordeSetupSheet', () => {
  it('stays open and shows the loading state while arming', () => {
    const armHorde = vi.fn(() => pending());
    usePlaytestStore.setState({ armHorde });
    const { onClose } = renderSheet({ hordeLoad: { status: 'loading', error: null } });
    const button = screen.getByRole('button', { name: /Fighting the horde/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error line with Try again, wired to retryHordeLoad', () => {
    const retryHordeLoad = vi.fn();
    usePlaytestStore.setState({ retryHordeLoad });
    renderSheet({ hordeLoad: { status: 'error', error: "Couldn't load that horde." } });
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load that horde.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryHordeLoad).toHaveBeenCalledTimes(1);
  });

  it('closes on a successful arm', async () => {
    const armHorde = vi.fn(async () => {
      usePlaytestStore.setState({ hordeLoad: { status: 'idle', error: null, pending: null } });
    });
    usePlaytestStore.setState({
      armHorde,
      hordeLoad: { status: 'idle', error: null, pending: null },
    });
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Fight the horde' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(armHorde).toHaveBeenCalledWith('zombies', 'standard', {});
  });

  it('does not close when the arm ends in error', async () => {
    const armHorde = vi.fn(async () => {
      usePlaytestStore.setState({
        hordeLoad: {
          status: 'error',
          error: 'nope',
          pending: { hordeId: 'zombies', level: 'standard', overrides: {} },
        },
      });
    });
    usePlaytestStore.setState({
      armHorde,
      hordeLoad: { status: 'idle', error: null, pending: null },
    });
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Fight the horde' }));
    await waitFor(() => expect(armHorde).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers Stop the fight when a horde is already armed, and it disarms + closes', () => {
    const disarmHorde = vi.fn();
    usePlaytestStore.setState({ disarmHorde });
    const { onClose } = renderSheet({ horde: buildTestHorde() });
    fireEvent.click(screen.getByRole('button', { name: 'Stop the fight' }));
    expect(disarmHorde).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no Stop the fight action when nothing is armed', () => {
    renderSheet({ horde: null });
    expect(screen.queryByRole('button', { name: 'Stop the fight' })).toBeNull();
  });

  it('warns that Resistance turns off, only when it is on', () => {
    renderSheet({ resistanceOn: true });
    expect(screen.getByText('Turns Resistance off.')).toBeTruthy();
  });
});
