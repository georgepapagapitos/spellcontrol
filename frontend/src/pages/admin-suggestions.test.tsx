// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SuggestionLabelsTable } from './admin-suggestions';

const getSuggestionStats = vi.hoisted(() => vi.fn());
vi.mock('@/lib/account/admin-api', () => ({ getSuggestionStats }));

describe('SuggestionLabelsTable', () => {
  it('lists per-surface counts with an accept rate and the cards cut most per commander', async () => {
    getSuggestionStats.mockResolvedValue({
      surfaces: [{ surface: 'coach:all', shown: 8, accept: 2, dismiss: 0, undo: 1 }],
      topDismissed: [
        {
          commander: '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11',
          name: "Atraxa, Praetors' Voice",
          total: 3,
          cards: [{ card: 'Early Winter', count: 3 }],
        },
      ],
    });
    render(<SuggestionLabelsTable />);
    expect(await screen.findByText('coach:all')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText("Atraxa, Praetors' Voice")).toBeTruthy();
    expect(screen.getByText('Early Winter (3)')).toBeTruthy();
  });

  it('says so when nothing is recorded and when the request fails', async () => {
    getSuggestionStats.mockResolvedValueOnce({ surfaces: [], topDismissed: [] });
    const { unmount } = render(<SuggestionLabelsTable />);
    expect(await screen.findByText('No suggestion labels yet.')).toBeTruthy();
    expect(screen.getByText('Nothing dismissed yet.')).toBeTruthy();
    unmount();
    getSuggestionStats.mockRejectedValueOnce(new Error('boom'));
    render(<SuggestionLabelsTable />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
