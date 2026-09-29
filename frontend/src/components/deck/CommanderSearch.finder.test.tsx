// @vitest-environment happy-dom
/**
 * The commander finder (T168): one search box and one result list, narrowed by
 * colors, playstyles and "In my collection", ordered by a sort. These drive the
 * real component against mocked EDHREC and Scryfall clients, and a collection
 * fixture shaped like real owned rows (lowercased oracle text, a commander
 * legality), so each path the user reported as unhelpful is exercised:
 * searching rules text, filtering your own commanders without picking a color
 * first, combining a playstyle with colors, and the states around them.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

// ── Collection fixture ──────────────────────────────────────────────────
function owned(
  name: string,
  colorIdentity: string[],
  oracleText: string,
  typeLine = 'Legendary Creature — Human',
  edhrecRank = 500
): EnrichedCard {
  return {
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
    oracleText,
    colorIdentity,
    edhrecRank,
    legalities: { commander: 'legal' },
  } as EnrichedCard;
}

const CHATTERFANG = owned(
  'Chatterfang, Squirrel General',
  ['B', 'G'],
  'if one or more tokens would be created under your control, those tokens plus that many 1/1 green squirrel creature tokens are created instead.\n{b}, sacrifice x squirrels: target creature gets +x/-x until end of turn.',
  'Legendary Creature — Squirrel Warrior',
  40
);
const MEREN = owned(
  'Meren of Clan Nel Toth',
  ['B', 'G'],
  'whenever another creature you control dies, you get an experience counter.',
  'Legendary Creature — Human Shaman',
  60
);
const KRENKO = owned(
  'Krenko, Mob Boss',
  ['R'],
  '{t}: create x 1/1 red goblin creature tokens, where x is the number of goblins you control.',
  'Legendary Creature — Goblin Warrior',
  10
);
const SHEOLDRED = owned(
  'Sheoldred, the Apocalypse',
  ['B'],
  'whenever you draw a card, you gain 2 life.',
  'Legendary Creature — Phyrexian Praetor',
  5
);
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => owned(`Filler ${i}`, ['W'], '', 'Instant'));

let collectionCards: EnrichedCard[] = [];
const noHistory: unknown[] = [];
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: EnrichedCard[]; importHistory: unknown[] }) => unknown) =>
    sel({ cards: collectionCards, importHistory: noHistory }),
}));

// ── EDHREC ──────────────────────────────────────────────────────────────
const top = (name: string, colorIdentity: string[], numDecks: number) => ({
  rank: 1,
  name,
  sanitized: name.toLowerCase().replace(/\W+/g, '-'),
  colorIdentity,
  numDecks,
});
const fetchTopCommanders = vi.fn(async (_colors: string[]) => [
  top('Atraxa, Praetors’ Voice', ['W', 'U', 'B', 'G'], 42000),
  top('Krenko, Mob Boss', ['R'], 3390),
]);
const fetchCommandersWithinColors = vi.fn(async (_colors: string[]) => [
  top('Meren of Clan Nel Toth', ['B', 'G'], 15600),
]);
const fetchPlaystyleCommanders = vi.fn(async (_slug: string) => [
  top('Teysa Karlov', ['W', 'B'], 20000),
]);
const fetchCommanderData = vi.fn(async (_name: string) => ({
  cardlists: { allNonLand: [{ name: 'Sol Ring' }, { name: 'Goblin Bombardment' }] },
}));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchTopCommanders: (c: string[]) => fetchTopCommanders(c),
  fetchCommandersWithinColors: (c: string[]) => fetchCommandersWithinColors(c),
  fetchAllCommanderNames: vi.fn(async () => ['Krenko, Mob Boss']),
  fetchCommanderData: (n: string) => fetchCommanderData(n),
  fetchPlaystyleCommanders: (s: string) => fetchPlaystyleCommanders(s),
}));

// ── Scryfall ────────────────────────────────────────────────────────────
function card(
  name: string,
  colors: string[],
  oracle: string,
  typeLine = 'Legendary Creature'
): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `o-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    color_identity: colors,
    cmc: 3,
    edhrec_rank: 100,
    keywords: [],
    prices: {},
    legalities: { commander: 'legal' },
  } as unknown as ScryfallCard;
}
const JARAD = card(
  'Jarad, Golgari Lich Lord',
  ['B', 'G'],
  '{1}{B}{G}, Sacrifice another creature: Each opponent loses life equal to the sacrificed creature’s power.'
);
const searchCommanderFinder = vi.fn(async (_q: string, _o?: { pdh?: boolean }) => ({
  cards: [JARAD],
  total: 31,
}));
const getCardByName = vi.fn(async (name: string) => card(name, ['R'], ''));
const getOwnedPrinting = vi.fn(async (_id: string, name: string) => card(name, ['B', 'G'], ''));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  commanderFinderSupportsRegex: () => true,
  searchCommanderFinder: (q: string, o?: { pdh?: boolean }) => searchCommanderFinder(q, o),
  getCardByName: (n: string) => getCardByName(n),
  getOwnedPrinting: (id: string, n: string) => getOwnedPrinting(id, n),
  getCardPrice: () => '2.40',
}));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStatsBatch: vi.fn(async () => new Map()),
}));

import { CommanderSearch } from './CommanderSearch';

const type = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: /^search/i }), {
    target: { value: text },
  });

const results = () =>
  [...document.querySelectorAll('.commander-result-card .commander-result-name')].map(
    (n) => n.textContent
  );

beforeEach(() => {
  localStorage.clear();
  collectionCards = [];
  vi.clearAllMocks();
});

describe('browsing with nothing typed', () => {
  it("shows EDHREC's popular commanders with their deck counts", async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    await screen.findByText('Krenko, Mob Boss');
    expect(screen.getByRole('status').textContent).toContain('Popular commanders on EDHREC');
    expect(screen.getByText('42k decks')).toBeTruthy();
    expect(screen.getByText('3.4k decks')).toBeTruthy();
    expect(searchCommanderFinder).not.toHaveBeenCalled();
  });

  it('switches the popular list with the color mode', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    await screen.findByText('Krenko, Mob Boss');
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    await waitFor(() => expect(fetchTopCommanders).toHaveBeenLastCalledWith(['B', 'G']));
    expect(screen.getByText('Black-green commanders only')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Within' }));
    await screen.findByText('Meren of Clan Nel Toth');
    expect(fetchCommandersWithinColors).toHaveBeenCalledWith(['B', 'G']);
    expect(screen.getByText('Anything you can play in black-green')).toBeTruthy();
  });

  it('offers a retry when EDHREC is unreachable, not an empty result', async () => {
    fetchTopCommanders.mockRejectedValueOnce(new Error('down'));
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't reach EDHREC");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByText('Krenko, Mob Boss');
  });
});

describe('searching every commander', () => {
  it('searches rules text for plain words and quotes the sentence that matched', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    type('sacrifice');
    await screen.findByText('Jarad, Golgari Lich Lord');
    expect(searchCommanderFinder).toHaveBeenCalledWith(
      '((sacrifice) OR t:"sacrifice" OR o:"sacrifice")',
      { pdh: false }
    );
    const reason = document.querySelector('.commander-result-reason')!;
    expect(reason.textContent).toMatch(/^Rules text: /);
    expect(reason.querySelector('mark')!.textContent).toBe('Sacrifice');
    expect(screen.getByRole('status').textContent).toContain('31 commanders');
  });

  it('combines a playstyle with colors and says what the playstyle means', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aristocrats' }));
    await waitFor(() => expect(searchCommanderFinder).toHaveBeenCalled());
    const [q] = searchCommanderFinder.mock.calls.at(-1)!;
    expect(q.startsWith('id=b o:/')).toBe(true);
    expect(screen.getByText(/Sacrifice creatures for value/)).toBeTruthy();
    // EDHREC's crowd list for the tag rides along; Teysa is W/B, outside
    // mono-black, so it stays out.
    expect(fetchPlaystyleCommanders).toHaveBeenCalledWith('aristocrats');
    await screen.findByText('Jarad, Golgari Lich Lord');
    expect(screen.queryByText('Teysa Karlov')).toBeNull();
  });

  it('marks a result you already own', async () => {
    collectionCards = [owned('Jarad, Golgari Lich Lord', ['B', 'G'], 'sac')];
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /^All commanders/ }));
    type('sacrifice');
    await screen.findByText('Jarad, Golgari Lich Lord');
    expect(screen.getByText('In collection')).toBeTruthy();
  });

  it('shows a search failure with a retry', async () => {
    searchCommanderFinder.mockRejectedValueOnce(new Error("Couldn't reach Scryfall."));
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    type('dragons');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't reach Scryfall.");
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('searches uncommon creatures for Pauper Commander, with no EDHREC surfaces', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} format="paupercommander" />);
    await waitFor(() => expect(searchCommanderFinder).toHaveBeenCalledWith('', { pdh: true }));
    expect(fetchTopCommanders).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /search uncommon creatures/i })).toBeTruthy();
  });
});

describe('your own commanders', () => {
  beforeEach(() => {
    collectionCards = [CHATTERFANG, MEREN, KRENKO, SHEOLDRED, ...filler(20)];
    localStorage.setItem('commander-search-owned-only', 'true');
  });

  it('lists every commander you own at once, with no color picked', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(results()).toHaveLength(4));
    expect(screen.getByRole('status').textContent).toContain('4 commanders you own');
    // Popular first, from the EDHREC rank each owned row carries.
    expect(results()[0]).toBe('Sheoldred, the Apocalypse');
    expect(searchCommanderFinder).not.toHaveBeenCalled();
  });

  it("searches your commanders' rules text locally", async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    type('squirrels');
    await waitFor(() => expect(results()).toEqual(['Chatterfang, Squirrel General']));
    expect(searchCommanderFinder).not.toHaveBeenCalled();
  });

  it('filters by exact colors and by playstyle', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Black' }));
    await waitFor(() => expect(results()).toEqual(['Sheoldred, the Apocalypse']));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    await waitFor(() => expect(results()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Tokens' }));
    await waitFor(() => expect(results()).toEqual(['Chatterfang, Squirrel General']));
  });

  it('names the filter to drop when nothing matches, and drops it', async () => {
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'White' }));
    await screen.findByText('None of your commanders match these filters.');
    fireEvent.click(screen.getByRole('button', { name: 'Search all commanders' }));
    await waitFor(() => expect(fetchTopCommanders).toHaveBeenCalledWith(['W']));
  });

  it('picks the exact printing you own', async () => {
    const onSelect = vi.fn();
    render(<CommanderSearch value={null} onSelect={onSelect} />);
    fireEvent.click(await screen.findByText('Meren of Clan Nel Toth'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(getOwnedPrinting).toHaveBeenCalledWith(
      's-Meren of Clan Nel Toth',
      'Meren of Clan Nel Toth'
    );
  });
});

describe('the "From my collection" door', () => {
  it('opens on your commanders by coverage, and a pick builds from your cards', async () => {
    collectionCards = [CHATTERFANG, MEREN, ...filler(20)];
    const onSelect = vi.fn();
    const onSelectFromBinder = vi.fn();
    render(
      <CommanderSearch
        value={null}
        onSelect={onSelect}
        onSelectFromBinder={onSelectFromBinder}
        initialSearchMode="binder"
      />
    );
    expect(await screen.findByText(/builds with only your cards/)).toBeTruthy();
    await waitFor(() =>
      expect(fetchCommanderData).toHaveBeenCalledWith('Chatterfang, Squirrel General')
    );
    expect((await screen.findAllByText(/You own \d+ of its \d+ staples/)).length).toBeGreaterThan(
      0
    );
    fireEvent.click(screen.getByText('Chatterfang, Squirrel General'));
    await waitFor(() => expect(onSelectFromBinder).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('readiness', () => {
  it('measures nothing when the collection is too small to say anything', async () => {
    collectionCards = [KRENKO];
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /^All commanders/ }));
    await screen.findByText('Atraxa, Praetors’ Voice');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(fetchCommanderData).not.toHaveBeenCalled();
    expect(screen.queryByText(/You own \d+%/)).toBeNull();
  });

  it('scores the visible commanders against a real collection', async () => {
    collectionCards = [KRENKO, ...filler(20)];
    render(<CommanderSearch value={null} onSelect={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /^All commanders/ }));
    await screen.findByText('Atraxa, Praetors’ Voice');
    await waitFor(() => expect(fetchCommanderData).toHaveBeenCalled());
    expect((await screen.findAllByText(/You own \d+%/)).length).toBeGreaterThan(0);
  });
});

describe('the picked commander', () => {
  it('shows the commander with how it plays, and Change clears it', () => {
    const onSelect = vi.fn();
    render(
      <CommanderSearch
        value={card(
          'Krenko, Mob Boss',
          ['R'],
          '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
          'Legendary Creature — Goblin Warrior'
        )}
        onSelect={onSelect}
      />
    );
    expect(screen.getByText('Plays like')).toBeTruthy();
    expect(screen.getByText('Tokens')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
