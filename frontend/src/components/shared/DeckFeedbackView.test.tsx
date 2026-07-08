// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DeckFeedbackView } from './DeckFeedbackView';
import type { PublicDeck } from '../../lib/shared-types';

const submitFeedback = vi.hoisted(() => vi.fn());
vi.mock('../../lib/feedback-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/feedback-client')>()),
  submitFeedback,
}));

// Keep the add-search inert — network-driven and not under test here.
vi.mock('../../lib/use-search-cards', () => ({
  useSearchCards: () => ({ results: [], loading: false, error: null }),
}));

function deck(): PublicDeck {
  return {
    ownerUsername: 'brewer',
    id: 'd-1',
    name: 'Edric Combo',
    format: 'commander',
    commander: { name: 'Edric, Spymaster of Trest' },
    partnerCommander: null,
    cards: [
      { card: { id: 'p1', oracle_id: 'o1', name: 'Sol Ring', type_line: 'Artifact' } },
      { card: { id: 'p2', oracle_id: 'o2', name: 'Counterspell', type_line: 'Instant' } },
    ],
    sideboard: [],
    color: '#7aa6c2',
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <DeckFeedbackView data={deck()} token="tok-1" />
    </MemoryRouter>
  );
}

beforeEach(() => {
  submitFeedback.mockReset();
});

describe('DeckFeedbackView', () => {
  it('renders the deck grouped by type with a feedback header', () => {
    renderView();
    expect(screen.getByText('@brewer is asking for feedback')).toBeTruthy();
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
  });

  it('toggles a cut suggestion on card tap and reflects it in the submit count', () => {
    renderView();
    const row = screen.getByRole('button', { name: /Sol Ring/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Send feedback \(1 suggestion\)/ })).toBeTruthy();
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('false');
  });

  it('requires a name (when signed out) plus content before submitting', () => {
    renderView();
    const submit = screen.getByRole('button', { name: /Send feedback/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Sol Ring/ }));
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/So the owner knows/), {
      target: { value: 'Reviewer' },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits cuts, bracket, and comment, then shows the sent state', async () => {
    submitFeedback.mockResolvedValue({ id: 'fb-1' });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Sol Ring/ }));
    fireEvent.change(screen.getByPlaceholderText(/So the owner knows/), {
      target: { value: 'Reviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /3\s*Upgraded/ }));
    fireEvent.change(screen.getByPlaceholderText(/Overall thoughts/), {
      target: { value: 'Solid list.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send feedback \(1 suggestion\)/ }));

    await waitFor(() => expect(screen.getByText('Feedback sent')).toBeTruthy());
    expect(submitFeedback).toHaveBeenCalledWith('tok-1', {
      authorName: 'Reviewer',
      comment: 'Solid list.',
      bracketSuggestion: 3,
      suggestions: [
        {
          type: 'cut',
          cardName: 'Sol Ring',
          oracleId: 'o1',
          scryfallId: 'p1',
          imageUrl: undefined,
        },
      ],
    });
  });

  it('surfaces a submit failure without losing the form', async () => {
    submitFeedback.mockRejectedValue(new Error('Feedback link not found.'));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /Counterspell/ }));
    fireEvent.change(screen.getByPlaceholderText(/So the owner knows/), {
      target: { value: 'Reviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send feedback \(1 suggestion\)/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not found'));
    expect(screen.getByRole('button', { name: /Counterspell/ })).toBeTruthy();
  });
});
