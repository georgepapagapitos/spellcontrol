import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

// E561: real nonbasic lands recorded from the live panels (names, types,
// colors, prices and EDHREC inclusion as the deck builder saw them).
interface FixtureLand {
  name: string;
  type_line: string;
  color_identity: string[];
  rarity: string;
  set: string;
  oracle_text: string;
  price_usd: string;
  edhrec_inclusion: number;
}
const FIXTURE = (
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'land-budget.fixture.json'),
      'utf8'
    )
  ) as { lands: FixtureLand[] }
).lands;

function toCard(l: FixtureLand): ScryfallCard {
  return {
    id: `id-${l.name}`,
    oracle_id: `oracle-${l.name}`,
    name: l.name,
    cmc: 0,
    type_line: l.type_line,
    oracle_text: l.oracle_text,
    color_identity: l.color_identity,
    keywords: [],
    rarity: l.rarity as ScryfallCard['rarity'],
    set: l.set,
    set_name: l.set,
    prices: { usd: l.price_usd },
    legalities: { commander: 'legal' },
  };
}

const basic = (name: string): ScryfallCard => ({
  ...toCard({
    name,
    type_line: `Basic Land — ${name}`,
    color_identity: [],
    rarity: 'common',
    set: 'tst',
    oracle_text: '',
    price_usd: '0.05',
    edhrec_inclusion: 0,
  }),
});

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  CHANNEL_LANDS: {},
  getCardsByNames: vi.fn(async () => new Map()),
  upgradeCardPrintings: vi.fn(async () => {}),
  isChannelLand: vi.fn(() => false),
  isMdfcLand: vi.fn(() => false),
  getCardByName: vi.fn(async (name: string) => basic(name)),
  getCachedCard: vi.fn((name: string) => basic(name)),
  getCardPrice: vi.fn((c: ScryfallCard) => c.prices?.usd ?? null),
  getFrontFaceTypeLine: vi.fn((c: ScryfallCard) => c.card_faces?.[0]?.type_line ?? c.type_line),
  searchCards: vi.fn(async () => ({ data: [] })),
  commanderSearchIdentity: vi.fn((identity: string[]) => identity),
}));

vi.mock('@/deck-builder/services/tagger/client', () => ({
  isTapland: vi.fn(() => false),
}));

import { BudgetTracker } from './budgetTracker';
import { generateLands } from './landGenerator';
import { reserveLandBudget, LAND_RESERVE_MAX_SHARE } from './landBudgetReserve';
import type { GenerationState } from './deckGeneration/state';
import { getCardsByNames, searchCards } from '@/deck-builder/services/scryfall/client';

const ATRAXA = ['W', 'U', 'B', 'G'];
const NONBASIC_TARGET = 23;

const onIdentity = (identity: string[]) =>
  FIXTURE.filter((l) => l.color_identity.every((c) => identity.includes(c)));

/** EDHREC's list: the lands it rates. The rest reach the picker through the
 *  newest-lands search, as the real pool does. */
function wire(identity: string[]) {
  const pool = onIdentity(identity);
  const rated = pool.filter((l) => l.edhrec_inclusion > 0);
  const edhrec: EDHRECCard[] = rated.map((l) => ({
    name: l.name,
    sanitized: l.name,
    primary_type: 'Land',
    inclusion: l.edhrec_inclusion,
    num_decks: l.edhrec_inclusion * 100,
  }));
  vi.mocked(getCardsByNames).mockImplementation(
    async (names: string[]) =>
      new Map(
        pool
          .filter((l) => names.includes(l.name))
          .map((l) => [l.name, toCard(l)] as [string, ScryfallCard])
      )
  );
  vi.mocked(searchCards).mockResolvedValue({
    data: pool.filter((l) => l.edhrec_inclusion === 0).map(toCard),
  } as Awaited<ReturnType<typeof searchCards>>);
  return edhrec;
}

function run(
  edhrec: EDHRECCard[],
  identity: string[],
  tracker: BudgetTracker | null,
  nonbasics: number
) {
  return generateLands(
    edhrec,
    identity,
    nonbasics + 13,
    new Set(),
    13,
    99,
    [],
    undefined,
    new Set(),
    null,
    null,
    null,
    tracker
  );
}

const nonbasicNames = (lands: ScryfallCard[]) =>
  lands.filter((c) => !c.type_line.includes('Basic')).map((c) => c.name);

function stateFor(edhrec: EDHRECCard[], identity: string[]): GenerationState {
  return {
    cfg: {
      format: 99,
      maxRarity: null,
      maxCmc: null,
      arenaOnly: false,
      maxCardPrice: null,
      currency: 'USD',
      mtgFormat: 'commander',
      ignoreOwnedBudget: false,
      ignoreOwnedRarity: false,
      preferredSet: undefined,
    },
    context: { colorIdentity: identity, collectionNames: undefined },
    usedNames: new Set<string>(),
    bannedCards: new Set<string>(),
    edhrecData: { cardlists: { lands: edhrec } },
  } as unknown as GenerationState;
}

describe('E561 land budget', () => {
  it('seats the whole nonbasic target on a $75 four-color budget build', async () => {
    const edhrec = wire(ATRAXA);
    // The spells run first and ran the deck out of money: $0.94 left.
    const tracker = new BudgetTracker(75, 63 + NONBASIC_TARGET);
    const held = await reserveLandBudget(stateFor(edhrec, ATRAXA), tracker, NONBASIC_TARGET);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThanOrEqual(75 * LAND_RESERVE_MAX_SHARE);
    expect(tracker.remainingBudget).toBeCloseTo(75 - held);
    tracker.remainingBudget = 0.94;
    tracker.cardsRemaining = NONBASIC_TARGET;

    const lands = await run(edhrec, ATRAXA, tracker, NONBASIC_TARGET);
    const nonbasics = nonbasicNames(lands);
    expect(nonbasics).toHaveLength(NONBASIC_TARGET);
    // Cheap real fixing, not the $5 and $8 lands the merit ranking would buy first.
    expect(nonbasics).toEqual(expect.arrayContaining(['Seaside Citadel', 'Opulent Palace']));
    expect(nonbasics).not.toContain('Overgrown Tomb');
    expect(nonbasics).not.toContain('Breeding Pool');
    const spent = lands.reduce((a, c) => a + parseFloat(c.prices?.usd ?? '0'), 0);
    expect(spent).toBeLessThanOrEqual(held + 0.94 + 0.01 + 13 * 0.05);
  });

  it('is what an out-of-money land phase was missing', async () => {
    const edhrec = wire(ATRAXA);
    // Same $0.94, no reserve: the land base cannot seat its target.
    const starved = await run(
      edhrec,
      ATRAXA,
      new BudgetTracker(0.94, NONBASIC_TARGET),
      NONBASIC_TARGET
    );
    expect(nonbasicNames(starved).length).toBeLessThan(NONBASIC_TARGET);
  });

  it('paces a merit-ranked pick list so the tail still seats', async () => {
    const edhrec = wire(ATRAXA);
    // Enough for the cheapest 23 and a little more; the 15%-of-remaining rule
    // spent it on the first picks (Atraxa shipped 20 of 23).
    const cheapest = onIdentity(ATRAXA)
      .map((l) => parseFloat(l.price_usd))
      .sort((a, b) => a - b)
      .slice(0, NONBASIC_TARGET)
      .reduce((a, b) => a + b, 0);
    const tracker = new BudgetTracker(cheapest * 1.2 + 1, 50);
    tracker.reserveForLands(1); // released as the land phase starts
    const lands = await run(edhrec, ATRAXA, tracker, NONBASIC_TARGET);
    expect(nonbasicNames(lands)).toHaveLength(NONBASIC_TARGET);
  });

  it('holds no reserve on a mono-red $50 build whose land tail is a few cents (Krenko keeps Impact Tremors)', async () => {
    const mono = ['R'];
    const edhrec = wire(mono);
    // Krenko budget50: 5 nonbasics against ~60 slots. Holding money here cost
    // the build Impact Tremors (84.6% inclusion) and Beetleback Chief.
    const t = new BudgetTracker(50, 60 + 5);
    expect(await reserveLandBudget(stateFor(edhrec, mono), t, 5)).toBe(0);
    expect(t.remainingBudget).toBe(50);
    const lands = await run(edhrec, mono, t, 5);
    expect(nonbasicNames(lands)).toHaveLength(5);
  });

  it('holds nothing without a priced pool to size it from', async () => {
    const t = new BudgetTracker(75, 80);
    expect(await reserveLandBudget(stateFor([], ATRAXA), t, NONBASIC_TARGET)).toBe(0);
    expect(t.remainingBudget).toBe(75);
  });
});

describe('E561 staple rock hold', () => {
  it('holds the rocks the deck lacks on a budget they would swallow, and nothing on a roomy one', async () => {
    const edhrec = wire(['R']);
    // The mocked client prices every named card at $0.05, so size the budget around that.
    const tight = new BudgetTracker(0.5, 40);
    await reserveLandBudget(stateFor(edhrec, ['R']), tight, 5);
    expect(tight.rockReserve).toBeCloseTo(0.1); // Sol Ring + Arcane Signet
    const roomy = new BudgetTracker(75, 80);
    await reserveLandBudget(stateFor(edhrec, ['R']), roomy, 5);
    expect(roomy.rockReserve).toBe(0);
  });

  it('skips a rock already in the deck', async () => {
    const state = stateFor(wire(['R']), ['R']);
    state.usedNames.add('Sol Ring');
    const t = new BudgetTracker(0.5, 40);
    await reserveLandBudget(state, t, 5);
    expect(t.rockReserve).toBeCloseTo(0.05);
  });
});

describe('BudgetTracker land reserve', () => {
  it('drops the hold when an uncapped spend empties the budget, rather than lifting the spell cap (kitchen-sink: $50 over)', () => {
    const t = new BudgetTracker(40, 70);
    t.reserveForLands(2);
    t.remainingBudget = -1; // a combo seat overshot the held remainder
    const cap = t.getEffectiveCap(null);
    expect(t.landReserve).toBe(0);
    expect(t.remainingBudget).toBe(1);
    expect(cap).toBeCloseTo(8 / 70);
  });

  it('lets a staple see the budget as if nothing were held', () => {
    const t = new BudgetTracker(75, 80);
    t.reserveForLands(10);
    expect(t.getEffectiveCap(null)).toBeCloseTo(6.5);
    expect(t.getEffectiveCap(null, true)).toBeCloseTo(7.5);
  });

  it('gives the held money back once, and only that', () => {
    const t = new BudgetTracker(100, 80);
    t.reserveForLands(7);
    expect(t.remainingBudget).toBe(93);
    t.releaseLandReserve();
    t.releaseLandReserve();
    expect(t.remainingBudget).toBe(100);
  });

  it('keeps the cheapest candidates affordable however far the cap fell', () => {
    const t = new BudgetTracker(2, 50);
    t.planLandPhase(10, 0.15);
    // 15% of $2 is $0.30, but $2 minus nine $0.15 slots leaves $0.65.
    expect(t.getEffectiveCap(null)).toBeCloseTo(0.3);
    t.remainingBudget = 1.5;
    t.landSlots = 10;
    expect(t.getEffectiveCap(null)).toBeCloseTo(0.15);
    t.endLandPhase();
    expect(t.getEffectiveCap(null)).toBeCloseTo(0.225);
  });
});
