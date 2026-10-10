// @vitest-environment happy-dom
// E357 — a rules walkthrough steps through its states, keeps the step in the
// URL, shows the rule text behind each step, and counts one finish per visit.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RulesWalkthroughPage } from './RulesWalkthroughPage';
import { RulesWalkthroughsPage } from './RulesWalkthroughsPage';
import { WALKTHROUGHS } from '@/lib/rules-walkthroughs';

const track = vi.fn();
vi.mock('@/lib/util/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/util/analytics')>()),
  track: (...args: unknown[]) => track(...args),
}));

let failBundle = false;
vi.mock('@/lib/cards/comprehensive-rules', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/cards/comprehensive-rules')>();
  return {
    ...mod,
    loadRulesBundle: () =>
      failBundle
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({
            meta: { effective: 'August 7, 2026', source: 'test' },
            sections: [],
            keywords: [],
            glossary: [],
            rules: [
              { number: '117.3a', text: 'The active player receives priority.' },
              { number: '117.3c', text: 'A player who casts a spell receives priority afterward.' },
            ],
          }),
  };
});

beforeEach(() => {
  track.mockReset();
  failBundle = false;
});

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/rules/walkthroughs" element={<RulesWalkthroughsPage />} />
        <Route path="/rules/walkthroughs/:id" element={<RulesWalkthroughPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
}

const hold = WALKTHROUGHS.find((w) => w.id === 'hold-priority')!;

describe('RulesWalkthroughPage', () => {
  it('opens on the first step with its rule text, and Next moves through the URL', async () => {
    renderAt('/rules/walkthroughs/hold-priority');
    expect(screen.getByRole('heading', { level: 1, name: 'Hold priority' })).toBeTruthy();
    expect(screen.getByText('Step 1 of ' + hold.steps.length)).toBeTruthy();
    expect(screen.getByText(hold.steps[0].why)).toBeTruthy();
    expect(await screen.findByText('The active player receives priority.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('where').textContent).toBe(
      '/rules/walkthroughs/hold-priority?step=2'
    );
    expect(screen.getByText(hold.steps[1].why)).toBeTruthy();
    const stack = screen.getByRole('list', { name: 'Stack, top first' });
    expect(within(stack).getByText('Lightning Bolt')).toBeTruthy();
    expect(within(stack).getByText('Top')).toBeTruthy();
  });

  it('expands a rule and steps with the arrow keys', async () => {
    renderAt('/rules/walkthroughs/hold-priority?step=2');
    const rule = await screen.findByRole('button', { name: /117\.3c/ });
    expect(rule.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(rule);
    expect(rule.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Step 3 of ' + hold.steps.length)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('where').textContent).toBe('/rules/walkthroughs/hold-priority');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Step 1 of ' + hold.steps.length)).toBeTruthy();
  });

  it('counts one finish per visit, and Start over goes back to step one', () => {
    renderAt(`/rules/walkthroughs/hold-priority?step=${hold.steps.length}`);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('walkthrough_finished');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('Step 1 of ' + hold.steps.length)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    for (let i = 1; i < hold.steps.length; i++) fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(`Step ${hold.steps.length} of ${hold.steps.length}`)).toBeTruthy();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('clamps a step out of range to the walkthrough', () => {
    renderAt('/rules/walkthroughs/hold-priority?step=99');
    expect(screen.getByText(`Step ${hold.steps.length} of ${hold.steps.length}`)).toBeTruthy();
  });

  it('shows the card text and rulings, and who holds priority', () => {
    renderAt('/rules/walkthroughs/ulamog-countered?step=2');
    fireEvent.click(screen.getByRole('button', { name: /Card text/ }));
    expect(screen.getByText(/exile two target permanents/)).toBeTruthy();
    expect(
      screen.getByText(
        'Follows the official rulings of Ulamog, the Ceaseless Hunger, August 25, 2015.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Nobody has priority')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Waiting to go on the stack' })).toBeTruthy();
  });

  it('says when the rule text could not load', async () => {
    failBundle = true;
    renderAt('/rules/walkthroughs/hold-priority');
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't load the rule text. Check your connection and try again.")
      ).toBeTruthy()
    );
  });

  it('answers an unknown walkthrough with a way back', () => {
    renderAt('/rules/walkthroughs/no-such-thing');
    expect(screen.getByText('No walkthrough at this address.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'See all walkthroughs' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Walkthroughs' })).toBeTruthy();
  });
});

describe('RulesWalkthroughsPage', () => {
  it('lists every walkthrough by group with a link to it', () => {
    renderAt('/rules/walkthroughs');
    for (const w of WALKTHROUGHS) {
      const link = screen.getByRole('link', { name: new RegExp(w.title) });
      expect(link.getAttribute('href')).toBe(`/rules/walkthroughs/${w.id}`);
    }
    expect(screen.getByRole('heading', { name: 'Priority and the stack' })).toBeTruthy();
  });
});
