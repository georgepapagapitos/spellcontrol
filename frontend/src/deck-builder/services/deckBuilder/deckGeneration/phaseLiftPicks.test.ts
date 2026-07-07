import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiftEntry, ScryfallCard } from '@/deck-builder/types';

const fetchCardLiftPoolMock = vi.fn<(name: string) => Promise<LiftEntry[]>>();
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCardLiftPool: (name: string) => fetchCardLiftPoolMock(name),
}));

const getCardsByNamesMock = vi.fn<() => Promise<Map<string, ScryfallCard>>>();
const upgradeCardPrintingsMock =
  vi.fn<(map: Map<string, ScryfallCard>, query: string, strict: boolean) => Promise<void>>();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...args: unknown[]) =>
    getCardsByNamesMock(...(args as Parameters<typeof getCardsByNamesMock>)),
  upgradeCardPrintings: (...args: Parameters<typeof upgradeCardPrintingsMock>) =>
    upgradeCardPrintingsMock(...args),
}));

import { liftPicksPhase } from './phaseLiftPicks';
import type { GenerationState } from './state';

function card(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 3,
    type_line: 'Creature',
    color_identity: ['G'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function entry(overrides: Partial<LiftEntry> & { name: string }): LiftEntry {
  return {
    lift: 1,
    coPlayPct: 10,
    numDecks: 200,
    potentialDecks: 1000,
    lowSample: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = card('Cmd', { name: 'Cmd' });
  const synergy = [card('Sun A', { isThemeSynergyCard: true })];
  const creatures = [card('Filler B')];
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: ['G'],
      customization: {} as GenerationState['context']['customization'],
      collectionNames: undefined,
    },
    cfg: {
      format: 99,
      maxCardPrice: null,
      budgetOption: undefined,
      targetBracket: undefined,
      maxRarity: null,
      maxCmc: null,
      arenaOnly: false,
      scryfallQuery: '',
      preferredSet: undefined,
      maxGameChangers: Infinity,
      deckBudget: null,
      currency: 'USD',
      ignoreOwnedBudget: false,
      ignoreOwnedRarity: false,
      collectionStrategy: 'full',
      collectionOwnedPercent: 75,
      comboCountSetting: 0,
      selectedThemesWithSlugs: [],
    },
    usedNames: new Set<string>(),
    bannedCards: new Set<string>(),
    categories: {
      lands: [],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures,
      synergy,
      utility: [],
    },
    currentCurveCounts: {},
    currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    currentSubtypeCounts: {},
    staticComboBoosts: new Map(),
    comboCardNames: new Set(),
    comboCards: new Map(),
    gameChangerCount: { value: 0 },
    mustIncludeNames: [],
    mustIncludeSources: new Map(),
    saltIndex: new Map(),
    liftSeedPools: new Map(),
    liftSeedsTried: new Set(),
    gameChangerNames: new Set<string>(),
    combos: [],
    edhrecData: { cardlists: { allNonLand: [] } } as unknown as GenerationState['edhrecData'],
    dataSource: 'base',
    themeOverlapCounts: new Map(),
    roleTargets: null,
    roleTargetBreakdown: undefined,
    detectedArchetype: undefined,
    resolvedPacing: 'balanced',
    detectedPacing: 'balanced',
    swapCandidates: undefined,
    detectedCombos: undefined,
    gapAnalysis: undefined,
    deckScore: undefined,
    cardInclusionMap: undefined,
    cardRelevancyMap: undefined,
    stats: undefined,
    representativeStats: undefined,
    usedThemes: undefined,
    ...overrides,
  } as GenerationState;
}

describe('liftPicksPhase', () => {
  beforeEach(() => {
    fetchCardLiftPoolMock.mockReset();
    getCardsByNamesMock.mockReset();
    upgradeCardPrintingsMock.mockReset();
    fetchCardLiftPoolMock.mockResolvedValue([]);
    getCardsByNamesMock.mockResolvedValue(new Map());
    upgradeCardPrintingsMock.mockResolvedValue(undefined);
  });

  it('returns undefined when the generation had no EDHREC data', async () => {
    const state = makeState({ edhrecData: null });
    expect(await liftPicksPhase(state)).toBeUndefined();
    expect(fetchCardLiftPoolMock).not.toHaveBeenCalled();
  });

  it('produces picks from seeded pools, owned flag from the collection', async () => {
    const state = makeState({
      context: { ...makeState().context, collectionNames: new Set(['Bomb Card']) },
    });
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd' ? [entry({ name: 'Bomb Card', lift: 10, coPlayPct: 30, numDecks: 200 })] : []
    );
    getCardsByNamesMock.mockResolvedValue(new Map([['Bomb Card', card('Bomb Card')]]));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks).toEqual([
      { name: 'Bomb Card', kind: 'bomb', liftedBy: ['Cmd'], lowSample: false, owned: true },
    ]);
    expect(result?.liftPicksNote).toBeUndefined();
  });

  it('hard-filters an off-color and an over-budget candidate even with huge lift', async () => {
    const state = makeState();
    state.cfg.maxCardPrice = 5;
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd'
        ? [
            entry({ name: 'OffColor Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Pricey Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Good Card', lift: 6, coPlayPct: 20, numDecks: 200 }),
          ]
        : []
    );
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['OffColor Card', card('OffColor Card', { color_identity: ['R'] })],
        ['Pricey Card', card('Pricey Card', { prices: { usd: '50' } })],
        ['Good Card', card('Good Card', { prices: { usd: '1' } })],
      ])
    );

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Good Card']);
    expect(result?.liftPicksNote).toBe('2 higher-lift candidates hidden: off-color');
  });

  it('excludes banned and already-in-deck names from candidates', async () => {
    const state = makeState();
    state.usedNames.add('In Deck Card');
    state.bannedCards.add('Banned Card');
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd'
        ? [
            entry({ name: 'In Deck Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Banned Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Fresh Card', lift: 6, coPlayPct: 20, numDecks: 200 }),
          ]
        : []
    );
    getCardsByNamesMock.mockResolvedValue(new Map([['Fresh Card', card('Fresh Card')]]));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Fresh Card']);
  });

  it('excludes names passed via extraExcludeNames (C5 — a card the late swap phases just cut)', async () => {
    // Yuriko-bracket4 case: bracket convergence cuts Kaito this same pass, so
    // it must not immediately resurface as a "hidden synergy" package pick
    // even though it's no longer in usedNames by the time lift picks run.
    const state = makeState();
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd'
        ? [
            entry({ name: 'Kaito Shizuki', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Fresh Card', lift: 6, coPlayPct: 20, numDecks: 200 }),
          ]
        : []
    );
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Kaito Shizuki', card('Kaito Shizuki')],
        ['Fresh Card', card('Fresh Card')],
      ])
    );

    const result = await liftPicksPhase(state, {
      extraExcludeNames: new Set(['Kaito Shizuki']),
    });
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Fresh Card']);
  });

  it('soft-fails to undefined (no throw) when a lift-pool fetch rejects', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockRejectedValue(new Error('network down'));

    await expect(liftPicksPhase(state)).resolves.toBeUndefined();
  });

  it('marks a pick unowned when absent from the collection', async () => {
    const state = makeState({
      context: { ...makeState().context, collectionNames: new Set(['Someone Else']) },
    });
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd' ? [entry({ name: 'Bomb Card', lift: 10, coPlayPct: 30, numDecks: 200 })] : []
    );
    getCardsByNamesMock.mockResolvedValue(new Map([['Bomb Card', card('Bomb Card')]]));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks[0]?.owned).toBe(false);
  });
});

describe('liftPicksPhase constraint gates (E71 controls audit)', () => {
  beforeEach(() => {
    fetchCardLiftPoolMock.mockReset();
    getCardsByNamesMock.mockReset();
    upgradeCardPrintingsMock.mockReset();
    upgradeCardPrintingsMock.mockResolvedValue(undefined);
    // Every test: commander seed offers two candidates, "Gated Card" (huge
    // lift) and "Safe Card" — the gate under test must hide the former.
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd'
        ? [
            entry({ name: 'Gated Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Safe Card', lift: 6, coPlayPct: 20, numDecks: 200 }),
          ]
        : []
    );
  });

  const resolveCards = (gated: ScryfallCard) =>
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Gated Card', gated],
        ['Safe Card', card('Safe Card')],
      ])
    );

  it('rejects a salt-blocked candidate and discloses it', async () => {
    const state = makeState();
    resolveCards(card('Gated Card'));

    const result = await liftPicksPhase(state, {
      isSaltBlocked: (name) => name === 'Gated Card',
    });
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(result?.liftPicksNote).toBe('1 higher-lift candidate hidden: over salt tolerance');
  });

  it('enforces the effective Scryfall filter via the strict printing upgrade', async () => {
    const state = makeState();
    resolveCards(card('Gated Card'));
    // Strict upgrade deletes candidates with no printing matching the query.
    upgradeCardPrintingsMock.mockImplementation(async (map) => {
      map.delete('Gated Card');
    });

    const result = await liftPicksPhase(state, { effectiveScryfallQuery: 'is:full-art' });
    expect(upgradeCardPrintingsMock).toHaveBeenCalledWith(expect.any(Map), 'is:full-art', true);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(result?.liftPicksNote).toBe('1 higher-lift candidate hidden: outside your card filters');
  });

  it('skips the printing upgrade entirely when no filter is set', async () => {
    const state = makeState();
    resolveCards(card('Gated Card'));

    await liftPicksPhase(state);
    expect(upgradeCardPrintingsMock).not.toHaveBeenCalled();
  });

  it('rejects a not-commander-legal candidate', async () => {
    const state = makeState();
    resolveCards(card('Gated Card', { legalities: { commander: 'banned' } }));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(result?.liftPicksNote).toBe('1 higher-lift candidate hidden: not legal in Commander');
  });

  it('rejects an over-rarity candidate unless owned-exempt', async () => {
    const state = makeState();
    state.cfg.maxRarity = 'uncommon';
    resolveCards(card('Gated Card', { rarity: 'mythic' }));

    const gated = await liftPicksPhase(state);
    expect(gated?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(gated?.liftPicksNote).toBe('1 higher-lift candidate hidden: over rarity cap');

    // Owned + ignoreOwnedRarity => the same mythic is exempt and surfaces.
    state.cfg.ignoreOwnedRarity = true;
    state.context.collectionNames = new Set(['Gated Card']);
    const exempt = await liftPicksPhase(state);
    expect(exempt?.packagePicks.map((p) => p.name)).toContain('Gated Card');
  });

  it('rejects a non-Arena candidate in Arena-only mode', async () => {
    const state = makeState();
    state.cfg.arenaOnly = true;
    resolveCards(card('Gated Card', { games: ['paper'] }));
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Gated Card', card('Gated Card', { games: ['paper'] })],
        ['Safe Card', card('Safe Card', { games: ['paper', 'arena'] })],
      ])
    );

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(result?.liftPicksNote).toBe('1 higher-lift candidate hidden: not on Arena');
  });

  it('rejects an over-CMC candidate under a mana-value cap (Tiny Leaders)', async () => {
    const state = makeState();
    state.cfg.maxCmc = 3;
    resolveCards(card('Gated Card', { cmc: 6 }));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(result?.liftPicksNote).toBe('1 higher-lift candidate hidden: over mana-value cap');
  });

  it('rejects a Game Changer candidate at a bracket-2 ask (E104)', async () => {
    // The seating path (cardPicking/scryfallFill/auditAdd) never lets a GC
    // signal into a bracket<=2 deck — this pins the advisory surface to the
    // same ceiling instead of advertising a pick the deck could never run.
    const state = makeState();
    state.cfg.targetBracket = 2;
    state.gameChangerNames = new Set(['Gated Card']);
    resolveCards(card('Gated Card'));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Safe Card']);
    expect(result?.liftPicksNote).toBe('1 higher-lift candidate hidden: over your target bracket');
  });

  it('surfaces the same Game Changer candidate when no bracket is targeted (E104)', async () => {
    const state = makeState();
    state.gameChangerNames = new Set(['Gated Card']);
    resolveCards(card('Gated Card'));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toContain('Gated Card');
  });
});
