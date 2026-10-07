// Guard (E573): a generated deck is graded against the plan it was built to.
// 28 of 59 generated decks read A from generation and B from the analysis,
// which derived its own land target, pacing and wipe shave: Lathril's ramp
// target was 14 there and 15 in generation. Real EDHREC pages and generated
// decks (the v4 Coach corpus); real cards (Scryfall 2026-09-29).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import { COACH_CARDS } from './__fixtures__/coach-cards.fixtures';
import fixture from './__fixtures__/build-plan.fixture.json';
import { deckBuildOf } from './analysisTargets';
import { stampRoleSubtypes } from './categorize';
import type { DeckAnalysis } from './deckAnalyzer';

const LATHRIL = 'Lathril, Blade of the Elves';
const ISSHIN = 'Isshin, Two Heavens as One';

function pageOf(name: string): EDHRECCommanderData {
  const deck = fixture.decks[name as keyof typeof fixture.decks];
  const allNonLand = deck.rows.map(([n, inclusion]) => ({
    name: n,
    sanitized: String(n).toLowerCase(),
    primary_type: 'Instant',
    inclusion: Number(inclusion),
    num_decks: 0,
    synergy: 0,
  }));
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: deck.stats.numDecks,
      deckSize: 81,
      manaCurve: deck.stats.manaCurve,
      typeDistribution: {},
      landDistribution: { basic: 0, nonbasic: 0, total: deck.stats.landTotal },
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
  } as unknown as EDHRECCommanderData;
}

const fetchPage = vi.hoisted(() => vi.fn());
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: (name: string) => fetchPage(name),
  fetchPartnerCommanderData: (name: string) => fetchPage(name),
  fetchCommanderThemeData: vi.fn(async () => null),
  fetchPartnerThemeData: vi.fn(async () => null),
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
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getGameChangerNames: vi.fn(async () => new Set<string>()),
  getCardsByNames: vi.fn(async () => new Map<string, ScryfallCard>()),
  searchCards: vi.fn(async () => ({ data: [] })),
  commanderSearchIdentity: vi.fn(() => ''),
}));
// The grader's inputs, as the analysis hands them over.
const analyzeDeckSpy = vi.hoisted(() => ({ calls: [] as unknown[][], results: [] as unknown[] }));
vi.mock('./deckAnalyzer', async (orig) => {
  const actual = await orig<typeof import('./deckAnalyzer')>();
  return {
    ...actual,
    analyzeDeck: (...args: Parameters<typeof actual.analyzeDeck>) => {
      analyzeDeckSpy.calls.push(args);
      const out = actual.analyzeDeck(...args);
      analyzeDeckSpy.results.push(out);
      return out;
    },
  };
});

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => fixture.tagger }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] }) as ScryfallCard;
const cards = ['Sol Ring', 'Arcane Signet', 'Swords to Plowshares', 'Rhystic Study'].map(real);

async function analyze(commander: string, saved: boolean, deckCards = cards) {
  fetchPage.mockImplementation(async (name: string) => pageOf(name));
  analyzeDeckSpy.calls.length = 0;
  analyzeDeckSpy.results.length = 0;
  const generated = fixture.decks[commander as keyof typeof fixture.decks].generated;
  const build = saved
    ? deckBuildOf({
        generationContext: {
          selectedThemes: [],
          targetBracket: 'all',
          landCount: generated.settings.landCount,
          collectionMode: false,
          customization: generated.settings as never,
        },
        buildReport: { archetype: generated.archetype as never },
      })
    : undefined;
  const { analyzeCommanderDeck } = await import('./commanderDeckAnalysis');
  const result = await analyzeCommanderDeck({
    commander: real(commander),
    cards: deckCards,
    deckSize: 99,
    colorIdentity: ['G'],
    build,
  });
  return {
    result,
    graded: analyzeDeckSpy.calls.at(-1),
    analysis: analyzeDeckSpy.results.at(-1) as DeckAnalysis,
  };
}

describe('analyzeCommanderDeck: a generated deck keeps its build plan', () => {
  it("reads Lathril's generated role targets, land target and pacing", async () => {
    const { result, graded } = await analyze(LATHRIL, true);
    expect(result?.roleTargets).toEqual(fixture.decks[LATHRIL].generated.roleTargets);
    expect(graded?.[7]).toBe('midrange'); // overridePacing
    expect(graded?.[8]).toBe(34); // overrideLandTarget
  });

  it("reads Isshin's generated targets, wipe target shaved", async () => {
    const { result, graded } = await analyze(ISSHIN, true);
    expect(result?.roleTargets).toEqual(fixture.decks[ISSHIN].generated.roleTargets);
    expect(graded?.[8]).toBe(36);
  });

  it('derives its own targets for a hand-built deck, and grades with no land override', async () => {
    const { result, graded } = await analyze(LATHRIL, false);
    expect(result?.roleTargets?.ramp).toBe(14); // not the generator's 15: no plan to read
    expect(graded?.[7]).toBeUndefined();
    expect(graded?.[8]).toBeUndefined();
  });
});

// The generator stamps each card it picks with its role subtypes; a deck added to
// later, or rebuilt from stored names, carries none. The grade reads the tagger by
// name either way: an unstamped Sol Ring and Arcane Signet were no mana sources.
describe('analyzeCommanderDeck: grading does not depend on role stamps', () => {
  it('grades a deck the same with and without the generator stamps', async () => {
    const stamped = cards.map((c) => {
      const copy = { ...c };
      stampRoleSubtypes(copy);
      return copy;
    });
    const plain = await analyze(LATHRIL, true, cards);
    const withStamps = await analyze(LATHRIL, true, stamped);
    expect(plain.analysis.manaBase.manaProducerCount).toBe(2);
    expect(plain.analysis.manaBase.manaProducerCount).toBe(
      withStamps.analysis.manaBase.manaProducerCount
    );
    expect(plain.analysis.manaGrade).toEqual(withStamps.analysis.manaGrade);
    expect(plain.result?.deckGrade).toEqual(withStamps.result?.deckGrade);
  });
});

describe('deckBuildOf', () => {
  it('is undefined for a deck with no generation context', () => {
    expect(deckBuildOf({ generationContext: null })).toBeUndefined();
  });

  it('reads the saved settings, themes and archetype, and defaults what an old deck lacks', () => {
    const build = deckBuildOf({
      generationContext: {
        selectedThemes: [],
        targetBracket: 'all',
        landCount: 36,
        collectionMode: false,
      },
    });
    expect(build?.settings).toEqual({
      deckFormat: 99,
      landCount: 36,
      nonBasicLandCount: 15,
      tempoAutoDetect: true,
      tempoPacing: 'balanced',
    });
    expect(build?.archetype).toBeUndefined();
  });
});
