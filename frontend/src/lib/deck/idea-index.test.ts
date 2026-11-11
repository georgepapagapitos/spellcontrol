// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetIdeaIndexForTests,
  collectionCouldBuild,
  findIdea,
  ideaBlurb,
  ideaKindLabel,
  loadIdeaIndex,
  matchCommanderNames,
  nearestIdeas,
  normalizeQuery,
  ownedTypeCounts,
  parseIdeaIndex,
  searchIdeas,
  shortCommanderName,
  useIdeaIndex,
  type IdeaIndex,
} from './idea-index';

const RAW = {
  generatedAt: '2026-11-10T00:00:00.000Z',
  aliases: {
    aristocrats: ['sac', 'death triggers'],
    tokens: ['go wide'],
    'extra-turns': ['time travel'],
  },
  ideas: [
    {
      slug: 'tokens',
      name: 'Tokens',
      kind: 'playstyle',
      decks: 208753,
      commanders: 23,
      card: 'Baylen',
    },
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
      slug: 'aristocrats',
      name: 'Aristocrats',
      kind: 'playstyle',
      decks: 69240,
      commanders: 24,
      card: 'Teysa',
    },
    {
      slug: 'elves',
      name: 'Elves',
      kind: 'typal',
      type: 'Elf',
      decks: 16158,
      commanders: 24,
      card: 'Lathril',
    },
    {
      slug: 'time-lords',
      name: 'Time Lords',
      kind: 'typal',
      type: 'Time Lord',
      decks: 503,
      commanders: 6,
      card: 'The Doctor',
    },
    {
      slug: 'time-counters',
      name: 'Time Counters',
      kind: 'playstyle',
      decks: 1018,
      commanders: 9,
      card: 'Z',
    },
    {
      slug: 'extra-turns',
      name: 'Extra Turns',
      kind: 'playstyle',
      decks: 10853,
      commanders: 24,
      card: 'Y',
    },
    {
      slug: 'plus-1-plus-1-counters',
      name: '+1/+1 Counters',
      kind: 'playstyle',
      decks: 168483,
      commanders: 24,
      card: 'X',
    },
  ],
};
const index = parseIdeaIndex(RAW) as IdeaIndex;
const names = (ideas: { name: string }[]) => ideas.map((i) => i.name);

afterEach(() => {
  vi.unstubAllGlobals();
  __resetIdeaIndexForTests();
});

describe('parseIdeaIndex', () => {
  it('reads a snapshot and drops malformed rows', () => {
    const parsed = parseIdeaIndex({ ...RAW, ideas: [...RAW.ideas, { slug: 1 }, null] });
    expect(parsed?.ideas).toHaveLength(RAW.ideas.length);
    expect(parsed?.aliases.tokens).toEqual(['go wide']);
  });
  it('refuses what is not a snapshot', () => {
    expect(parseIdeaIndex(null)).toBeNull();
    expect(parseIdeaIndex({ ideas: [] })).toBeNull();
    expect(parseIdeaIndex({ ideas: 'x' })).toBeNull();
  });
  it('tolerates a missing aliases table and stamp', () => {
    const parsed = parseIdeaIndex({ ideas: RAW.ideas });
    expect(parsed?.aliases).toEqual({});
    expect(parsed?.generatedAt).toBe('');
  });
});

describe('searchIdeas', () => {
  it('finds by prefix, most built first among equals', () => {
    expect(names(searchIdeas(index, 'ang'))).toEqual(['Angels']);
    expect(names(searchIdeas(index, 'time'))).toEqual([
      'Extra Turns',
      'Time Counters',
      'Time Lords',
    ]);
  });
  it('finds a plural idea by its singular type', () => {
    expect(names(searchIdeas(index, 'elf'))).toEqual(['Elves']);
    expect(names(searchIdeas(index, 'angel'))).toEqual(['Angels']);
  });
  it('finds by alias', () => {
    expect(names(searchIdeas(index, 'sac'))).toEqual(['Aristocrats']);
    expect(names(searchIdeas(index, 'Go Wide'))).toEqual(['Tokens']);
    expect(names(searchIdeas(index, '+1/+1'))).toEqual(['+1/+1 Counters']);
  });
  it('matches every word of a multi-word query', () => {
    expect(names(searchIdeas(index, 'lords time'))).toEqual(['Time Lords']);
  });
  it('is empty for blank text and for nonsense', () => {
    expect(searchIdeas(index, '   ')).toEqual([]);
    expect(searchIdeas(index, 'zzzz')).toEqual([]);
  });
  it('folds case, accents and apostrophes', () => {
    expect(normalizeQuery("  Ångels'  ")).toBe('angels');
  });
});

describe('nearestIdeas', () => {
  it('lists ideas sharing words with the query', () => {
    const { ideas, fallback } = nearestIdeas(index, 'time travel');
    expect(fallback).toBe(false);
    expect(names(ideas)[0]).toBe('Extra Turns');
    expect(names(ideas)).toEqual(expect.arrayContaining(['Time Lords', 'Time Counters']));
  });
  it('falls back to the most built ideas when nothing overlaps', () => {
    const { ideas, fallback } = nearestIdeas(index, 'qqq');
    expect(fallback).toBe(true);
    expect(names(ideas)[0]).toBe('Tokens');
  });
});

describe('matchCommanderNames', () => {
  const list = [
    'Giada, Font of Hope',
    'Lyra Dawnbringer',
    'Avacyn, Angel of Hope',
    'A // B',
    'Kaalia of the Vast',
  ];
  it('puts name starts before word starts before the rest', () => {
    expect(matchCommanderNames(list, 'hope')).toEqual([
      'Giada, Font of Hope',
      'Avacyn, Angel of Hope',
    ]);
    expect(matchCommanderNames(list, 'lyr')).toEqual(['Lyra Dawnbringer']);
    expect(matchCommanderNames(list, 'awn')).toEqual(['Lyra Dawnbringer']);
  });
  it('needs three letters and skips double-faced names', () => {
    expect(matchCommanderNames(list, 'gi')).toEqual([]);
    expect(matchCommanderNames(list, 'a //')).toEqual([]);
  });
});

describe('collection counts', () => {
  const card = (name: string, typeLine?: string) => ({ name, typeLine });
  const cards = [
    card('Lyra', 'Legendary Creature — Angel'),
    card('Lyra', 'Legendary Creature — Angel'),
    ...Array.from({ length: 12 }, (_, i) => card(`Angel ${i}`, 'Creature — Angel Cleric')),
    card('The Doctor', 'Legendary Creature — Time Lord Doctor'),
    card('Llanowar Elves', 'Creature — Elf Druid'),
    card('Sol Ring', 'Artifact'),
    card('Untyped'),
    card('Front // Back', 'Creature — Human // Creature — Angel'),
  ];
  it('counts distinct names by subtype, including multi-word types and later faces', () => {
    const counts = ownedTypeCounts(cards, index.ideas);
    expect(counts.get('angels')).toBe(14);
    expect(counts.get('elves')).toBe(1);
    expect(counts.get('time-lords')).toBe(1);
    expect(counts.has('tokens')).toBe(false);
  });
  it('lists only types owned in numbers worth a shelf, fullest first', () => {
    const shelf = collectionCouldBuild(ownedTypeCounts(cards, index.ideas), index);
    expect(shelf.map((s) => [s.idea.slug, s.owned])).toEqual([['angels', 14]]);
  });
});

describe('copy helpers', () => {
  it('words the blurb and kind', () => {
    expect(ideaBlurb(findIdea(index, 'angels')!)).toBe(
      'The commanders that lead angels, most built first.'
    );
    expect(ideaBlurb(findIdea(index, 'tokens')!)).toBe(
      'The commanders built around Tokens, most built first.'
    );
    expect(ideaKindLabel('typal')).toBe('Creature type');
    expect(ideaKindLabel('playstyle')).toBe('Way to play');
  });
  it('shortens commander names', () => {
    expect(shortCommanderName('Giada, Font of Hope')).toBe('Giada');
    expect(shortCommanderName('Venat, Heart // Hydaelyn')).toBe('Venat');
    expect(shortCommanderName('The Ur-Dragon')).toBe('The Ur-Dragon');
    expect(shortCommanderName('Kaalia of the Vast')).toBe('Kaalia');
    expect(shortCommanderName('The Prismatic Piper of Hamelin')).toBe('The Prismatic');
    expect(findIdea(index, 'angels')?.name).toBe('Angels');
    expect(findIdea(index, 'nope')).toBeUndefined();
  });
});

describe('loading', () => {
  it('fetches the snapshot once and shares it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(RAW)));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([loadIdeaIndex(), loadIdeaIndex()]);
    expect(a?.ideas).toHaveLength(RAW.ideas.length);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('resolves null on a bad answer and tries again next time', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response(JSON.stringify(RAW)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadIdeaIndex()).toBeNull();
    expect(await loadIdeaIndex()).toBeNull();
    expect((await loadIdeaIndex())?.ideas.length).toBeGreaterThan(0);
  });
  it('useIdeaIndex moves from loading to error and back to ready on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(RAW)));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useIdeaIndex());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
