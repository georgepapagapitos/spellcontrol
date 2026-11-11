// @vitest-environment happy-dom
/**
 * The idea page (E1112): the commanders leading one deck idea, its color and owned filters, every
 * non-happy state, and the hand-off to the generator (commander + the matching theme, or an honest
 * "no theme" when the commander lacks it).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '@/types/index';

const { fetchTagPageData, fetchCommanderThemes, getCardByName } = vi.hoisted(() => ({
  fetchTagPageData: vi.fn(),
  fetchCommanderThemes: vi.fn(),
  getCardByName: vi.fn(),
}));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchTagPageData,
  fetchCommanderThemes,
  backfillColorIdentities: async (c: unknown) => c,
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({ getCardByName }));
vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

import { pending } from '@/test/pending';
import { __resetIdeaIndexForTests } from '@/lib/deck/idea-index';
import { useCollectionStore } from '@/store/collection';
import { DeckIdeaPage } from './DeckIdeaPage';

const SNAPSHOT = {
  generatedAt: '2026-11-10T00:00:00.000Z',
  aliases: {},
  ideas: [
    {
      slug: 'angels',
      name: 'Angels',
      kind: 'typal',
      type: 'Angel',
      decks: 10806,
      commanders: 24,
      card: 'Giada',
    },
    {
      slug: 'tokens',
      name: 'Tokens',
      kind: 'playstyle',
      decks: 208753,
      commanders: 23,
      card: 'Baylen',
    },
  ],
};

const cmdr = (name: string, numDecks: number, colorIdentity: string[] = ['W']) => ({
  rank: 1,
  name,
  sanitized: name.toLowerCase(),
  colorIdentity,
  numDecks,
});
const COMMANDERS = [
  cmdr('Giada, Font of Hope', 3982),
  cmdr('Kaalia of the Vast', 1483, ['W', 'B', 'R']),
  cmdr('Avacyn, Angel of Hope', 274),
];
const page = (commanders = COMMANDERS, colorSlug: string | null = null) => ({
  commanders,
  cardlists: {},
  potentialDecks: 0,
  highSynergyNames: [],
  colorSlug,
});

function Generator() {
  const loc = useLocation();
  return (
    <pre data-testid="generator">
      {JSON.stringify({ at: loc.pathname + loc.search, state: loc.state })}
    </pre>
  );
}
function renderPage(entry = '/decks/new/generate/idea/angels?format=commander') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/decks/new/generate/idea/:slug" element={<DeckIdeaPage />} />
        <Route path="/decks/new/generate" element={<Generator />} />
      </Routes>
    </MemoryRouter>
  );
}
const handedOff = async () =>
  JSON.parse((await screen.findByTestId('generator')).textContent ?? '{}') as {
    at: string;
    state: { prefill: Record<string, unknown> };
  };

beforeEach(() => {
  __resetIdeaIndexForTests();
  useCollectionStore.setState({ cards: [] });
  fetchTagPageData.mockReset().mockResolvedValue(page());
  fetchCommanderThemes.mockReset().mockResolvedValue([
    { name: 'Angels', slug: 'angels', count: 3982, url: '/tags/angels' },
    { name: 'Lifegain', slug: 'lifegain', count: 900, url: '/tags/lifegain' },
  ]);
  getCardByName.mockReset().mockImplementation(async (name: string) => ({ id: name, name }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(SNAPSHOT)))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('DeckIdeaPage list', () => {
  it('names the idea and lists its commanders with real deck counts', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Angels' })).toBeTruthy();
    expect(screen.getByText('Creature type')).toBeTruthy();
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Giada, Font of Hope')).toBeTruthy();
    expect(within(rows[0]).getByText('4k decks')).toBeTruthy();
    expect(within(rows[0]).getByRole('button', { name: 'Build with Giada' })).toBeTruthy();
    expect(within(rows[1]).getByText('Mardu')).toBeTruthy();
    expect(fetchTagPageData).toHaveBeenCalledWith('angels', []);
  });

  it('marks owned commanders and says how many angels and commanders you own', async () => {
    useCollectionStore.setState({
      cards: [
        { copyId: '1', name: 'Avacyn, Angel of Hope', typeLine: 'Legendary Creature — Angel' },
        { copyId: '2', name: 'Serra Angel', typeLine: 'Creature — Angel' },
      ] as EnrichedCard[],
    });
    renderPage();
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[2]).getByText('Owned')).toBeTruthy();
    expect(within(rows[0]).queryByText('Owned')).toBeNull();
    expect(screen.getByText('You own 2 angels and 1 of these commanders.')).toBeTruthy();
  });

  it('shows the first dozen and the rest behind Show more', async () => {
    fetchTagPageData.mockResolvedValue(
      page(Array.from({ length: 16 }, (_, i) => cmdr(`Commander ${i}`, 100 - i)))
    );
    renderPage();
    expect(await screen.findAllByRole('listitem')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Show 4 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(16);
  });

  it('filters to commanders you own, and says so when there are none', async () => {
    renderPage();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I own the commander' }));
    expect(screen.getByText("You don't own any of these commanders.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show every commander' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('refetches for a color pick, and discloses when EDHREC fell back to every color', async () => {
    renderPage();
    await screen.findAllByRole('listitem');
    fetchTagPageData.mockResolvedValue(page(COMMANDERS, null));
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    await waitFor(() => expect(fetchTagPageData).toHaveBeenLastCalledWith('angels', ['R']));
    expect(
      await screen.findByText('EDHREC has no mono-red list for angels. Showing every color.')
    ).toBeTruthy();
    fetchTagPageData.mockResolvedValue(page(COMMANDERS, 'mono-white'));
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    await waitFor(() => expect(screen.queryByText(/Showing every color/)).toBeNull());
  });

  it('an empty color page offers to clear the colors', async () => {
    fetchTagPageData.mockResolvedValue(page([], 'mono-blue'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Blue' }));
    expect(await screen.findByText('No angels commanders in those colors.')).toBeTruthy();
    fetchTagPageData.mockResolvedValue(page());
    fireEvent.click(screen.getByRole('button', { name: 'Clear colors' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
  });

  it('an idea with no commanders at all says so', async () => {
    fetchTagPageData.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText('No angels commanders.')).toBeTruthy();
  });
});

describe('DeckIdeaPage states', () => {
  it('offline', async () => {
    fetchTagPageData.mockResolvedValueOnce(null);
    renderPage();
    expect(await screen.findByText("You're offline.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
  });

  it('error, then retry', async () => {
    fetchTagPageData.mockRejectedValueOnce(new Error('503'));
    renderPage();
    expect(await screen.findByText("Couldn't load the commanders.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
  });

  it('shows placeholders while the page loads', async () => {
    fetchTagPageData.mockReturnValue(pending());
    renderPage();
    expect(await screen.findByText('Loading commanders…')).toBeTruthy();
  });

  it('a tag missing from the snapshot is a not-found with a way back', async () => {
    renderPage('/decks/new/generate/idea/nope?format=commander');
    expect(await screen.findByText("That deck idea isn't on the list.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the generator' }).getAttribute('href')).toBe(
      '/decks/new/generate?format=commander'
    );
    expect(fetchTagPageData).not.toHaveBeenCalled();
  });

  it('the snapshot failing to load says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    );
    renderPage();
    expect(await screen.findByText("Couldn't load the deck ideas.")).toBeTruthy();
  });

  it('another format starts at its own generator', async () => {
    renderPage('/decks/new/generate/idea/angels?format=brawl');
    expect((await handedOff()).at).toBe('/decks/new/generate?format=brawl');
  });
});

describe('DeckIdeaPage hand-off', () => {
  it('Build with a commander lands on the generator with it and its Angels theme', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Build with Giada' }));
    const { at, state } = await handedOff();
    expect(at).toBe('/decks/new/generate?format=commander');
    expect(state.prefill.commander).toMatchObject({ name: 'Giada, Font of Hope' });
    expect(state.prefill.themes).toEqual([
      { name: 'Angels', slug: 'angels', count: 3982, url: '/tags/angels' },
    ]);
    expect(state.prefill.ideaContext).toEqual({
      slug: 'angels',
      name: 'Angels',
      kind: 'typal',
      themeSelected: true,
    });
  });

  it('a commander without that theme builds without one and says so', async () => {
    fetchCommanderThemes.mockResolvedValue([
      { name: 'Lifegain', slug: 'lifegain', count: 1, url: '' },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Build with Kaalia' }));
    const { state } = await handedOff();
    expect(state.prefill.themes).toBeUndefined();
    expect(state.prefill.ideaContext).toMatchObject({ themeSelected: false });
  });

  it('builds without a theme when the theme lookup fails', async () => {
    fetchCommanderThemes.mockRejectedValue(new Error('down'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Build with Giada' }));
    expect((await handedOff()).state.prefill.ideaContext).toMatchObject({ themeSelected: false });
  });

  it('a commander that will not load stays put and says so', async () => {
    getCardByName.mockRejectedValue(new Error('404'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Build with Giada' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't load Giada, Font of Hope. Try again."
    );
    expect(screen.queryByTestId('generator')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Build with Giada' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('Pick a commander for me takes the most built one you own', async () => {
    useCollectionStore.setState({
      cards: [
        { copyId: '1', name: 'Avacyn, Angel of Hope', typeLine: 'Legendary Creature — Angel' },
      ] as EnrichedCard[],
    });
    renderPage();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Pick a commander for me' }));
    expect((await handedOff()).state.prefill.commander).toMatchObject({
      name: 'Avacyn, Angel of Hope',
    });
  });

  it('Pick a commander for me takes the most built overall when you own none', async () => {
    renderPage();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Pick a commander for me' }));
    expect((await handedOff()).state.prefill.commander).toMatchObject({
      name: 'Giada, Font of Hope',
    });
  });
});
