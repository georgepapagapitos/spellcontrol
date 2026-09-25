// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlaytestSessionRecord } from '@/lib/playtest/session-record';
import { PlaytestSessionSummary } from './PlaytestSessionSummary';

function record(overrides: Partial<PlaytestSessionRecord> = {}): PlaytestSessionRecord {
  return {
    id: 'r1',
    deckId: 'd1',
    endedAt: Date.now(),
    turns: 5,
    mulligans: 0,
    resistance: false,
    resistanceCounters: 0,
    resistanceRemovals: 0,
    resistanceBounces: 0,
    resistanceWipesSurvived: 0,
    landDropsHit: 0,
    landDropsMissed: 0,
    landDropTurnsChecked: 0,
    cardsDrawn: null,
    ...overrides,
  };
}

describe('PlaytestSessionSummary — solo Horde line (E387 PR 5)', () => {
  it('says Beat when the horde was defeated', () => {
    render(
      <PlaytestSessionSummary
        record={record({
          horde: { hordeId: 'zombies', hordeName: 'Zombies', level: 'standard', outcome: 'won' },
        })}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('Beat the Zombies horde (Standard)')).toBeTruthy();
  });

  it('says Overrun by when the horde won', () => {
    render(
      <PlaytestSessionSummary
        record={record({
          horde: { hordeId: 'zombies', hordeName: 'Zombies', level: 'brutal', outcome: 'lost' },
        })}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('Overrun by the Zombies horde (Brutal)')).toBeTruthy();
  });

  it('says Fought when the game ended with no outcome yet', () => {
    render(
      <PlaytestSessionSummary
        record={record({
          horde: { hordeId: 'zombies', hordeName: 'Zombies', level: 'casual', outcome: null },
        })}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('Fought the Zombies horde (Casual)')).toBeTruthy();
  });

  it('adds no horde line for a session with no horde', () => {
    render(<PlaytestSessionSummary record={record()} onDismiss={vi.fn()} />);
    expect(screen.queryByText(/the .* horde/)).toBeNull();
  });
});
