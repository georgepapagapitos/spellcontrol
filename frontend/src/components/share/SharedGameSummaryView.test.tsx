// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PublicGameResultShare } from '../../lib/shared-types';

const submitReportMock = vi.fn((_input: { kind: string; targetId: string; reason: string }) =>
  Promise.resolve()
);
vi.mock('../../lib/report-client', () => ({
  submitReport: (input: { kind: string; targetId: string; reason: string }) =>
    submitReportMock(input),
}));

import { SharedGameSummaryView } from './SharedGameSummaryView';

function sample(overrides: Partial<PublicGameResultShare> = {}): PublicGameResultShare {
  return {
    sessionId: 'sess-1',
    format: 'commander',
    startingLife: 40,
    winnerSeat: 0,
    participants: [
      {
        seat: 0,
        name: 'Alice',
        deckId: 'd1',
        deckName: 'Atraxa Superfriends',
        commander: 'Atraxa, Praetors Voice',
        colorIdentity: ['W', 'U', 'B', 'G'],
        finalLife: 12,
        eliminated: false,
      },
      {
        seat: 1,
        name: 'Bob',
        deckId: 'd2',
        deckName: 'Krenko Goblins',
        commander: 'Krenko, Mob Boss',
        colorIdentity: ['R'],
        finalLife: 0,
        eliminated: true,
      },
    ],
    notableEvents: [
      { id: 'e1', ts: 1000, kind: 'eliminate', actorSeat: null, targetSeat: 1 },
      { id: 'e2', ts: 2000, kind: 'end', actorSeat: null, targetSeat: 0 },
    ],
    endedAt: Date.now() - 60_000,
    durationMs: 3_600_000,
    ...overrides,
  };
}

describe('SharedGameSummaryView', () => {
  it('renders a full sample payload — winner banner, participants, and notable moments', () => {
    render(<SharedGameSummaryView data={sample()} token="tok123" />);

    expect(screen.getByText('Winner')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Alice' })).toBeTruthy();

    expect(screen.getByText('Atraxa Superfriends')).toBeTruthy();
    expect(screen.getByText('Atraxa, Praetors Voice')).toBeTruthy();
    expect(screen.getByText('12 life')).toBeTruthy();

    expect(screen.getByText('Krenko Goblins')).toBeTruthy();
    expect(screen.getByText('0 life')).toBeTruthy();
    expect(screen.getByText('Eliminated')).toBeTruthy();

    expect(screen.getByRole('heading', { level: 2, name: 'Notable moments' })).toBeTruthy();
    expect(screen.getByText('Bob eliminated')).toBeTruthy();
    expect(screen.getByText('Alice wins — game ended')).toBeTruthy();
  });

  it('shows the no-declared-winner header variant when winnerSeat is null', () => {
    render(<SharedGameSummaryView data={sample({ winnerSeat: null })} token="tok123" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'commander game — no declared winner' })
    ).toBeTruthy();
    expect(screen.queryByText('Winner')).toBeNull();
  });

  it('omits the Notable moments section when notableEvents is null (pre-migration game)', () => {
    render(<SharedGameSummaryView data={sample({ notableEvents: null })} token="tok123" />);
    expect(screen.queryByText('Notable moments')).toBeNull();
  });

  it('omits the Notable moments section when notableEvents is an empty array', () => {
    render(<SharedGameSummaryView data={sample({ notableEvents: [] })} token="tok123" />);
    expect(screen.queryByText('Notable moments')).toBeNull();
  });

  it('"Report this game" opens ReportDialog, which submits kind=game-result with this page\'s token', async () => {
    render(<SharedGameSummaryView data={sample()} token="tok123" />);

    fireEvent.click(screen.getByRole('button', { name: 'Report this game' }));
    expect(screen.getByRole('heading', { name: 'Report this content' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Why are you reporting this?'), {
      target: { value: 'Table conduct issue' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(submitReportMock).toHaveBeenCalledWith({
        kind: 'game-result',
        targetId: 'tok123',
        reason: 'Table conduct issue',
      });
    });
  });
});
