/**
 * Guard (T171 lane M): the manual-deck analysis hands Coach what it needs to
 * keep its advice honest.
 *  - Premium cards (premiumCards.ts) never reach the Cuts lane: not as a
 *    misfit, not as an optimizer removal. An imported deck carries no
 *    Game Changer stamps, so the protection reads names.
 *  - Every card Coach may suggest carries its price and rarity, and each
 *    one-away combo's missing piece is recorded with its play rate here, so
 *    the deck's own settings can be checked (lib/coach/deck-settings-fit.ts)
 *    and the hero can skip a combo that needs a generic card.
 * Real cards (Scryfall 2026-09-29); vi.mock calls must be top-level.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { COACH_CARDS } from './__fixtures__/coach-cards.fixtures';

const row = (name: string, inclusion: number, synergy = 0): EDHRECCard => ({
  name,
  sanitized: name.toLowerCase(),
  primary_type: 'Instant',
  inclusion,
  num_decks: Math.round(inclusion * 50),
  potential_decks: 5000,
  synergy,
});

// The commander's page: two staples the deck is missing, a card it runs, and
// Beast Within, the missing piece of an on-plan combo.
const PAGE = [
  row('Swords to Plowshares', 62),
  row('Counterspell', 48),
  row('Crib Swap', 12),
  row('Beast Within', 22),
];

function edhrecData(allNonLand: EDHRECCard[]): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 5000,
      deckSize: 81,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: {
      creatures: [],
      instants: allNonLand,
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand,
    },
    similarCommanders: [],
  };
}

vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(async () => edhrecData(PAGE)),
  fetchPartnerCommanderData: vi.fn(async () => edhrecData(PAGE)),
  fetchCardLiftPool: vi.fn(async () => []),
}));

vi.mock('./cardSimilar', () => ({
  loadCardSimilar: vi.fn(async () => {}),
  getSimilarRank: vi.fn(() => null),
}));

vi.mock('@/deck-builder/services/cardFacts', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/cardFacts')>()),
  loadCardFacts: vi.fn(async () => false),
}));

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    getGameChangerNames: vi.fn(async () => new Set<string>()),
    getCardsByNames: vi.fn(async (names: string[]) => {
      const out = new Map<string, ScryfallCard>();
      for (const n of names) if (COACH_CARDS[n]) out.set(n, { ...COACH_CARDS[n] });
      return out;
    }),
    searchCards: vi.fn(async () => ({ data: [] })),
    commanderSearchIdentity: vi.fn(() => ''),
  };
});

const commander = {
  name: 'Gisa, Glorious Resurrector',
  id: 'gisa',
  oracle_id: 'gisa',
  type_line: 'Legendary Creature — Human Wizard',
  color_identity: ['B', 'U', 'W', 'G'],
  cmc: 4,
  mana_cost: '{2}{B}{B}',
  oracle_text: '',
} as unknown as ScryfallCard;

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
const deck = [
  'Fierce Guardianship',
  'The One Ring',
  'Imperial Seal',
  'Aetherjacket',
  'Crib Swap',
  'Harmonize',
  'Mind Stone',
  'Forest',
  'Swamp',
].map(real);

const beastWithinCombo = {
  combo: {
    id: 'bw',
    produces: ['Infinite mana'],
    popularity: 100,
    cards: [
      { oracleId: 'mind-stone', cardName: 'Mind Stone', quantity: 1 },
      { oracleId: 'beast-within', cardName: 'Beast Within', quantity: 1 },
    ],
  },
  presentOracleIds: ['mind-stone'],
  missingOracleIds: ['beast-within'],
} as unknown as ComboMatch;

// Roles from the pinned tagger fixture, as the generator tests read them.
beforeAll(async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(
    readFileSync(resolve(here, '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

describe('analyzeCommanderDeck — what Coach reads (T171)', () => {
  it('keeps premium cards out of the misfits and the optimizer removals', async () => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    const result = await analyzeCommanderDeck({
      commander,
      cards: deck,
      deckSize: 99,
      colorIdentity: ['B', 'U', 'W', 'G'],
    });
    const misfits = (result?.misfits ?? []).map((m) => m.name);
    expect(misfits).toContain('Aetherjacket');
    for (const premium of ['Fierce Guardianship', 'The One Ring', 'Imperial Seal']) {
      expect(misfits).not.toContain(premium);
      expect((result?.optimizeSwaps?.removals ?? []).map((r) => r.name)).not.toContain(premium);
    }
  });

  it('stamps price and rarity on the gap staples and records the combo pieces', async () => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    const result = await analyzeCommanderDeck({
      commander,
      cards: deck,
      deckSize: 99,
      colorIdentity: ['B', 'U', 'W', 'G'],
      oneAwayCombos: [beastWithinCombo],
    });
    const swords = result?.gapAnalysis?.find((g) => g.name === 'Swords to Plowshares');
    expect(swords).toMatchObject({ price: '1.02', rarity: 'uncommon' });
    expect(result?.suggestionCards?.['Beast Within']).toEqual({
      price: COACH_CARDS['Beast Within'].prices?.usd,
      rarity: COACH_CARDS['Beast Within'].rarity,
      inclusion: 22,
    });
  });
});
