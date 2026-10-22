// E1032: a max card price is honored even for the staple rocks, and the build
// report says which staples it kept out, with their price. Offline, on the
// settings-matrix fixture universe, with the real Sol Ring / Arcane Signet /
// Command Tower Scryfall rows (Sol Ring repriced to the $1.42 the report saw).
//
// The composition snapshot at the bottom was written on the code before the
// note existed: the disclosure reads the final deck and must not move a pick.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import type { GenerationContext } from './deckGeneration/state';
import {
  COMMANDER,
  FOREST,
  PARTNER,
  POOL,
  baseContext,
  customization,
  edhrecData,
  mkEC,
  realCard,
  withPartner,
} from './__fixtures__/settings-universe';

const STAPLES = new Map<string, ScryfallCard>();
function setStaplePrice(name: string, usd: string) {
  const card = realCard(name);
  card.prices = { ...card.prices, usd };
  STAPLES.set(name, card);
}
const lookup = (name: string) => STAPLES.get(name) ?? POOL.scMap.get(name);

vi.mock('@/deck-builder/services/edhrec/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: vi.fn(async () => page()),
  fetchCommanderThemeData: vi.fn(async () => page()),
  fetchPartnerCommanderData: vi.fn(async () => page()),
  fetchPartnerThemeData: vi.fn(async () => page()),
  fetchCommanderCombos: vi.fn(async () => []),
  fetchCommanderCombosRaw: vi.fn(async () => []),
  fetchSaltIndex: vi.fn(async () => new Map()),
  fetchAverageDeckMultiCopies: vi.fn(async () => null),
  fetchCardLiftPool: vi.fn(async () => []),
  fetchTagPageData: vi.fn(async () => null),
}));

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    searchCards: vi.fn(async () => ({ data: [] })),
    getCardByName: vi.fn(async (name: string) => lookup(name) ?? FOREST),
    getCardsByNames: vi.fn(async (names: string[]) => {
      const m = new Map<string, ScryfallCard>();
      for (const n of names) {
        const c = lookup(n);
        if (c) m.set(n, c);
      }
      return m;
    }),
    prefetchBasicLands: vi.fn(async () => {}),
    getCachedCard: vi.fn((name: string) => (name === 'Forest' ? FOREST : undefined)),
    getGameChangerNames: vi.fn(async () => new Set<string>()),
    upgradeCardPrintings: vi.fn(async () => {}),
    fetchMultiCopyCardNames: vi.fn(async () => new Map()),
  };
});

vi.mock('@/deck-builder/services/tagger/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/tagger/client')>();
  return {
    ...actual,
    loadTaggerData: vi.fn(async () => {}),
    hasTaggerData: vi.fn(() => false),
    getCardRole: vi.fn(() => null),
    getCardSubtype: vi.fn(() => null),
    isTapland: vi.fn(() => false),
    isProtectionPiece: vi.fn(() => false),
    isFreeInteraction: vi.fn(() => false),
    isUntapProducer: vi.fn(() => false),
    isBlinkProducer: vi.fn(() => false),
    isExileProducer: vi.fn(() => false),
    isExtraCombatPiece: vi.fn(() => false),
    isOneSidedWipe: vi.fn(() => false),
    isExtraTurn: vi.fn(() => false),
    getWipeScope: vi.fn(() => ({
      creatures: false,
      artifacts: false,
      enchantments: false,
      planeswalkers: false,
      all: false,
    })),
  };
});

import { generateDeck, clearGenerationCache } from './deckGenerator';
import { assembleBuildReport } from './buildReport';

/** Sol Ring tops the page at 91%, as on Rin and Seri's. */
let solRingOnPage = true;
function page(): EDHRECCommanderData {
  const base = edhrecData();
  if (!solRingOnPage) return base;
  const sol = mkEC('Sol Ring', 'Artifact', 91);
  return {
    ...base,
    cardlists: {
      ...base.cardlists,
      artifacts: [sol, ...base.cardlists.artifacts],
      allNonLand: [sol, ...base.cardlists.allNonLand],
    },
  };
}

function ctx(
  overrides: Parameters<typeof customization>[0],
  extra: Partial<GenerationContext> = {}
): GenerationContext {
  return { ...baseContext(), customization: customization(overrides), ...extra };
}

const names = (deck: Awaited<ReturnType<typeof generateDeck>>) =>
  Object.values(deck.categories)
    .flat()
    .map((c) => c.name);

beforeEach(() => {
  clearGenerationCache();
  solRingOnPage = true;
  STAPLES.clear();
  setStaplePrice('Sol Ring', '1.42');
  setStaplePrice('Arcane Signet', '0.79');
  setStaplePrice('Command Tower', '0.56');
});

describe('E1032: the max card price keeps a staple rock out, and the report says so', () => {
  it('names Sol Ring and its price when it costs more than the cap', async () => {
    const deck = await generateDeck(ctx({ maxCardPrice: 1 }));
    expect(names(deck)).not.toContain('Sol Ring');
    expect(deck.priceCapLeftOutNote).toMatch(
      /^Left out because they cost more than your \$1\.00 max card price: Sol Ring \(\$1\.42, 91%\), /
    );
    // The build report carries it to the panel.
    const report = assembleBuildReport({
      generated: deck,
      customization: customization({ maxCardPrice: 1 }),
      collectionNames: new Set(),
    });
    expect(report.priceCapLeftOutNote).toBe(deck.priceCapLeftOutNote);
  });

  it('names the rock when it is not on the page, from the copy the rock phase fetched', async () => {
    solRingOnPage = false;
    const deck = await generateDeck(ctx({ maxCardPrice: 1 }));
    expect(names(deck)).not.toContain('Sol Ring');
    expect(deck.priceCapLeftOutNote).toContain('Sol Ring ($1.42), ');
  });

  it('says nothing when the staples and the page fit the cap', async () => {
    const deck = await generateDeck(ctx({ maxCardPrice: 100 }));
    expect(names(deck)).toContain('Sol Ring');
    expect(deck.priceCapLeftOutNote).toBeUndefined();
  });

  it('says nothing about an owned rock the cap skips (owned cards skip the cap)', async () => {
    const deck = await generateDeck(
      ctx(
        { maxCardPrice: 1, ignoreOwnedBudget: true, collectionMode: true },
        { collectionNames: new Set(['Sol Ring']) }
      )
    );
    expect(names(deck)).toContain('Sol Ring');
    expect(deck.priceCapLeftOutNote ?? '').not.toContain('Sol Ring');
  });

  it('still names an owned rock when owned cards do not skip the cap', async () => {
    const deck = await generateDeck(
      ctx({ maxCardPrice: 1, collectionMode: true }, { collectionNames: new Set(['Sol Ring']) })
    );
    expect(names(deck)).not.toContain('Sol Ring');
    expect(deck.priceCapLeftOutNote).toContain('Sol Ring ($1.42, 91%)');
  });

  it('says nothing without a cap', async () => {
    const deck = await generateDeck(ctx({}));
    expect(deck.priceCapLeftOutNote).toBeUndefined();
  });
});

describe('E1032: the disclosure moves no pick', () => {
  const partner = (): Partial<GenerationContext> => ({
    commander: withPartner(COMMANDER),
    partnerCommander: withPartner(PARTNER),
    colorIdentity: ['G', 'U'],
  });
  const cases: Array<[string, Parameters<typeof customization>[0], Partial<GenerationContext>]> = [
    ['mono-G, $1 cap', { maxCardPrice: 1 }, {}],
    ['mono-G, $0.25 cap and $15 budget', { maxCardPrice: 0.25, deckBudget: 15 }, {}],
    [
      'mono-G, $1 cap, owned skip the cap',
      { maxCardPrice: 1, ignoreOwnedBudget: true, collectionMode: true },
      { collectionNames: new Set(['Sol Ring', 'Creature_4', 'Artifact_2']) },
    ],
    ['mono-G, EUR 2 cap', { maxCardPrice: 2, currency: 'EUR' }, {}],
    ['partners G/U, $1 cap', { maxCardPrice: 1 }, partner()],
    ['partners G/U, $0.50 cap', { maxCardPrice: 0.5 }, partner()],
  ];

  it.each(cases)('%s', async (_label, overrides, extra) => {
    const deck = await generateDeck(ctx(overrides, extra));
    const picks: Record<string, string[]> = {};
    for (const [k, cards] of Object.entries(deck.categories)) {
      picks[k] = cards.map((c) => c.name).sort();
    }
    expect(picks).toMatchSnapshot();
  });
});
