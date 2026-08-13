// @vitest-environment happy-dom
// T102 — the AI review's two behaviours that cost something if they break:
// consent is granted in place (and only ever by an explicit press), and the
// reading renders weakness-first with the model's card names made tappable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckAiReview } from './DeckAiReview';

// The carousel pulls in the Scryfall client + CardPreview; the panel only needs
// to prove it hands the tapped name over.
const opened: { entries: { name: string }[]; tapped: string }[] = [];
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({
    open: (entries: { name: string }[], tapped: string) => opened.push({ entries, tapped }),
    preview: null,
  }),
}));

vi.mock('../../lib/deck-analysis', () => ({ analyzeDeck: () => ({ totalNonCommander: 99 }) }));
vi.mock('@/lib/use-tagger-ready', () => ({ useTaggerReady: () => true }));

function card(name: string): ScryfallCard {
  return { id: name, oracle_id: `o-${name}`, name } as ScryfallCard;
}

const REVIEW = [
  'Your deck ramps into Sol Ring and casts Kaalia of the Vast.',
  'It wins by connecting with Kaalia of the Vast.',
  "Your mana cannot support it — Sol Ring's colorless does not fix colors.",
].join('\n\n');

/** Route each endpoint the panel touches; `optIn` drives the consent state. */
function stubApi(optIn: boolean) {
  const calls: string[] = [];
  const mock = vi.fn(async (url: string) => {
    calls.push(url);
    const body =
      url === '/api/ai/status'
        ? { optIn, used: 0, limit: 10 }
        : url === '/api/ai/opt-in'
          ? { optIn: true }
          : { content: REVIEW, cached: false, model: 'm', usage: {} };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

function renderPanel() {
  return render(
    <DeckAiReview
      deckId="d1"
      format="commander"
      commander={card('Kaalia of the Vast')}
      partnerCommander={null}
      mainboard={[
        { slotId: 's1', card: card('Sol Ring') },
        { slotId: 's2', card: card('Swamp') },
      ]}
    />
  );
}

beforeEach(() => {
  opened.length = 0;
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('inline consent', () => {
  it('grants consent in place and sends nothing before the press', async () => {
    const calls = stubApi(false);
    renderPanel();

    const enable = await screen.findByRole('button', { name: 'Turn on AI Beta' });
    expect(calls).toEqual(['/api/ai/status']);

    fireEvent.click(enable);
    await waitFor(() => expect(calls).toContain('/api/ai/opt-in'));

    // Consent alone never spends a reading — the idle state waits for a press.
    expect(await screen.findByRole('button', { name: 'Read the deck' })).toBeTruthy();
    expect(calls).not.toContain('/api/ai/deck-review');
  });

  it('stays dismissed once "No thanks" is pressed', async () => {
    stubApi(false);
    const { unmount } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /No thanks/ }));
    unmount();

    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector('.deck-ai-review')).toBeNull());
  });
});

describe('the reading', () => {
  it('leads with the weakness and chips the cards the model named', async () => {
    stubApi(true);
    const { container } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Read the deck' }));

    const weakness = await waitFor(() => {
      const el = container.querySelector('.deck-ai-section--weakness');
      if (!el) throw new Error('no weakness section');
      return el;
    });
    // Weakness first in the DOM, ahead of the gameplan the model wrote first.
    const titles = [...container.querySelectorAll('.deck-ai-section-title')].map((t) =>
      t.textContent?.trim()
    );
    expect(titles).toEqual(['The weakness that matters', 'The gameplan', 'How it wins']);
    expect(weakness.textContent).toContain('Your mana cannot support it');

    // Basics are not chip-worthy; the named cards are, once each per mention.
    const chips = [...container.querySelectorAll('.deck-ai-card-chip')].map((c) => c.textContent);
    // Weakness-then-gameplan-then-win order, possessive included.
    expect(chips).toEqual(['Sol Ring', 'Sol Ring', 'Kaalia of the Vast', 'Kaalia of the Vast']);
    expect(container.textContent).not.toContain('Swamp');

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview Sol Ring' })[0]);
    expect(opened[0].tapped).toBe('Sol Ring');
    expect(opened[0].entries.map((e) => e.name)).toEqual(['Sol Ring', 'Kaalia of the Vast']);
  });
});
