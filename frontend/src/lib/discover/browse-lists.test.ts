import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const h = vi.hoisted(() => ({
  fetchEdhrecTop: vi.fn(),
  searchCards: vi.fn(),
  searchCardsLive: vi.fn(),
}));

vi.mock('./edhrec-top', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./edhrec-top')>()),
  fetchEdhrecTop: h.fetchEdhrecTop,
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: h.searchCards,
  searchCardsLive: h.searchCardsLive,
}));

import {
  BROWSE_LISTS,
  DEFAULT_BROWSE_FILTERS,
  browseFiltersToParams,
  browseListDef,
  effectivePeriod,
  isOwnedName,
  loadBrowseList,
  ownedNameSet,
  parseBrowseFilters,
  periodLocked,
} from './browse-lists';

const card = (name: string, extra: Partial<ScryfallCard> = {}) =>
  ({ id: name, name, released_at: '2026-08-14', ...extra }) as ScryfallCard;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 29, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the browse lists', () => {
  it('are the six lists the Search landing shows, in its order', () => {
    expect(BROWSE_LISTS.map((l) => l.id)).toEqual([
      'commanders',
      'new-commanders',
      'cards',
      'game-changers',
      'salt',
      'banned',
    ]);
    expect(browseListDef('salt')?.title).toBe('Saltiest cards');
    expect(browseListDef('nope')).toBeUndefined();
    expect(browseListDef(undefined)).toBeUndefined();
  });
});

describe('list filters in the URL', () => {
  const cards = browseListDef('cards')!;
  const commanders = browseListDef('commanders')!;
  const salt = browseListDef('salt')!;

  it('reads what the list offers', () => {
    const f = parseBrowseFilters(
      new URLSearchParams('period=month&colors=gu&type=creatures&show=owned'),
      cards
    );
    expect(f).toEqual({ period: 'month', colors: 'UG', type: 'creatures', ownedOnly: true });
  });

  it("drops what the list doesn't offer or doesn't know", () => {
    expect(
      parseBrowseFilters(new URLSearchParams('period=decade&type=creatures'), commanders)
    ).toEqual(DEFAULT_BROWSE_FILTERS);
    expect(parseBrowseFilters(new URLSearchParams('type=tribal'), cards).type).toBe('');
    expect(parseBrowseFilters(new URLSearchParams('period=month&colors=W'), salt)).toEqual(
      DEFAULT_BROWSE_FILTERS
    );
  });

  it('writes only what differs from the defaults', () => {
    expect(browseFiltersToParams(DEFAULT_BROWSE_FILTERS)).toEqual({});
    expect(
      browseFiltersToParams({ period: 'year', colors: 'C', type: 'lands', ownedOnly: true })
    ).toEqual({ period: 'year', colors: 'C', type: 'lands', show: 'owned' });
  });

  it('locks the window to 2 years under a color or type', () => {
    const week = { ...DEFAULT_BROWSE_FILTERS };
    expect(periodLocked(week)).toBe(false);
    expect(effectivePeriod(week)).toBe('week');
    expect(effectivePeriod({ ...week, colors: 'R' })).toBe('year');
    expect(effectivePeriod({ ...week, type: 'instants' })).toBe('year');
  });
});

describe('loadBrowseList', () => {
  const provenance = { fetchedAt: 5, stale: true, sourceUrl: 'https://edhrec.com/commanders/week' };

  it("reads EDHREC's commanders from our backend, leaving out partner pairs", async () => {
    h.fetchEdhrecTop.mockResolvedValue({
      entries: [
        { name: 'Kraum // Tymna', numDecks: 900, potentialDecks: null, salt: null },
        { name: 'Ygra, Eater of All', numDecks: 800, potentialDecks: null, salt: null },
      ],
      ...provenance,
    });

    const page = await loadBrowseList('commanders');

    expect(h.fetchEdhrecTop).toHaveBeenCalledWith({
      kind: 'commanders',
      period: 'week',
      colors: '',
      type: undefined,
    });
    expect(page.items.map((i) => i.name)).toEqual(['Ygra, Eater of All']);
    expect(page.items[0].numDecks).toBe(800);
    expect(page.edhrec).toEqual(provenance);
    expect(page.hasMore).toBe(false);
  });

  it('keeps a split card on the cards list and passes the filters through', async () => {
    h.fetchEdhrecTop.mockResolvedValue({
      entries: [{ name: 'Wear // Tear', numDecks: 5, potentialDecks: 10, salt: null }],
      ...provenance,
    });

    const page = await loadBrowseList('cards', {
      period: 'month',
      colors: 'RW',
      type: 'instants',
      ownedOnly: true,
    });

    expect(h.fetchEdhrecTop).toHaveBeenCalledWith({
      kind: 'cards',
      period: 'year',
      colors: 'RW',
      type: 'instants',
    });
    expect(page.items[0]).toMatchObject({ name: 'Wear // Tear', potentialDecks: 10 });
  });

  it('carries the salt score', async () => {
    h.fetchEdhrecTop.mockResolvedValue({
      entries: [{ name: 'Stasis', numDecks: 1, potentialDecks: null, salt: 3.06 }],
      ...provenance,
    });
    expect((await loadBrowseList('salt')).items[0].salt).toBe(3.06);
    expect(h.fetchEdhrecTop).toHaveBeenCalledWith(expect.objectContaining({ kind: 'salt' }));
  });

  it('pages through first printings of commanders released by today, newest first', async () => {
    h.searchCardsLive.mockResolvedValue({ data: [card('Smaug the Magnificent')], has_more: true });

    const page = await loadBrowseList('new-commanders', DEFAULT_BROWSE_FILTERS, 2);

    expect(h.searchCardsLive).toHaveBeenCalledWith(
      'is:commander not:reprint date<=2026-09-29',
      [],
      { order: 'released', page: 2 }
    );
    expect(page.items[0]).toMatchObject({
      name: 'Smaug the Magnificent',
      releasedAt: '2026-08-14',
    });
    expect(page.items[0].card?.name).toBe('Smaug the Magnificent');
    expect(page.hasMore).toBe(true);
  });

  it('asks Scryfall for Game Changers in popularity order', async () => {
    h.searchCards.mockResolvedValue({ data: [card('Rhystic Study')], has_more: false });
    const page = await loadBrowseList('game-changers');
    expect(h.searchCards).toHaveBeenCalledWith('is:gamechanger', [], { order: 'edhrec' });
    expect(page.items.map((i) => i.name)).toEqual(['Rhystic Study']);
  });

  it('asks for the ban list without the Commander legality filter, which would hide it', async () => {
    h.searchCards.mockResolvedValue({ data: [card('Griselbrand')], has_more: false });
    await loadBrowseList('banned');
    expect(h.searchCards).toHaveBeenCalledWith('banned:commander', [], {
      order: 'edhrec',
      skipFormatFilter: true,
    });
  });
});

describe('owned names', () => {
  it('match a double-faced card by its front face as EDHREC names it', () => {
    const owned = ownedNameSet([
      { name: 'Esika, God of the Tree // The Prismatic Bridge' },
      { name: 'Sol Ring' },
    ]);
    expect(isOwnedName(owned, 'Esika, God of the Tree')).toBe(true);
    expect(isOwnedName(owned, 'sol ring')).toBe(true);
    expect(isOwnedName(owned, 'Arcane Signet')).toBe(false);
  });

  it('match a full double-faced name against a front-face copy', () => {
    const owned = ownedNameSet([{ name: 'Esika, God of the Tree' }]);
    expect(isOwnedName(owned, 'Esika, God of the Tree // The Prismatic Bridge')).toBe(true);
  });
});
