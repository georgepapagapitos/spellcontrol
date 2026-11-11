// @vitest-environment happy-dom
/**
 * What the finder needs from the idea list (E1113): the old playstyle chips are gone from the
 * generator's finder, so every playstyle that had an EDHREC tag must still be an idea, "Pairs well
 * with" ranks shared themes, and a finder with no idea layout never loads the list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYSTYLES } from '@/lib/deck/commander-playstyle-index';
import {
  __resetIdeaIndexForTests,
  parseIdeaIndex,
  relatedIdeas,
  useIdeaIndex,
} from '@/lib/deck/idea-index';

const snapshot = parseIdeaIndex(
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/idea-index.json'), 'utf8'))
);

describe('the shipped idea snapshot', () => {
  it('has an idea for every playstyle the finder used to filter by', () => {
    expect(snapshot).not.toBeNull();
    const slugs = new Set(snapshot!.ideas.map((i) => i.slug));
    const unreachable = PLAYSTYLES.filter((p) => p.edhrecSlug && !slugs.has(p.edhrecSlug)).map(
      (p) => p.id
    );
    expect(unreachable).toEqual([]);
  });

  it('only Tribal has no tag, and the Creature types row stands in for it', () => {
    expect(PLAYSTYLES.filter((p) => !p.edhrecSlug).map((p) => p.id)).toEqual(['tribal']);
    expect(snapshot!.ideas.filter((i) => i.kind === 'typal').length).toBeGreaterThan(20);
  });
});

describe('relatedIdeas', () => {
  const index = parseIdeaIndex({
    ideas: [
      { slug: 'angels', name: 'Angels', kind: 'typal', decks: 10 },
      { slug: 'lifegain', name: 'Lifegain', kind: 'playstyle', decks: 9 },
      { slug: 'tokens', name: 'Tokens', kind: 'playstyle', decks: 8 },
      { slug: 'flying', name: 'Flying', kind: 'playstyle', decks: 7 },
    ],
  })!;
  const angels = index.ideas[0];

  it('ranks the ideas more leaders share, leaves out the idea itself and unknown themes', () => {
    const lists = [
      [{ slug: 'angels' }, { slug: 'lifegain', count: 5 }, { slug: 'tokens', count: 900 }],
      [
        { slug: 'lifegain', count: 1 },
        { slug: 'not-an-idea', count: 99999 },
      ],
      [{ slug: 'flying', count: 3 }],
    ];
    expect(relatedIdeas(index, angels, lists).map((i) => i.slug)).toEqual([
      'lifegain',
      'tokens',
      'flying',
    ]);
  });

  it('is empty with no leaders', () => {
    expect(relatedIdeas(index, angels, [])).toEqual([]);
  });
});

describe('useIdeaIndex(false)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never fetches the snapshot', () => {
    __resetIdeaIndexForTests();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useIdeaIndex(false));
    expect(result.current.status).toBe('loading');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
