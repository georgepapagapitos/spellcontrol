// @vitest-environment happy-dom
// T102 — the AI review's two behaviours that cost something if they break:
// consent is granted in place (and only ever by an explicit press), and the
// reading renders weakness-first with the model's card names made tappable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { DeckAiReview } from './DeckAiReview';
import { __resetAiStatus } from '../../lib/use-ai-status';

// The carousel pulls in the Scryfall client + CardPreview; the panel only needs
// to prove it hands the tapped name over.
// `card` is captured as well as `name`: an entry carrying one skips the
// carousel's resolver, and it is that resolver which prefers the player's OWNED
// printing. A suggested card must therefore arrive name-only.
const opened: {
  entries: { name: string; label?: string; card?: unknown }[];
  tapped: string;
}[] = [];
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({
    open: (entries: { name: string }[], tapped: string) => opened.push({ entries, tapped }),
    preview: null,
  }),
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

// Prompt v4 shape: labelled sections, weakness emitted first.
const REVIEW = [
  "---WEAKNESS---\nYour mana cannot support it — Sol Ring's colorless does not fix colors.",
  '---GAMEPLAN---\nYour deck ramps into Sol Ring and casts Kaalia of the Vast.',
  '---WINS---\nIt wins by connecting with Kaalia of the Vast.',
].join('\n\n');

/** A review cached from prompt v3 — no labels at all. */
const LEGACY_REVIEW = [
  'Your deck ramps into Sol Ring.',
  'It wins by connecting.',
  'Your mana cannot support it.',
].join('\n\n');

/**
 * Route each endpoint the panel touches; `optIn` drives the consent state.
 * deck-review answers in the route's NDJSON wire format — `reviewLines` lets a
 * test replace the happy stream with a truncated or failing one.
 */
function stubApi(optIn: boolean, reviewLines?: unknown[], readings: unknown[] = []) {
  const calls: string[] = [];
  const lines = reviewLines ?? [
    { delta: REVIEW },
    { done: { content: REVIEW, cached: false, model: 'm', usage: {} } },
  ];
  const mock = vi.fn(async (url: string) => {
    calls.push(url);
    if (url === '/api/ai/deck-review') {
      return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(''), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }
    const body = url.startsWith('/api/ai/history')
      ? { readings }
      : url === '/api/ai/status'
        ? { optIn, used: 0, limit: 10 }
        : { optIn: true };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

/** The panel reads location state (⌘K deep-open, E247), so it needs a router.
 *  `state` mirrors what the palette's "Read the deck" command navigates with. */
function renderPanel(state?: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/decks/d1', state }]}>
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
    </MemoryRouter>
  );
}

beforeEach(() => {
  opened.length = 0;
  localStorage.clear();
  // AI status is a module-level store shared by the review and refine panels,
  // so consent granted by one test would otherwise leak into the next.
  __resetAiStatus();
});
afterEach(() => vi.unstubAllGlobals());

/** The panel starts as a collapsed insight strip (E244) — the only button
 *  carrying aria-expanded. Expanding reveals the consent card or the panel. */
async function expandStrip() {
  fireEvent.click(await screen.findByRole('button', { expanded: false }));
}

describe('insight-strip posture (E244)', () => {
  it('starts as a compact strip and expands in place without spending anything', async () => {
    const calls = stubApi(true);
    renderPanel();

    const strip = await screen.findByRole('button', { expanded: false });
    expect(strip.textContent).toContain('Read the deck');
    expect(calls).toEqual(['/api/ai/status']);

    fireEvent.click(strip);
    // Expanded to the idle panel — the CTA waits; nothing was sent.
    expect(await screen.findByRole('button', { name: 'Read the deck' })).toBeTruthy();
    expect(calls).not.toContain('/api/ai/deck-review');
  });

  it('arrives expanded when the ⌘K palette asked via location state (E247)', async () => {
    const calls = stubApi(true);
    renderPanel({ openAiReview: true });
    // Straight past the strip to the idle panel — and still nothing spent.
    expect(await screen.findByRole('button', { name: 'Read the deck' })).toBeTruthy();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
    expect(calls).not.toContain('/api/ai/deck-review');
  });
});

describe('review history', () => {
  const READINGS = [
    { id: 'r2', content: REVIEW, model: 'm', createdAt: Date.now() - 60 * 60 * 1000 },
    { id: 'r1', content: LEGACY_REVIEW, model: 'm', createdAt: Date.now() - 3 * 86400 * 1000 },
  ];

  it('restores the newest past reading on expand — a local swap, never a model call', async () => {
    const calls = stubApi(true, undefined, READINGS);
    const { container } = renderPanel();
    await expandStrip();

    // The newest reading is displayed with its as-of date, nothing was spent.
    await waitFor(() => expect(container.querySelector('.deck-ai-section--weakness')).toBeTruthy());
    expect(container.textContent).toContain('Written 1 hour ago');
    expect(calls).not.toContain('/api/ai/deck-review');

    // Both readings are on the rail; the displayed one is marked current.
    const rail = screen.getByRole('navigation', { name: 'Previous readings' });
    const items = [...rail.querySelectorAll('.deck-ai-history-item')];
    expect(items.map((i) => i.textContent)).toEqual(['1 hour ago', '3 days ago']);
    expect(items[0].getAttribute('aria-current')).toBe('true');

    // Reopening the older one swaps the prose locally.
    fireEvent.click(items[1]);
    expect(container.textContent).toContain('Written 3 days ago');
    // The older reading predates the section labels — plain-prose fallback.
    expect(container.querySelector('.deck-ai-section--weakness')).toBeNull();
    expect(container.textContent).toContain('Your mana cannot support it.');
    expect(calls).not.toContain('/api/ai/deck-review');
  });

  it('shows the idle pitch when the deck has no history yet', async () => {
    stubApi(true);
    renderPanel();
    await expandStrip();
    expect(await screen.findByRole('button', { name: 'Read the deck' })).toBeTruthy();
  });
});

describe('inline consent', () => {
  it('grants consent in place and sends nothing before the press', async () => {
    const calls = stubApi(false);
    renderPanel();
    await expandStrip();

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
    await expandStrip();
    fireEvent.click(await screen.findByRole('button', { name: /No thanks/ }));
    unmount();

    // Dismissed without consent: no panel, and no strip either.
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector('.deck-ai-review')).toBeNull());
    expect(container.querySelector('.deck-ai-strip')).toBeNull();
  });
});

describe('the reading', () => {
  it('leads with the weakness and chips the cards the model named', async () => {
    stubApi(true);
    const { container } = renderPanel();
    await expandStrip();
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

  it('chips the cards it recommends, name-only so they open the owned printing', async () => {
    // The prescription names a card the deck does NOT run — which is the whole
    // point of a recommendation, and exactly why matching prose against the
    // decklist alone left it as dead text.
    const withFix = [
      '---WEAKNESS---\nYour mana cannot support it. Add Anguished Unmaking for an answer.',
      '---GAMEPLAN---\nYour deck ramps into Sol Ring.',
      '---WINS---\nIt wins by connecting with Kaalia of the Vast.',
    ].join('\n\n');
    stubApi(true, [
      { delta: withFix },
      {
        done: {
          content: withFix,
          cached: false,
          model: 'm',
          usage: {},
          fetched: ['Anguished Unmaking'],
        },
      },
    ]);
    const { container } = renderPanel();
    await expandStrip();
    fireEvent.click(await screen.findByRole('button', { name: 'Read the deck' }));

    await waitFor(() => {
      if (!container.querySelector('.deck-ai-section--weakness')) throw new Error('not yet');
    });
    const chips = [...container.querySelectorAll('.deck-ai-card-chip')].map((c) => c.textContent);
    expect(chips).toContain('Anguished Unmaking');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Anguished Unmaking' }));
    const suggested = opened[0].entries.find((e) => e.name === 'Anguished Unmaking');
    // No `card`, so the carousel resolves it — that resolver is what prefers a
    // printing the player already owns over Scryfall's default.
    expect(suggested?.card).toBeUndefined();
    expect(suggested?.label).toBe('Suggested — not in this deck');
    // A deck card still carries its printing straight through, as before.
    expect(opened[0].entries.find((e) => e.name === 'Sol Ring')?.card).toBeTruthy();
  });

  it('chips deck cards only when the reading predates the looked-up list', async () => {
    // A row stored before the column existed sends no `fetched`. That must read
    // as "unknown", not as "it looked nothing up" — the deck chips still work.
    stubApi(true, [
      { delta: REVIEW },
      { done: { content: REVIEW, cached: true, model: 'm', usage: {} } },
    ]);
    const { container } = renderPanel();
    await expandStrip();
    fireEvent.click(await screen.findByRole('button', { name: 'Read the deck' }));

    await waitFor(() => {
      if (!container.querySelector('.deck-ai-section--weakness')) throw new Error('not yet');
    });
    const chips = [...container.querySelectorAll('.deck-ai-card-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['Sol Ring', 'Sol Ring', 'Kaalia of the Vast', 'Kaalia of the Vast']);
  });

  it('shows nothing but the error when the stream dies mid-write', async () => {
    // Half a finding reads as a finding, and the server stored nothing — so the
    // partial must not survive into the panel.
    stubApi(true, [
      { delta: 'Your deck ramps into Sol Ring' },
      { error: 'The review could not be generated. Try again.' },
    ]);
    const { container } = renderPanel();
    await expandStrip();
    fireEvent.click(await screen.findByRole('button', { name: 'Read the deck' }));

    await screen.findByRole('alert');
    expect(container.textContent).toContain('The review could not be generated.');
    expect(container.textContent).not.toContain('ramps into');
    expect(container.querySelector('.deck-ai-prose')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('renders a label-less v3 review as plain prose instead of mislabelling it', async () => {
    stubApi(true, [
      { delta: LEGACY_REVIEW },
      { done: { content: LEGACY_REVIEW, cached: true, model: 'm', usage: {} } },
    ]);
    const { container } = renderPanel();
    await expandStrip();
    fireEvent.click(await screen.findByRole('button', { name: 'Read the deck' }));

    await waitFor(() => expect(container.querySelector('.deck-ai-prose')).toBeTruthy());
    expect(container.querySelector('.deck-ai-section-title')).toBeNull();
    expect(container.textContent).toContain('Your mana cannot support it.');
  });

  it('rejects a truncated stream rather than presenting it as finished', async () => {
    stubApi(true, [{ delta: REVIEW }]); // deltas, no terminator
    const { container } = renderPanel();
    await expandStrip();
    fireEvent.click(await screen.findByRole('button', { name: 'Read the deck' }));

    await screen.findByRole('alert');
    expect(container.textContent).toContain('ended early');
    expect(container.querySelector('.deck-ai-section--weakness')).toBeNull();
  });
});
