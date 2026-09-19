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

vi.mock('../lib/comprehensive-rules', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/comprehensive-rules')>();
  return {
    ...mod,
    loadRulesBundle: () =>
      Promise.resolve({
        meta: { effective: 'August 7, 2026', source: 'test' },
        sections: [],
        keywords: [
          { name: 'Deathtouch', kind: 'ability', rule: '702.2' },
          { name: 'Flying', kind: 'ability', rule: '702.9' },
          { name: 'Destroy', kind: 'action', rule: '701.8' },
        ],
        glossary: [{ term: 'Deathtouch', definition: 'A keyword ability. See rule 702.2.' }],
        rules: [
          { number: '702.2', text: 'Deathtouch is a static ability.' },
          { number: '702.2b', text: 'Any nonzero amount of combat damage is lethal.' },
          { number: '704.5g', text: 'A creature dealt lethal damage is destroyed.' },
        ],
      }),
  };
});

/** The Ask tab — the AI Q&A's own tests open the page straight onto it. */
const renderPage = (state?: Record<string, unknown>, search = '?tab=ask') =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/rules', search, state }]}>
      <RulesPage />
    </MemoryRouter>
  );

describe('RulesPage — the Rules hub', () => {
  it('opens on the Keywords reference by default, with the Ask tab beside the three sections', async () => {
    renderPage(undefined, '');
    expect(screen.getByRole('heading', { level: 1, name: 'Rules' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Keywords', 'Glossary', 'Rules', 'Ask']);
    expect(screen.getByRole('tab', { name: 'Keywords' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(await screen.findByText('Deathtouch')).toBeTruthy();
    expect(screen.queryByLabelText('Your rules question')).toBeNull();
  });

  it('is exactly the reference when AI is off — no Ask tab, and ?tab=ask falls back to Keywords', async () => {
    aiState.status = null;
    renderPage();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Keywords',
      'Glossary',
      'Rules',
    ]);
    expect(screen.getByRole('tab', { name: 'Keywords' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(await screen.findByText('Deathtouch')).toBeTruthy();
    expect(screen.queryByLabelText('Your rules question')).toBeNull();
    expect(screen.queryByText(/isn't available/)).toBeNull();
  });

  it('reads the section and search from the URL so a rule lookup is a linkable address', async () => {
    renderPage(undefined, '?tab=rules&q=704.5g');
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Search rules reference') as HTMLInputElement).value).toBe(
      '704.5g'
    );
    expect(await screen.findByText('A creature dealt lethal damage is destroyed.')).toBeTruthy();
    expect(screen.queryByText('Deathtouch is a static ability.')).toBeNull();
  });

  it('a "see rule" link jumps to the Rules section with that number searched', async () => {
    renderPage(undefined, '?tab=glossary');
    fireEvent.click(await screen.findByRole('button', { name: '702.2' }));
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Search rules reference') as HTMLInputElement).value).toBe(
      '702.2'
    );
    expect(await screen.findByText('Deathtouch is a static ability.')).toBeTruthy();
  });

  it('opens on Ask when the sheet door sends a question along, even without ?tab', () => {
    renderPage({ question: 'deathtouch indestructible' }, '');
    expect(screen.getByRole('tab', { name: /Ask/ }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Your rules question') as HTMLTextAreaElement).value).toBe(
      'deathtouch indestructible'
    );
    expect(requestRulesAnswer).not.toHaveBeenCalled();
  });
});

describe('RulesPage', () => {
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

describe('RulesPage — every row has a menu', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  const openMenu = (label: string) =>
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${label}` }));

  it('copies the number and the official text, and copies the row address', async () => {
    renderPage(undefined, '?tab=rules&q=702.2b');
    await screen.findByText('Any nonzero amount of combat damage is lethal.');
    openMenu('Rule 702.2b');
    fireEvent.click(screen.getByText('Copy text'));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '702.2b Any nonzero amount of combat damage is lethal.'
      )
    );
    openMenu('Rule 702.2b');
    fireEvent.click(screen.getByText('Copy link'));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rules?tab=rules&q=702.2b`)
    );
  });

  it('opens from a right-click on the row too', async () => {
    renderPage(undefined, '?tab=rules&q=702.2b');
    const text = await screen.findByText('Any nonzero amount of combat damage is lethal.');
    fireEvent.contextMenu(text.closest('.rules-ref-rule')!);
    expect(screen.getByText('Copy text')).toBeTruthy();
  });

  it('offers the card searches for a keyword ability, never for a keyword action', async () => {
    renderPage(undefined, '');
    await screen.findByText('Deathtouch');
    openMenu('Deathtouch');
    expect(screen.getByText('Cards with this keyword')).toBeTruthy();
    expect(screen.getByText('Search Scryfall')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    openMenu('Destroy');
    expect(screen.getByText('Copy text')).toBeTruthy();
    expect(screen.queryByText('Cards with this keyword')).toBeNull();
    expect(screen.queryByText('Search Scryfall')).toBeNull();
  });

  it('"Ask AI about this" opens the Ask tab seeded, sends nothing, and the strip clears the seed', async () => {
    renderPage(undefined, '?tab=rules&q=702.2b');
    await screen.findByText('Any nonzero amount of combat damage is lethal.');
    openMenu('Rule 702.2b');
    fireEvent.click(screen.getByText('Ask AI about this'));
    expect(screen.getByRole('tab', { name: /Ask/ }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Your rules question') as HTMLTextAreaElement).value).toBe(
      'Explain rule 702.2b.'
    );
    expect(requestRulesAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    fireEvent.click(screen.getByRole('tab', { name: /Ask/ }));
    expect((screen.getByLabelText('Your rules question') as HTMLTextAreaElement).value).toBe('');
  });

  it('has no Ask item when AI is off', async () => {
    aiState.status = null;
    renderPage(undefined, '?tab=rules&q=702.2b');
    await screen.findByText('Any nonzero amount of combat damage is lethal.');
    openMenu('Rule 702.2b');
    expect(screen.getByText('Copy text')).toBeTruthy();
    expect(screen.queryByText('Ask AI about this')).toBeNull();
  });
});
