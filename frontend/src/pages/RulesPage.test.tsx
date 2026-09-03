// @vitest-environment happy-dom
// E261 — the rules Q&A's behaviours that cost something if they break: consent
// gates the ask box, nothing is sent without an explicit Ask, and the answer's
// verified citations expand to the official rule text.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RulesPage } from './RulesPage';

const opened: { entries: { name: string }[]; tapped: string }[] = [];
vi.mock('../components/deck/useCardCarousel', () => ({
  useCardCarousel: () => ({
    open: (entries: { name: string }[], tapped: string) => opened.push({ entries, tapped }),
    preview: null,
  }),
}));

const aiState: { status: { optIn: boolean; used: number; limit: number } | null } = {
  status: { optIn: true, used: 0, limit: 10 },
};
vi.mock('../lib/use-ai-status', () => ({
  useAiStatus: () => aiState.status,
  noteAiSpend: vi.fn(),
  noteAiExhausted: vi.fn(),
}));

const requestRulesAnswer = vi.fn();
const fetchRulesHistory = vi.fn();
vi.mock('../lib/ai-rules', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/ai-rules')>();
  return {
    ...mod,
    requestRulesAnswer: (...args: unknown[]) => requestRulesAnswer(...args),
    fetchRulesHistory: () => fetchRulesHistory(),
  };
});

const ANSWER = {
  content: 'Yes — state-based actions destroy it (704.5g). Blood Moon is unaffected.',
  cached: false,
  rules: [{ ref: '704.5g', text: 'A creature dealt lethal damage is destroyed.' }],
  fetched: ['Blood Moon'],
};

beforeEach(() => {
  opened.length = 0;
  aiState.status = { optIn: true, used: 0, limit: 10 };
  requestRulesAnswer.mockReset().mockResolvedValue(ANSWER);
  fetchRulesHistory
    .mockReset()
    .mockResolvedValue({ effectiveDate: 'August 7, 2026', questions: [] });
});

const renderPage = (state?: Record<string, unknown>) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/rules', state }]}>
      <RulesPage />
    </MemoryRouter>
  );

describe('RulesPage', () => {
  it('renders the unavailable note when AI is off for the account', () => {
    aiState.status = null;
    renderPage();
    expect(screen.getByText(/isn't available for you right now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the rules reference' })).toBeTruthy();
    expect(screen.queryByLabelText('Your rules question')).toBeNull();
  });

  it('gates the ask box behind in-place consent', () => {
    aiState.status = { optIn: false, used: 0, limit: 10 };
    renderPage();
    expect(screen.getByRole('button', { name: /Turn on AI Beta/ })).toBeTruthy();
    expect(screen.queryByLabelText('Your rules question')).toBeNull();
    expect(requestRulesAnswer).not.toHaveBeenCalled();
  });

  it('asks only on the explicit button, then renders the answer with expandable citations', async () => {
    renderPage();
    const box = screen.getByLabelText('Your rules question');
    fireEvent.change(box, { target: { value: 'Does lethal damage destroy it?' } });
    expect(requestRulesAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(requestRulesAnswer).toHaveBeenCalledWith(
      'Does lethal damage destroy it?',
      expect.any(Function)
    );

    // The verified citation renders as a button; the unverified-free prose stays plain.
    const refChip = await screen.findByRole('button', { name: '704.5g' });
    expect(refChip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(refChip);
    expect(refChip.getAttribute('aria-expanded')).toBe('true');
    // The official text is in the Rules cited list.
    expect(
      screen.getAllByText(/A creature dealt lethal damage is destroyed/).length
    ).toBeGreaterThan(0);
  });

  it('makes looked-up card names tappable into the carousel', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Your rules question'), {
      target: { value: 'Blood Moon?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const chip = await screen.findByRole('button', { name: 'Preview Blood Moon' });
    fireEvent.click(chip);
    expect(opened[0].tapped).toBe('Blood Moon');
    expect(opened[0].entries).toEqual([{ name: 'Blood Moon', label: 'Named in the answer' }]);
  });

  it('restores the newest past question for free on load', async () => {
    fetchRulesHistory.mockResolvedValue({
      effectiveDate: 'August 7, 2026',
      questions: [
        {
          id: 'h1',
          question: 'Old question?',
          content: 'Old answer (704.5g).',
          createdAt: Date.now() - 60_000,
          rules: ANSWER.rules,
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Old question?')).toBeTruthy());
    expect(screen.getByText(/^Asked /)).toBeTruthy();
    expect(requestRulesAnswer).not.toHaveBeenCalled();
  });

  it('seeds the box from the Rules Reference door without sending anything', async () => {
    renderPage({ question: 'deathtouch indestructible' });
    const box = screen.getByLabelText('Your rules question') as HTMLTextAreaElement;
    expect(box.value).toBe('deathtouch indestructible');
    expect(requestRulesAnswer).not.toHaveBeenCalled();
  });

  it('shows the retryable error state when the stream fails', async () => {
    requestRulesAnswer.mockRejectedValue(new Error('The answer ended early. Try again.'));
    renderPage();
    fireEvent.change(screen.getByLabelText('Your rules question'), {
      target: { value: 'Will this fail?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    requestRulesAnswer.mockResolvedValue(ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(requestRulesAnswer).toHaveBeenLastCalledWith('Will this fail?', expect.any(Function))
    );
  });

  it('disables Ask at the daily limit and says why', () => {
    aiState.status = { optIn: true, used: 10, limit: 10 };
    renderPage();
    fireEvent.change(screen.getByLabelText('Your rules question'), {
      target: { value: 'Anything?' },
    });
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Daily limit reached/)).toBeTruthy();
  });
});
