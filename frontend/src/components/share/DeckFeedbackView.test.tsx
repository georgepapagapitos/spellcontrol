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
    ownerDisplayName: null,
    id: 'd-1',
    name: 'Edric Combo',
    format: 'commander',
    commander: { name: 'Edric, Spymaster of Trest' },
    partnerCommander: null,
    cards: [
      { card: { id: 'p1', oracle_id: 'o1', name: 'Sol Ring', type_line: 'Artifact' } },
      { card: { id: 'p2', oracle_id: 'o2', name: 'Counterspell', type_line: 'Instant' } },
    ],
    sideboard: [
      { card: { id: 'p3', oracle_id: 'o3', name: 'Rhystic Study', type_line: 'Enchantment' } },
    ],
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
    // No display name set → the bare username, no @ (formatIdentity's primary).
    expect(screen.getByText('brewer is asking for feedback')).toBeTruthy();
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Counterspell')).toBeTruthy();
  });

  it('prefers the owner’s display name, with @username as a secondary line', () => {
    render(
      <MemoryRouter>
        <DeckFeedbackView data={{ ...deck(), ownerDisplayName: 'Bo the Brewer' }} token="tok-1" />
      </MemoryRouter>
    );
    expect(screen.getByText('Bo the Brewer is asking for feedback')).toBeTruthy();
    expect(screen.getByText('@brewer')).toBeTruthy();
  });

  it('shows the commander for context without a cut affordance', () => {
    renderView();
    expect(screen.getByText('Commander')).toBeTruthy();
    expect(screen.getByText('Edric, Spymaster of Trest')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Suggest cutting Edric/ })).toBeNull();
  });

  it('shows the sideboard for context without a cut affordance', () => {
    renderView();
    expect(screen.getByText('Sideboard (1)')).toBeTruthy();
    expect(screen.getByText('Rhystic Study')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Suggest cutting Rhystic Study/ })).toBeNull();
  });

  it('toggles a cut via the scissors and reflects it in the tally + submit count', () => {
    renderView();
    const cutBtn = screen.getByRole('button', { name: 'Suggest cutting Sol Ring' });
    fireEvent.click(cutBtn);
    expect(cutBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 cut')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review & send/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send feedback \(1 suggestion\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo cut suggestion for Sol Ring' }));
    expect(cutBtn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('1 cut')).toBeNull();
  });

  it('offers the same scissors toggle in list view', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    const cutBtn = screen.getByRole('button', { name: 'Suggest cutting Counterspell' });
    fireEvent.click(cutBtn);
    expect(cutBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Suggested cut')).toBeTruthy();
  });

  it('requires a name (when signed out) plus content before submitting', () => {
    renderView();
    const submit = screen.getByRole('button', { name: /Send feedback/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Suggest cutting Sol Ring' }));
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/So the owner knows/), {
      target: { value: 'Reviewer' },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits cuts, bracket, and comment, then shows the sent state', async () => {
    submitFeedback.mockResolvedValue({ id: 'fb-1' });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest cutting Sol Ring' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Suggest cutting Counterspell' }));
    fireEvent.change(screen.getByPlaceholderText(/So the owner knows/), {
      target: { value: 'Reviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send feedback \(1 suggestion\)/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not found'));
    // The pending cut survives the failure (button reads as its toggled state).
    expect(
      screen.getByRole('button', { name: 'Undo cut suggestion for Counterspell' })
    ).toBeTruthy();
  });
});
