// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
