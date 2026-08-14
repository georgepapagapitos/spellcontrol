// @vitest-environment happy-dom
// T102 slice 4 — the refine panel's load-bearing behaviour: it renders only
// with consent, and accepting a tweak goes through the SAME Change the coach
// feed applies (never a parallel mutation path).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Change } from '@/lib/deck-change';
import { DeckAiRefine } from './DeckAiRefine';
import { __resetAiStatus } from '../../lib/use-ai-status';

vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: () => {}, preview: null }),
}));
vi.mock('../../lib/deck-analysis', () => ({ analyzeDeck: () => ({ totalNonCommander: 99 }) }));
vi.mock('@/lib/use-tagger-ready', () => ({ useTaggerReady: () => true }));

function card(name: string): ScryfallCard {
  return { id: name, oracle_id: `o-${name}`, name } as ScryfallCard;
}

const STRATEGY = 'Your deck grinds value out of the graveyard.';

function stubApi(optIn: boolean, tweaks: unknown[]) {
  const mock = vi.fn(async (url: string) => {
    if (url === '/api/ai/deck-refine') {
      const lines = [
        { delta: STRATEGY },
        { done: { content: STRATEGY, tweaks, cached: false, model: 'm', usage: {} } },
      ];
      return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(''), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }
    return new Response(JSON.stringify({ optIn, used: 0, limit: 10 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
}

function renderPanel(onApplyMove: (c: Change) => void) {
  return render(
    <DeckAiRefine
      deckId="d1"
      format="commander"
      commander={card('Meren of Clan Nel Toth')}
      partnerCommander={null}
      mainboard={[
        { slotId: 's1', card: card('Necrogen Mists') },
        { slotId: 's2', card: card('Swamp') },
      ]}
      pool={[{ name: "Hell's Caretaker", oracleId: 'p1', qty: 1 }]}
      ownedOnly={false}
      onApplyMove={onApplyMove}
    />
  );
}

beforeEach(() => {
  __resetAiStatus();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('DeckAiRefine', () => {
  it('renders nothing at all until consent is granted', async () => {
    stubApi(false, []);
    const { container } = renderPanel(() => {});
    await waitFor(() => expect(container.querySelector('.deck-ai-marker')).toBeNull());
    expect(container.textContent).not.toContain('Refine this build');
  });

  it('applies an accepted swap as a Change on the existing coach path', async () => {
    const applied: Change[] = [];
    stubApi(true, [
      { add: "Hell's Caretaker", cut: 'Necrogen Mists', why: 'Recursion, not a symmetric tax.' },
    ]);
    renderPanel((c) => applied.push(c));

    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    fireEvent.click(await screen.findByRole('button', { name: /Swap Necrogen Mists/ }));

    expect(applied).toHaveLength(1);
    // `name` is the card coming IN, `inName` the one cut — the direction
    // handleApplyCoachMove reads. Backwards here would swap the wrong card out.
    expect(applied[0]).toMatchObject({
      type: 'swap',
      name: "Hell's Caretaker",
      inName: 'Necrogen Mists',
      reason: 'Recursion, not a symmetric tax.',
    });
  });

  it('applies a cut-less tweak as a plain add', async () => {
    const applied: Change[] = [];
    stubApi(true, [{ add: "Hell's Caretaker", cut: null, why: 'A recursion outlet you lack.' }]);
    renderPanel((c) => applied.push(c));

    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add Hell's Caretaker/ }));

    expect(applied[0]).toMatchObject({ type: 'add', name: "Hell's Caretaker" });
    expect(applied[0].inName).toBeUndefined();
  });

  it('says so plainly when the model proposes nothing', async () => {
    // An empty list is a result, not a broken panel.
    stubApi(true, []);
    renderPanel(() => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    expect(await screen.findByText(/already holds together/)).toBeTruthy();
  });

  it('will not run with an empty pool — there would be nothing to curate', async () => {
    stubApi(true, []);
    render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Swamp') }]}
        pool={[]}
        ownedOnly={false}
        onApplyMove={() => {}}
      />
    );
    const btn = await screen.findByRole('button', { name: 'Refine this build' });
    expect(btn).toHaveProperty('disabled', true);
  });
});
