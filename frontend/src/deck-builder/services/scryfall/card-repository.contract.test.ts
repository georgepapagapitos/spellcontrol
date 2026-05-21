import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardRepository } from './card-repository';
import { withPlayableFilter, liveCardRepository, offlineCardRepository } from './client';

/**
 * Contract test for the card-repository layer.
 *
 * The live and offline implementations used to be a fork inside every fetch
 * function, so a fix applied to one path (e.g. filtering out art-series cards)
 * could silently miss the other — exactly how the art-card leak shipped twice.
 *
 * `withPlayableFilter` is now the single enforcement point: `getCardRepository()`
 * always returns `withPlayableFilter(<live|offline>)`. So proving the wrapper
 * strips non-playable cards from *any* inner repository proves the guarantee
 * holds for both implementations at once — no network or IndexedDB needed.
 */

function makeCard(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Sol Ring',
    cmc: 1,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'cmm',
    set_name: 'Commander Masters',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const REAL = makeCard({ name: 'Arcane Signet', layout: 'normal' });
const ART = makeCard({
  name: 'Arcane Signet',
  layout: 'art_series',
  set: 'acmm',
  legalities: { commander: 'not_legal' },
});
const TOKEN = makeCard({ name: 'Soldier', layout: 'token' });

/**
 * A deliberately poisoned inner repository: every card-returning method mixes
 * real cards with non-playable ones. A correct wrapper must strip the latter.
 */
function poisonedRepo(): CardRepository {
  return {
    searchCommanders: async () => [REAL, ART, TOKEN],
    searchCards: async () => ({
      object: 'list',
      total_cards: 3,
      has_more: false,
      data: [REAL, ART, TOKEN],
    }),
    getCardByName: async (name) => (name === 'art' ? ART : REAL),
    getCardsByNames: async () =>
      new Map<string, ScryfallCard>([
        ['Arcane Signet', REAL],
        ['Arcane Signet Art', ART],
        ['Soldier', TOKEN],
      ]),
    upgradeCardPrintings: async (cards) => {
      // Simulate an impl that upgraded an entry to a non-playable printing.
      cards.set('poisoned', ART);
    },
    getGameChangerNames: async () => new Set(['Sol Ring']),
    getBanList: async () => ['Lutri, the Spellchaser'],
    autocompleteCardName: async () => ['Arcane Signet'],
    fetchMultiCopyCardNames: async () => new Map([['Persistent Petitioners', null]]),
  };
}

describe('withPlayableFilter — card-repository contract', () => {
  it('strips non-playable cards from searchCommanders', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    const out = await repo.searchCommanders('');
    expect(out).toEqual([REAL]);
  });

  it('strips non-playable cards from searchCards results', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    const out = await repo.searchCards('', []);
    expect(out.data).toEqual([REAL]);
    // Envelope metadata is preserved untouched.
    expect(out.total_cards).toBe(3);
    expect(out.has_more).toBe(false);
  });

  it('returns the card from getCardByName when it is playable', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    await expect(repo.getCardByName('Arcane Signet')).resolves.toEqual(REAL);
  });

  it('throws from getCardByName when the resolved card is non-playable', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    await expect(repo.getCardByName('art')).rejects.toThrow(/non-playable/i);
  });

  it('drops non-playable entries from getCardsByNames', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    const map = await repo.getCardsByNames(['Arcane Signet', 'Arcane Signet Art', 'Soldier']);
    expect([...map.keys()]).toEqual(['Arcane Signet']);
  });

  it('removes non-playable entries left in the map by upgradeCardPrintings', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    const cards = new Map<string, ScryfallCard>([['Arcane Signet', REAL]]);
    await repo.upgradeCardPrintings(cards, 'is:full-art');
    expect([...cards.keys()]).toEqual(['Arcane Signet']);
  });

  it('passes name/string-returning methods through untouched', async () => {
    const repo = withPlayableFilter(poisonedRepo());
    expect(await repo.getGameChangerNames()).toEqual(new Set(['Sol Ring']));
    expect(await repo.getBanList('commander')).toEqual(['Lutri, the Spellchaser']);
    expect(await repo.autocompleteCardName('arc')).toEqual(['Arcane Signet']);
    expect(await repo.fetchMultiCopyCardNames()).toEqual(
      new Map([['Persistent Petitioners', null]])
    );
  });
});

describe('repository implementations', () => {
  it('both live and offline repositories implement every CardRepository method', () => {
    const methods: (keyof CardRepository)[] = [
      'searchCommanders',
      'searchCards',
      'getCardByName',
      'getCardsByNames',
      'upgradeCardPrintings',
      'getGameChangerNames',
      'getBanList',
      'autocompleteCardName',
      'fetchMultiCopyCardNames',
    ];
    for (const m of methods) {
      expect(typeof liveCardRepository[m]).toBe('function');
      expect(typeof offlineCardRepository[m]).toBe('function');
    }
  });
});
