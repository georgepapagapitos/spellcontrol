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
  it('offers consent rather than hiding, since this may be the first AI surface seen', async () => {
    // On the post-generation build report this panel IS the introduction —
    // rendering nothing would hide the feature exactly where it should appear.
    stubApi(false, []);
    renderPanel(() => {});
    expect(await screen.findByRole('button', { name: 'Turn on AI Beta' })).toBeTruthy();
    // The working surface stays behind consent: no run button yet.
    expect(screen.queryByRole('button', { name: 'Refine this build' })).toBeNull();
  });

  it('renders nothing once the invite is dismissed', async () => {
    stubApi(false, []);
    const { unmount } = renderPanel(() => {});
    fireEvent.click(await screen.findByRole('button', { name: /No thanks/ }));
    unmount();

    const { container } = renderPanel(() => {});
    await waitFor(() => expect(container.querySelector('.deck-ai-review')).toBeNull());
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

  it('replace posture: strip → "Weigh this add" → an upgrade verdict applies as a swap', async () => {
    const applied: Change[] = [];
    stubApi(true, [
      { add: 'Karumonix, the Rat King', cut: 'Necrogen Mists', why: 'A rat lord beats a tax.' },
    ]);
    render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Necrogen Mists') }]}
        pool={[{ name: 'Karumonix, the Rat King', oracleId: 'p1', qty: 1 }]}
        ownedOnly={false}
        onApplyMove={(c) => applied.push(c)}
        variant="replace"
      />
    );
    const strip = await screen.findByRole('button', { name: /Is it an upgrade\?/ });
    // The candidate-count teaser is meaningless for a pool of one.
    expect(strip.textContent).not.toContain('candidate');
    fireEvent.click(strip);
    fireEvent.click(await screen.findByRole('button', { name: 'Weigh this add' }));
    fireEvent.click(await screen.findByRole('button', { name: /Swap Necrogen Mists/ }));
    expect(applied[0]).toMatchObject({
      type: 'swap',
      name: 'Karumonix, the Rat King',
      inName: 'Necrogen Mists',
    });
  });

  it('replace posture: a cut-less tweak is dropped — a full deck cannot take a pure add', async () => {
    stubApi(true, [{ add: 'Karumonix, the Rat King', cut: null, why: 'More rats.' }]);
    render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Swamp') }]}
        pool={[{ name: 'Karumonix, the Rat King', oracleId: 'p1', qty: 1 }]}
        ownedOnly={false}
        onApplyMove={() => {}}
        variant="replace"
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Is it an upgrade\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weigh this add' }));
    expect(await screen.findByText(/wouldn't cut a card for Karumonix/)).toBeTruthy();
  });

  it('starts as a compact strip on the Suggestions tab and expands in place (E244)', async () => {
    stubApi(true, []);
    render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Swamp') }]}
        pool={[{ name: "Hell's Caretaker", oracleId: 'p1', qty: 1 }]}
        ownedOnly={false}
        onApplyMove={() => {}}
        variant="suggestions"
      />
    );
    // Collapsed: one row, the tab's suggestion list keeps its space.
    const strip = await screen.findByRole('button', { name: /Weigh these suggestions/ });
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Weigh the suggestions' })).toBeNull();

    fireEvent.click(strip);
    expect(await screen.findByRole('button', { name: 'Weigh the suggestions' })).toBeTruthy();
  });

  it('expanding the strip without consent shows the consent card, in place', async () => {
    stubApi(false, []);
    render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Swamp') }]}
        pool={[{ name: "Hell's Caretaker", oracleId: 'p1', qty: 1 }]}
        ownedOnly={false}
        onApplyMove={() => {}}
        variant="suggestions"
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Weigh these suggestions/ }));
    expect(await screen.findByRole('button', { name: 'Turn on AI Beta' })).toBeTruthy();
  });

  it('shows no strip at all with an empty pool — an advisor with nothing to say', async () => {
    stubApi(true, []);
    const { container } = render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Swamp') }]}
        pool={[]}
        ownedOnly={false}
        onApplyMove={() => {}}
        variant="suggestions"
      />
    );
    // Let the status fetch settle, then confirm nothing rendered.
    await waitFor(() => expect(container.firstChild).toBeNull());
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
