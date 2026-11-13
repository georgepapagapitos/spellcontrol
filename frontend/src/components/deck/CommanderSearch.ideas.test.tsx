// @vitest-environment happy-dom
/**
 * The finder's generator layout (E1113): an idea is a filter on the one commander grid. These drive
 * the real component against a mocked EDHREC tag page and the idea snapshot: the build-around rows
 * with nothing applied, the idea chip and its strip, every shared filter applying under an idea,
 * the all-colors fallback, and the hand-off a pick makes.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EDHRECTopCommander, ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

const legend = (name: string, colorIdentity: string[], typeLine: string): EnrichedCard =>
  ({
    copyId: `c-${name}`,
    name,
    scryfallId: `s-${name}`,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'nonfoil',
    foil: false,
    typeLine,
    oracleText: '',
    colorIdentity,
    edhrecRank: 500,
    legalities: { commander: 'legal' },
  }) as EnrichedCard;

let collectionCards: EnrichedCard[] = [];
const noHistory: unknown[] = [];
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: EnrichedCard[]; importHistory: unknown[] }) => unknown) =>
    sel({ cards: collectionCards, importHistory: noHistory }),
}));

const top = (name: string, colorIdentity: string[], numDecks: number): EDHRECTopCommander => ({
  rank: 1,
  name,
  sanitized: name.toLowerCase().replace(/\W+/g, '-'),
  colorIdentity,
  numDecks,
});
const ANGELS = [
  top('Giada, Font of Hope', ['W'], 3982),
  top('Kaalia of the Vast', ['W', 'B', 'R'], 1483),
  top('Avacyn, Angel of Hope', ['W'], 274),
  top('Shilgengar, Sire of Famine', ['B'], 938),
];
const tagPage = (commanders = ANGELS, colorSlug: string | null = null) => ({
  commanders,
  cardlists: {},
  potentialDecks: 0,
  highSynergyNames: [],
  colorSlug,
});
const fetchTagPageData = vi.fn(async (_slug: string, _colors?: string[], _limit?: number) =>
  tagPage()
);
const fetchCommanderThemes = vi.fn(async (_name: string) => [
  { name: 'Angels', slug: 'angels', count: 3982, url: '' },
  { name: 'Lifegain', slug: 'lifegain', count: 900, url: '' },
  { name: 'Tokens', slug: 'tokens', count: 300, url: '' },
]);
const fetchTopCommanders = vi.fn(async (_c: string[]) => [top('Krenko, Mob Boss', ['R'], 3390)]);
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchTopCommanders: (c: string[]) => fetchTopCommanders(c),
  fetchCommandersWithinColors: async () => [],
  fetchAllCommanderNames: async () => ['Krenko, Mob Boss', 'Giada, Font of Hope'],
  fetchCommanderData: async () => null,
  fetchPlaystyleCommanders: async () => [],
  isPoolTooThin: () => false,
  fetchTagPageData: (s: string, c?: string[], l?: number) => fetchTagPageData(s, c, l),
  fetchCommanderThemes: (n: string) => fetchCommanderThemes(n),
  backfillColorIdentities: async (c: unknown) => c,
}));

const card = (name: string): ScryfallCard =>
  ({
    id: `id-${name}`,
    oracle_id: `o-${name}`,
    name,
    type_line: 'Legendary Creature',
    color_identity: ['W'],
    cmc: 3,
    keywords: [],
    prices: {},
    legalities: { commander: 'legal' },
  }) as unknown as ScryfallCard;
const searchCommanderFinder = vi.fn(async () => ({ cards: [], total: 0 }));
const getCardByName = vi.fn(async (name: string) => card(name));
const getOwnedPrinting = vi.fn(async (_id: string, name: string) => card(name));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  commanderFinderSupportsRegex: () => true,
  searchCommanderFinder: () => searchCommanderFinder(),
  getCardByName: (n: string) => getCardByName(n),
  getOwnedPrinting: (id: string, n: string) => getOwnedPrinting(id, n),
  getCommanderPrinting: (n: string, o?: { scryfallId: string; name: string }) =>
    o ? getOwnedPrinting(o.scryfallId, o.name) : getCardByName(n),
  getCardPrice: () => '2.40',
  getGameChangerNames: async () => new Set<string>(),
  getCardsByNames: async () => new Map(),
}));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStatsBatch: vi.fn(async () => new Map()),
}));

import { __resetIdeaIndexForTests } from '@/lib/deck/idea-index';
import { CommanderSearch } from './CommanderSearch';

const idea = (slug: string, name: string, kind: string, decks: number, type?: string) => ({
  slug,
  name,
  kind,
  type,
  decks,
  commanders: 24,
  card: 'Giada',
});
const SNAPSHOT = {
  generatedAt: '2026-11-10T00:00:00.000Z',
  aliases: {},
  ideas: [
    idea('tokens', 'Tokens', 'playstyle', 208753),
    idea('angels', 'Angels', 'typal', 10806, 'Angel'),
    idea('lifegain', 'Lifegain', 'playstyle', 60000),
    ...Array.from({ length: 8 }, (_, i) =>
      idea(`type-${i}`, `Type${i}`, 'typal', 100 - i, `T${i}`)
    ),
  ],
};

const finder = (over: Partial<Parameters<typeof CommanderSearch>[0]> = {}) => {
  const onPickWithIdea = vi.fn(async () => {});
  const onSelect = vi.fn();
  render(
    <CommanderSearch value={null} onSelect={onSelect} ideaFinder={{ onPickWithIdea }} {...over} />
  );
  return { onPickWithIdea, onSelect };
};
const box = () => screen.getByRole('combobox');
const applyAngels = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Angels/ }));
  await screen.findByText('Giada, Font of Hope');
};
const names = () =>
  [...document.querySelectorAll('.commander-result-card .commander-result-name')].map(
    (n) => n.textContent
  );

beforeEach(() => {
  localStorage.clear();
  collectionCards = [];
  vi.clearAllMocks();
  __resetIdeaIndexForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('idea-index') ? new Response(JSON.stringify(SNAPSHOT)) : new Response('{}')
    )
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('nothing applied', () => {
  it('shows build-around rows in place of the playstyle chips', async () => {
    finder();
    expect(await screen.findByRole('group', { name: 'Creature types' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Ways to play' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Playstyle' })).toBeNull();
    expect(box().getAttribute('placeholder')).toBe('Commander, creature type or theme');
    // Seven shown, the rest behind "All N".
    const types = screen.getByRole('group', { name: 'Creature types' });
    expect(within(types).getAllByRole('listitem')).toHaveLength(7);
    fireEvent.click(within(types).getByRole('button', { name: 'All 9' }));
    expect(within(types).getAllByRole('listitem')).toHaveLength(9);
  });

  it('offers "From your cards" only when the collection holds enough of a type', async () => {
    finder();
    await screen.findByRole('group', { name: 'Creature types' });
    expect(screen.queryByRole('group', { name: 'From your cards' })).toBeNull();
  });

  it('lists the most built commanders as before', async () => {
    finder();
    await screen.findByText('Krenko, Mob Boss');
    expect(fetchTagPageData).not.toHaveBeenCalled();
  });

  it('the plain finder (no idea layout) keeps its playstyle chips and never loads the idea list', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    await screen.findByText('Krenko, Mob Boss');
    expect(screen.getByRole('group', { name: 'Playstyle' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Creature types' })).toBeNull();
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
        String(c[0]).includes('idea-index')
      )
    ).toBe(false);
  });
});

describe('an idea applied', () => {
  it('puts a chip in the box, swaps the grid to the idea list and shows the strip', async () => {
    finder();
    await applyAngels();
    expect(fetchTagPageData).toHaveBeenCalledWith('angels', [], Infinity);
    expect(screen.getByRole('button', { name: 'Remove Angels' })).toBeTruthy();
    expect(box().getAttribute('placeholder')).toBe('Narrow by name');
    expect(screen.getByText('4k decks')).toBeTruthy();
    expect(screen.getByText(/11k decks across 24 commanders/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Commanders that lead angels' })).toBeTruthy();
    // The rows give way to the strip.
    expect(screen.queryByRole('group', { name: 'Creature types' })).toBeNull();
  });

  it('"Pairs well with" comes from the leaders\' own themes and applies as the idea', async () => {
    finder();
    await applyAngels();
    const pairs = await screen.findByRole('group', { name: 'Pairs well with' });
    expect(within(pairs).getByRole('button', { name: 'Lifegain' })).toBeTruthy();
    expect(within(pairs).queryByRole('button', { name: 'Angels' })).toBeNull();
    fireEvent.click(within(pairs).getByRole('button', { name: 'Lifegain' }));
    await waitFor(() => expect(fetchTagPageData).toHaveBeenCalledWith('lifegain', [], Infinity));
  });

  it('removing the chip goes back to the rows and the popular list', async () => {
    finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Angels' }));
    await screen.findByText('Krenko, Mob Boss');
    expect(screen.getByRole('group', { name: 'Creature types' })).toBeTruthy();
  });

  it('applies the ?idea= link once the list has loaded, and ignores a slug it does not know', async () => {
    finder({ ideaFinder: { initialSlug: 'angels', onPickWithIdea: vi.fn(async () => {}) } });
    await screen.findByRole('button', { name: 'Remove Angels' });
    expect(fetchTagPageData).toHaveBeenCalledWith('angels', [], Infinity);
  });

  it('ignores an unknown ?idea= slug', async () => {
    finder({ ideaFinder: { initialSlug: 'nope', onPickWithIdea: vi.fn(async () => {}) } });
    await screen.findByRole('group', { name: 'Creature types' });
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('typing suggests an idea; typed text under a chip only narrows by name', async () => {
    finder();
    await screen.findByRole('group', { name: 'Creature types' });
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'angel' } });
    const option = await screen.findByRole('option', { name: /Angels/ });
    fireEvent.mouseDown(option);
    await screen.findByText('Giada, Font of Hope');
    fireEvent.change(box(), { target: { value: 'kaal' } });
    await waitFor(() => expect(names()).toEqual(['Kaalia of the Vast']));
    expect(searchCommanderFinder).not.toHaveBeenCalled();
  });

  it('every filter applies under an idea: color exact asks EDHREC, within filters locally', async () => {
    finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('button', { name: 'White' }));
    // Within is the default reading: the full list is filtered here.
    await waitFor(() => expect(names()).toEqual(['Giada, Font of Hope', 'Avacyn, Angel of Hope']));
    fireEvent.click(screen.getByRole('radio', { name: 'Exactly these' }));
    await waitFor(() =>
      expect(fetchTagPageData).toHaveBeenLastCalledWith('angels', ['W'], Infinity)
    );
  });

  it('says so when EDHREC has no page in those colors and shows every color', async () => {
    fetchTagPageData.mockImplementation(async (_s, colors = []) =>
      tagPage(ANGELS, colors.length > 0 ? null : null)
    );
    finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Exactly these' }));
    const note = await screen.findByText(/has no mono-black list for angels/i);
    expect(note.textContent).toContain('Showing every color');
    expect(names()).toHaveLength(4);
  });

  it('Mine shows the idea commanders you own', async () => {
    collectionCards = [legend('Avacyn, Angel of Hope', ['W'], 'Legendary Creature — Angel')];
    finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('radio', { name: /Mine/ }));
    await waitFor(() => expect(names()).toEqual(['Avacyn, Angel of Hope']));
  });

  it('names the empty result and the filter to drop', async () => {
    collectionCards = [
      legend('Sol Ring', ['C'], 'Artifact'),
      legend('Lyra Dawnbringer', ['W'], 'Legendary Creature — Angel'),
    ];
    finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('radio', { name: /Mine/ }));
    await screen.findByText('No angels commanders match these filters.');
    expect(screen.getByRole('button', { name: 'Search all commanders' })).toBeTruthy();
  });

  it('offers a retry when the idea list cannot load', async () => {
    fetchTagPageData.mockRejectedValueOnce(new Error('down'));
    finder();
    await screen.findByRole('group', { name: 'Creature types' });
    fireEvent.click(screen.getByRole('button', { name: /Angels/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't reach EDHREC for this idea's commanders");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByText('Giada, Font of Hope');
  });

  it('is offline-honest: no tag page data reads as an error, not an empty list', async () => {
    fetchTagPageData.mockResolvedValueOnce(null as never);
    finder();
    await screen.findByRole('group', { name: 'Creature types' });
    fireEvent.click(screen.getByRole('button', { name: /Angels/ }));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't reach EDHREC");
  });
});

describe('picking under an idea', () => {
  it('hands the card, the idea and its deck count to the caller, not to onSelect', async () => {
    const { onPickWithIdea, onSelect } = finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('button', { name: /Giada, Font of Hope/ }));
    await waitFor(() => expect(onPickWithIdea).toHaveBeenCalledTimes(1));
    const [picked, picketIdea, decks] = onPickWithIdea.mock.calls[0] as unknown as [
      ScryfallCard,
      { slug: string },
      number,
    ];
    expect(picked.name).toBe('Giada, Font of Hope');
    expect(picketIdea.slug).toBe('angels');
    expect(decks).toBe(3982);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('"Pick one for me" takes the most built commander you own, else the most built', async () => {
    collectionCards = [legend('Avacyn, Angel of Hope', ['W'], 'Legendary Creature — Angel')];
    const { onPickWithIdea } = finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('button', { name: 'Pick one for me' }));
    await waitFor(() => expect(onPickWithIdea).toHaveBeenCalledTimes(1));
    expect((onPickWithIdea.mock.calls[0] as unknown as [ScryfallCard])[0].name).toBe(
      'Avacyn, Angel of Hope'
    );
    expect(getOwnedPrinting).toHaveBeenCalled();
  });

  it('"Pick one for me" with nothing owned takes the most built', async () => {
    const { onPickWithIdea } = finder();
    await applyAngels();
    fireEvent.click(screen.getByRole('button', { name: 'Pick one for me' }));
    await waitFor(() => expect(onPickWithIdea).toHaveBeenCalledTimes(1));
    expect((onPickWithIdea.mock.calls[0] as unknown as [ScryfallCard])[0].name).toBe(
      'Giada, Font of Hope'
    );
  });

  it('a commander picked from the suggestions under an idea also carries the idea', async () => {
    const { onPickWithIdea } = finder();
    await applyAngels();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'krenko' } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Krenko/ }));
    await waitFor(() => expect(onPickWithIdea).toHaveBeenCalledTimes(1));
  });

  it('a typed suggestion for a commander you own picks the printing you own', async () => {
    const mine = legend('Krenko, Mob Boss', ['R'], 'Legendary Creature — Goblin');
    collectionCards = [mine];
    const { onSelect } = finder();
    await screen.findByRole('group', { name: 'Creature types' });
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'krenko' } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Krenko/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(getOwnedPrinting).toHaveBeenCalledWith(mine.scryfallId, 'Krenko, Mob Boss');
    // The card handed on is the owned printing, not a by-name lookup.
    expect(onSelect.mock.calls[0][0]).toBe(await getOwnedPrinting.mock.results[0].value);
  });

  it('Enter with nothing highlighted does not choose for the player', async () => {
    const { onPickWithIdea } = finder();
    await screen.findByRole('group', { name: 'Creature types' });
    fireEvent.change(box(), { target: { value: 'angel' } });
    await screen.findByRole('option', { name: /Angels/ });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.queryByRole('button', { name: 'Remove Angels' })).toBeNull();
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    await screen.findByRole('button', { name: 'Remove Angels' });
    expect(onPickWithIdea).not.toHaveBeenCalled();
  });

  it('Backspace in an empty box removes the chip', async () => {
    finder();
    await applyAngels();
    fireEvent.keyDown(box(), { key: 'Backspace' });
    await screen.findByRole('group', { name: 'Creature types' });
  });
});

describe('a chosen commander', () => {
  it('collapses to one summary row; Change commander clears the pick', () => {
    const onSelect = vi.fn();
    render(
      <CommanderSearch
        value={card('Giada, Font of Hope')}
        onSelect={onSelect}
        ideaFinder={{
          onPickWithIdea: vi.fn(async () => {}),
          selectedNote: 'From the Angels idea · 3,982 decks',
        }}
      />
    );
    expect(screen.getByText('From the Angels idea · 3,982 decks')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change commander' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
