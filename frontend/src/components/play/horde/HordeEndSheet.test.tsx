// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { usePlayStore } from '@/store/play';
import { HordeEndSheet } from './HordeEndSheet';

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
  usePlayStore.setState({ history: [] });
});

const BASE = {
  hordeId: 'zombies',
  damageTaken: 0,
  cardsMilledByDamage: 0,
  bossesBeaten: 0,
  onPlayAgain: vi.fn(),
  onDone: vi.fn(),
};

describe('HordeEndSheet headline turn number', () => {
  // The paper table's own rounds — untouched.
  it('reads the horde-turns count when endedOnTurn is absent (the paper table)', () => {
    render(<HordeEndSheet {...BASE} outcome="lost" hordeTurns={4} />);
    expect(screen.getByRole('heading', { name: 'Overrun on turn 4' })).toBeTruthy();
  });

  // Solo (E387 PR 5): a loss on your own turn 1, before the horde's first
  // turn, used to read "Overrun on turn 0" (hordeTurns, not yours).
  it('prefers endedOnTurn over hordeTurns when present (solo)', () => {
    render(<HordeEndSheet {...BASE} outcome="lost" hordeTurns={0} endedOnTurn={1} />);
    expect(screen.getByRole('heading', { name: 'Overrun on turn 1' })).toBeTruthy();
  });

  it('never mentions a turn number on a win', () => {
    render(<HordeEndSheet {...BASE} outcome="won" hordeTurns={0} endedOnTurn={1} />);
    expect(screen.getByRole('heading', { name: 'The horde is gone' })).toBeTruthy();
  });

  it('still shows the Horde-turns stat row as hordeTurns, not endedOnTurn', () => {
    render(<HordeEndSheet {...BASE} outcome="lost" hordeTurns={0} endedOnTurn={1} />);
    const row = screen.getByText('Horde turns').closest('li')!;
    expect(row.textContent).toBe('Horde turns0');
  });
});

// A phone: no reduced motion and below 1024px, so a close animates.
const phone = () =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );

describe('HordeEndSheet and browser Back', () => {
  // E1121: onClose is onDone, which leaves the game, and Back used to run it.
  it('browser Back does not leave the game', () => {
    window.history.replaceState({ idx: 0 }, '', '/play/local');
    const onDone = vi.fn();
    render(<HordeEndSheet {...BASE} onDone={onDone} outcome="lost" hordeTurns={2} />);
    window.history.back();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Overrun on turn 2' })).toBeTruthy();
    expect(window.location.pathname).toBe('/play/local');
  });
});

/** Solo and the paper table pass `doneCloses`: Done ends the game outright,
 *  so it plays the sheet's exit like every other sheet. #3260 made Done call
 *  `onDone` at once for every parent, and the phone slide-out went with it. */
describe('HordeEndSheet Done where it ends the game', () => {
  it('plays the exit on a phone, then runs onDone once', () => {
    phone();
    const onDone = vi.fn();
    render(<HordeEndSheet {...BASE} onDone={onDone} doneCloses outcome="lost" hordeTurns={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('is-closing')).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    // A second tap while it slides out must not start a second leave.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.animationEnd(dialog, { animationName: 'binder-sheet-slide-out' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('runs onDone at once, with no exit, under reduced motion', () => {
    const onDone = vi.fn(); // beforeEach: prefers-reduced-motion matches
    render(<HordeEndSheet {...BASE} onDone={onDone} doneCloses outcome="won" hordeTurns={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog').classList.contains('is-closing')).toBe(false);
  });

  it('is still not dismissed by Escape or Back', () => {
    phone();
    window.history.replaceState({ idx: 0 }, '', '/play/local');
    const onDone = vi.fn();
    render(<HordeEndSheet {...BASE} onDone={onDone} doneCloses outcome="lost" hordeTurns={2} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    window.history.back();
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('is-closing')).toBe(false);
    fireEvent.animationEnd(dialog, { animationName: 'binder-sheet-slide-out' });
    expect(onDone).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/play/local');
  });
});

/** At an online table Done asks "Leave the table?" first. A Cancel there (or
 *  a leave that fails) keeps the parent rendering the sheet, which must come
 *  back live: its Done used to play the exit, so the sheet stayed half-closed
 *  (on a phone, the panel slid away under a scrim) and Done never fired again. */
describe('HordeEndSheet when the parent keeps it after Done', () => {
  it('stays fully up with a working Done after the leave is declined', () => {
    phone();
    vi.useFakeTimers();
    try {
      const onDone = vi.fn(); // the parent asks, the player cancels
      render(<HordeEndSheet {...BASE} onDone={onDone} outcome="lost" hordeTurns={2} />);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      act(() => vi.advanceTimersByTime(700));
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('dialog').classList.contains('is-closing')).toBe(false);

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      act(() => vi.advanceTimersByTime(700));
      expect(onDone).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays live when the leave itself fails', async () => {
    phone();
    const swallow = (reason: unknown) => {
      if (!(reason instanceof Error && reason.message === 'leave failed')) throw reason;
    };
    process.on('unhandledRejection', swallow);
    try {
      // The online call site's shape: `onDone={() => void leaveTable()}`.
      const leave = vi.fn(() => Promise.reject(new Error('leave failed')));
      render(<HordeEndSheet {...BASE} onDone={() => void leave()} outcome="won" hordeTurns={3} />);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await act(() => new Promise((r) => setTimeout(r, 700)));
      expect(screen.getByRole('dialog').classList.contains('is-closing')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(leave).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise((r) => setTimeout(r, 0));
      process.off('unhandledRejection', swallow);
    }
  });
});
