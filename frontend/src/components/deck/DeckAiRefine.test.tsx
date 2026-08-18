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
vi.mock('../../lib/deck-analysis', () => ({
  analyzeDeck: () => ({
    totalNonCommander: 99,
    expectedSize: 99,
    sizeDelta: 0,
    types: {
      creatures: 0,
      instants: 0,
      sorceries: 0,
      artifacts: 0,
      enchantments: 0,
      planeswalkers: 0,
      battles: 0,
      lands: 0,
      other: 0,
    },
    curve: { buckets: [], averageCmc: 0, peak: 0, verdict: 'curve-ok', message: '' },
    roles: [],
    colorIdentity: { commanderColors: [], offColorCards: [] },
    taggerReady: true,
  }),
}));
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

  it('takes the same strip posture on the Coach tab, keeping the build framing', async () => {
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
        variant="coach"
      />
    );
    // Collapsed strip with the build title + candidate-count teaser.
    const strip = await screen.findByRole('button', { name: /Refine this build/ });
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    expect(strip.textContent).toContain('1 candidate');

    fireEvent.click(strip);
    // Expanded to the full panel — the run CTA waits, nothing auto-runs.
    expect(await screen.findByRole('button', { name: 'Refine this build' })).toBeTruthy();
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

  // ── Refine-panel levers (bulk apply, dismiss, re-roll) — code-only, never
  // another AI request. ──

  function threeTweakStub() {
    stubApi(true, [
      { add: 'Card A', cut: 'Cut A', why: 'Reason A.' },
      { add: 'Card B', cut: 'Cut B', why: 'Reason B.' },
      { add: 'Card C', cut: 'Cut C', why: 'Reason C.' },
    ]);
  }

  interface ThreeTweakProps {
    onApplyMove?: (c: Change) => void;
    onApplyAll?: (swaps: Array<{ removeName: string; addName: string }>) => void;
    alternatives?: ReadonlyMap<string, string[]>;
    deckId?: string;
  }

  /** Built separately from `render` so a test can `rerender` it with a new
   *  `deckId` — the deck-switch path. Carries the same `key={deck.id}` every
   *  production call site does, which is what resets the panel per deck. */
  function threeTweakPanel(props: ThreeTweakProps) {
    return (
      <DeckAiRefine
        key={props.deckId ?? 'd1'}
        deckId={props.deckId ?? 'd1'}
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[
          { slotId: 's1', card: card('Cut A') },
          { slotId: 's2', card: card('Cut B') },
          { slotId: 's3', card: card('Cut C') },
        ]}
        pool={[{ name: 'Card A', oracleId: 'p1', qty: 1 }]}
        ownedOnly={false}
        onApplyMove={props.onApplyMove ?? (() => {})}
        onApplyAll={props.onApplyAll}
        alternatives={props.alternatives}
      />
    );
  }

  function renderThreeTweaks(props: ThreeTweakProps) {
    return render(threeTweakPanel(props));
  }

  it('bulk apply passes every remaining swap as {removeName, addName} pairs', async () => {
    threeTweakStub();
    const applied: Array<{ removeName: string; addName: string }> = [];
    renderThreeTweaks({ onApplyAll: (swaps) => applied.push(...swaps) });

    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply all 3 swaps' }));

    expect(applied).toEqual([
      { removeName: 'Cut A', addName: 'Card A' },
      { removeName: 'Cut B', addName: 'Card B' },
      { removeName: 'Cut C', addName: 'Card C' },
    ]);
    // Bulk-applied rows read as Applied, same as a single accept.
    expect(screen.getAllByText('Applied')).toHaveLength(3);
  });

  it('hides the bulk button below 2 remaining tweaks', async () => {
    stubApi(true, [{ add: 'Card A', cut: 'Cut A', why: 'Reason A.' }]);
    renderThreeTweaks({ onApplyAll: () => {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    await screen.findByText('Reason A.');
    expect(screen.queryByRole('button', { name: /Apply all/ })).toBeNull();
  });

  it('hides the bulk button for the replace variant, even with 2+ tweaks', async () => {
    stubApi(true, [
      { add: 'Card A', cut: 'Cut A', why: 'Reason A.' },
      { add: 'Card A', cut: 'Cut B', why: 'Reason B.' },
    ]);
    render(
      <DeckAiRefine
        deckId="d1"
        format="commander"
        commander={card('Meren of Clan Nel Toth')}
        partnerCommander={null}
        mainboard={[{ slotId: 's1', card: card('Cut A') }]}
        pool={[{ name: 'Card A', oracleId: 'p1', qty: 1 }]}
        ownedOnly={false}
        onApplyMove={() => {}}
        onApplyAll={() => {}}
        variant="replace"
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: /Is it an upgrade\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Weigh this add' }));
    await screen.findByText('Reason A.');
    expect(screen.queryByRole('button', { name: /Apply all/ })).toBeNull();
  });

  it('dismiss collapses the row reversibly, persists across a remount, and undo restores it', async () => {
    threeTweakStub();
    const { unmount } = renderThreeTweaks({});
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    await screen.findByText('Reason B.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Card B' }));
    expect(await screen.findByText('Dismissed Card B')).toBeTruthy();
    expect(screen.queryByText('Reason B.')).toBeNull();
    expect(JSON.parse(localStorage.getItem('sc-ai-refine-dismissed:d1') as string)).toEqual([
      'Card B',
    ]);

    unmount();

    // Remount, re-run, and confirm the dismissal survived (rejected suggestion
    // does not resurrect on reopen / a cache replay).
    threeTweakStub();
    renderThreeTweaks({});
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    expect(await screen.findByText('Dismissed Card B')).toBeTruthy();
    expect(screen.queryByText('Reason B.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Reason B.')).toBeTruthy();
    expect(screen.queryByText('Dismissed Card B')).toBeNull();
    expect(JSON.parse(localStorage.getItem('sc-ai-refine-dismissed:d1') as string)).toEqual([]);
  });

  it('re-roll applies the currently displayed alternative and drops the AI why', async () => {
    stubApi(true, [{ add: 'Card A', cut: 'Cut A', why: "The AI's own reasoning about Card A." }]);
    const applied: Change[] = [];
    const alternatives = new Map([['Card A', ['Card A2', 'Card A3']]]);
    renderThreeTweaks({ onApplyMove: (c) => applied.push(c), alternatives });

    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    await screen.findByText("The AI's own reasoning about Card A.");

    fireEvent.click(screen.getByRole('button', { name: 'Try another alternative to Card A' }));
    expect(await screen.findByText('Card A2')).toBeTruthy();
    // The AI's why no longer applies to a card it never evaluated.
    expect(screen.queryByText("The AI's own reasoning about Card A.")).toBeNull();
    expect(screen.getByText(/Engine alternative — same role as Card A\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try another alternative to Card A2' }));
    expect(await screen.findByText('Card A3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Swap Cut A for Card A3/ }));
    expect(applied[0]).toMatchObject({ type: 'swap', name: 'Card A3', inName: 'Cut A' });
    expect(applied[0].reason).not.toMatch(/AI's own reasoning/);

    // A way back to the AI's pick: cycling past the last alternative wraps.
    expect(screen.queryByRole('button', { name: /Use the AI's pick/ })).toBeTruthy();
  });

  // ── Deck-switch isolation. `/decks/:id` carries no `key`, so react-router
  // REUSES this element when moving between decks and it never unmounts. ──

  it("drops the previous deck's reading when the editor switches decks", async () => {
    // Left on screen, deck A's tweaks would still be applicable — and "Apply
    // all" would push A's swaps straight into deck B.
    threeTweakStub();
    const view = renderThreeTweaks({ onApplyAll: () => {}, deckId: 'deck-a' });
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    expect(await screen.findByRole('button', { name: 'Apply all 3 swaps' })).toBeTruthy();

    view.rerender(threeTweakPanel({ onApplyAll: () => {}, deckId: 'deck-b' }));

    expect(screen.queryByRole('button', { name: 'Apply all 3 swaps' })).toBeNull();
    expect(screen.queryByText('Reason A.')).toBeNull();
  });

  it("reads the newly-opened deck's dismissals, not the deck it mounted with", async () => {
    // The corruption case: a mount-only initializer keeps deck A's set, and the
    // next save writes it back under deck B's key.
    localStorage.setItem('sc-ai-refine-dismissed:deck-b', JSON.stringify(['Card B']));
    threeTweakStub();
    const view = renderThreeTweaks({ deckId: 'deck-a' });
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    // Deck A has dismissed nothing, so B's stored dismissal must not apply here.
    expect(await screen.findByText('Reason B.')).toBeTruthy();
    expect(screen.queryByText('Dismissed Card B')).toBeNull();

    view.rerender(threeTweakPanel({ deckId: 'deck-b' }));
    threeTweakStub();
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));

    expect(await screen.findByText('Dismissed Card B')).toBeTruthy();
    expect(screen.queryByText('Reason B.')).toBeNull();
    // Deck A's key was never written with deck B's set.
    expect(localStorage.getItem('sc-ai-refine-dismissed:deck-a')).toBeNull();
  });
});
