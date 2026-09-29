import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { Change } from '@/lib/coach/deck-change';
import { encodeSnapshot, type SnapshotMeta } from '../cardFacts/codec';
import { extractCardFacts } from '../cardFacts/extract';
import { setCardFactsSnapshot } from '../cardFacts/index';
import { CARD_FACTS_VERSION } from '../cardFacts/schema';
import {
  prepareSubstituteRanking,
  substituteRankingReady,
  subscribeSubstituteRanking,
} from './index';
import {
  ownedAlternativesReranker,
  rankSimilarCards,
  rankSwapAlternatives,
  roleForTaggerRole,
} from './surfaces';
import { SUBSTITUTE_TEST_CARDS } from './test-cards.fixtures';

const META: SnapshotMeta = {
  generatedAt: '2026-09-29T09:01:56.000Z',
  sources: {
    scryfallOracleCards: {
      updatedAt: '2026-09-29T09:01:56.000Z',
      file: 'oracle-cards-20260929090156.jsonl.gz',
    },
    taggerTags: { generatedAt: '2026-09-01T22:03:33.453Z' },
  },
  extractor: { version: CARD_FACTS_VERSION, name: 'cardFacts/extract.ts' },
  llm: null,
  seeds: {},
  universe: 'test',
  cards: Object.keys(SUBSTITUTE_TEST_CARDS).length,
};
const snapshot = JSON.parse(
  JSON.stringify(
    encodeSnapshot(
      META,
      Object.values(SUBSTITUTE_TEST_CARDS).map((c) => extractCardFacts(c))
    )
  )
);
const facts = (name: string) => extractCardFacts(SUBSTITUTE_TEST_CARDS[name]);
const scryfall = (name: string, colorIdentity: string[] = []): ScryfallCard =>
  ({ ...SUBSTITUTE_TEST_CARDS[name], color_identity: colorIdentity }) as unknown as ScryfallCard;
const staple = (name: string, role: string): GapAnalysisCard => ({
  name,
  role,
  price: null,
  inclusion: 40,
  synergy: 0,
  typeLine: SUBSTITUTE_TEST_CARDS[name].type_line ?? '',
});

afterEach(() => {
  setCardFactsSnapshot(null);
  vi.unstubAllGlobals();
});

describe('before the card facts load', () => {
  it('every surface keeps its v1 order', () => {
    expect(substituteRankingReady()).toBe(false);
    expect(ownedAlternativesReranker([])).toBeNull();
    expect(
      rankSwapAlternatives('Grave Pact', 'removal', [{ name: 'Dictate of Erebos' }], [])
    ).toBeNull();
    expect(rankSimilarCards(scryfall('Grave Pact'), [], { deckNames: [] })).toBeNull();
  });

  it('loads them once, tells subscribers, and survives a failed fetch', async () => {
    const heard = vi.fn();
    const off = subscribeSubstituteRanking(heard);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    );
    expect(await prepareSubstituteRanking()).toBe(false);
    expect(heard).not.toHaveBeenCalled();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => snapshot }))
    );
    const [a, b] = await Promise.all([prepareSubstituteRanking(), prepareSubstituteRanking()]);
    expect(a && b).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await prepareSubstituteRanking()).toBe(true);
    off();
  });
});

describe('once the facts are loaded', () => {
  beforeEach(() => setCardFactsSnapshot(snapshot));

  it('reads a tagger role as the fact role it means for the card', () => {
    expect(roleForTaggerRole(facts('Counterspell'), 'removal')).toBe('counterspell');
    expect(roleForTaggerRole(facts('Grave Pact'), 'removal')).toBe('removal');
    expect(roleForTaggerRole(facts('Blood Artist'), null)).toBe('aristocrat-drain');
    expect(roleForTaggerRole(facts('Blood Artist'), 'cardDraw')).toBe('cardDraw');
  });

  it('orders the Coach lane by how well each owned card replaces the staple', () => {
    const rerank = ownedAlternativesReranker(['Viscera Seer', 'Carrion Feeder', "Ashnod's Altar"])!;
    const out = rerank.rank(staple('Grave Pact', 'removal'), [
      'Swords to Plowshares',
      'Massacre Wurm',
      'Dictate of Erebos',
      'Butcher of Malakir',
    ])!;
    expect(out.order.slice(0, 2)).toEqual(
      expect.arrayContaining(['Dictate of Erebos', 'Butcher of Malakir'])
    );
    const factors = out.factorsFor('Dictate of Erebos', [{ text: 'Same mana cost', tone: 'pro' }]);
    expect(factors[0].text).toMatch(/^Same effect: whenever a creature you control dies/);
    expect(factors.map((f) => f.text)).toContain('Pays off your sacrifice engine: 3 cards feed it');
    expect(factors.map((f) => f.text)).toContain('Same mana cost');
  });

  it('declines a staple the snapshot lacks', () => {
    expect(ownedAlternativesReranker([])!.rank(staple('Grave Pact', 'removal'), [])).not.toBeNull();
    const unknown = { ...staple('Grave Pact', 'removal'), name: 'Not A Printed Card' };
    expect(ownedAlternativesReranker([])!.rank(unknown, ['Dictate of Erebos'])).toBeNull();
  });

  it('keeps Swap this card owned-first, then orders by fit', () => {
    const alternatives: Change[] = [
      {
        id: 'a',
        type: 'add',
        lane: 'fill-gaps',
        name: 'Massacre Wurm',
        ownership: 'owned',
        inclusion: 60,
      },
      {
        id: 'b',
        type: 'add',
        lane: 'fill-gaps',
        name: 'Dictate of Erebos',
        ownership: 'unowned',
        inclusion: 30,
      },
      {
        id: 'c',
        type: 'add',
        lane: 'fill-gaps',
        name: 'Butcher of Malakir',
        ownership: 'owned',
        inclusion: 10,
      },
    ];
    const out = rankSwapAlternatives('Grave Pact', 'removal', alternatives, ['Grave Pact'])!;
    expect(out.map((a) => a.name)).toEqual([
      'Butcher of Malakir',
      'Massacre Wurm',
      'Dictate of Erebos',
    ]);
    expect(out[0].whyFactors?.[0].text).toMatch(/^Same effect/);
  });

  it('ranks Similar cards owned-first, drops what the deck identity or a land rule forbids', () => {
    const pool = [
      { card: scryfall('Swords to Plowshares', ['W']), ownership: 'owned' as const },
      { card: scryfall('Dictate of Erebos', ['B']), ownership: 'unowned' as const },
      { card: scryfall('Butcher of Malakir', ['B']), ownership: 'owned' as const },
      { card: scryfall('Butcher of Malakir', ['B']), ownership: 'owned' as const },
    ];
    const out = rankSimilarCards(scryfall('Grave Pact', ['B']), pool, {
      identity: ['B'],
      deckNames: [],
    })!;
    expect(out.map((c) => c.name)).toEqual(['Butcher of Malakir', 'Dictate of Erebos']);
    expect(out[0].whyFactors?.[0].text).toMatch(/^Same effect/);
    expect(out[0].ownership).toBe('owned');
  });
});
