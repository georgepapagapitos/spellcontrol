/**
 * Guard (E540 S3): the excess cutter and the misfit pass read the ONE Coach
 * protection set (lib/coach/coach-protections.ts), the set the replace prompt
 * and the whole-deck objective read. They used to keep their own lists: the
 * excess cutter held engine pieces but not finishers or survival pieces, and
 * the misfit pass held neither. A finisher (Starfield of Nyx, Sythis's
 * enchantment-animation finisher) or a survival piece (Teferi's Protection)
 * off the commander's page read as a misfit and an excess cut.
 * Real cards (Scryfall 2026-09-29); vi.mock calls must be top-level.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import { COACH_CARDS, coachCardFactsSnapshot } from './__fixtures__/coach-cards.fixtures';

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

// The Zombies theme page: Diregraf Colossus at 62.5% (Sefris, T171 re-gate).
// The base page doesn't list it.
const THEME_PAGE = [...PAGE, row('Diregraf Colossus', 62.5)];
const themeFetch = vi.fn(async () => edhrecData(THEME_PAGE));

vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: vi.fn(async () => edhrecData(PAGE)),
  fetchPartnerCommanderData: vi.fn(async () => edhrecData(PAGE)),
  fetchCommanderThemeData: () => themeFetch(),
  fetchPartnerThemeData: () => themeFetch(),
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

beforeAll(async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(
    readFileSync(resolve(here, '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
  setCardFactsSnapshot(coachCardFactsSnapshot());
});
afterAll(() => {
  vi.unstubAllGlobals();
  setCardFactsSnapshot(null);
});

describe('analyzeCommanderDeck — the excess and misfit paths read the one set', () => {
  const held = ['Starfield of Nyx', "Teferi's Protection"];
  const deck = [...held, 'Aetherjacket', 'Crib Swap', 'Harmonize', 'Forest', 'Swamp'].map(real);

  it.each(held)('never offers %s as a misfit or an excess cut', async (name) => {
    const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
    const result = await analyzeCommanderDeck({
      commander,
      cards: deck,
      deckSize: 99,
      colorIdentity: ['B', 'U', 'W', 'G'],
    });
    const misfits = (result?.misfits ?? []).map((m) => m.name);
    const excess = (result?.optimizeSwaps?.removals ?? []).map((r) => r.name);
    // The rest of the off-page deck is still cut: the guard is the card, not the lane.
    expect(misfits).toContain('Aetherjacket');
    expect(misfits).not.toContain(name);
    expect(excess).not.toContain(name);
  });
});
