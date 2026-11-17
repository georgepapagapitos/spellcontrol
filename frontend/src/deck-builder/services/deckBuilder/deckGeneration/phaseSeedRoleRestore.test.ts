// E1116: the Talrand case. Etherium Sculptor and Foundry Inspector (off-page
// build-around picks that read as ramp) took the ramp slots, and Mind Stone,
// in 40% of Talrand decks, never got one.
import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Artifact',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

const FETCH: Record<string, Partial<ScryfallCard>> = {
  'Off Color Rock': { color_identity: ['R'] },
  'Pricey Rock': { prices: { usd: '90.00' } },
};
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardByName: vi.fn(async (name: string) => card(name, FETCH[name])),
}));

const ROLES: Record<string, string> = {
  'Etherium Sculptor': 'ramp',
  'Foundry Inspector': 'ramp',
  'Sol Ring': 'ramp',
  'Mind Stone': 'ramp',
  'Sky Diamond': 'ramp',
  'Thin Rock': 'ramp',
  'Off Color Rock': 'ramp',
  'Pricey Rock': 'ramp',
};
vi.mock('@/deck-builder/services/tagger/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/tagger/client')>()),
  getCardRole: (name: string) => ROLES[name] ?? null,
  readsAsProtection: (c: ScryfallCard) => c.name === 'Lightning Greaves',
  isFreeInteraction: () => false,
}));

// The keeper has its own tests; here it keeps exactly the card named 'Kept'.
vi.mock('./evictionKeeper', () => ({
  evictionKeeper: () => (c: ScryfallCard) => c.name === 'Kept',
}));

import { RESTORE_MAX_SWAPS, seedRoleRestorePhase } from './phaseSeedRoleRestore';
import type { GenerationState } from './state';

const row = (name: string, inclusion: number, over: Partial<EDHRECCard> = {}): EDHRECCard =>
  ({
    name,
    sanitized: name,
    primary_type: 'Artifact',
    inclusion,
    num_decks: 900,
    ...over,
  }) as EDHRECCard;

interface Setup {
  /** Off-page picks in the deck (name -> stand-in inclusion). */
  admits?: [string, number][];
  /** The rest of the nonland deck. */
  deck: string[];
  /** The commander's page: every card with its inclusion, in the deck or not. */
  page: EDHRECCard[];
  cfg?: Record<string, unknown>;
  seedPools?: Map<string, { name: string; lift: number; coPlayPct: number; numDecks: number }[]>;
}

function finished({ admits = [], deck, page, cfg = {}, seedPools = new Map() }: Setup) {
  const cards = [...admits.map(([n]) => n), ...deck].map((n) => card(n));
  return {
    context: {
      commander: card('Talrand, Sky Summoner'),
      partnerCommander: null,
      colorIdentity: ['U'],
      customization: { mustIncludeCards: [], tempMustIncludeCards: [] },
    },
    cfg: {
      format: 99,
      mtgFormat: 'commander',
      maxCardPrice: null,
      maxRarity: null,
      maxCmc: null,
      arenaOnly: false,
      deckBudget: null,
      currency: 'USD',
      ignoreOwnedBudget: false,
      ignoreOwnedRarity: false,
      collectionStrategy: 'full',
      buildAround: ['Sai, Master Thopterist'],
      ...cfg,
    },
    usedNames: new Set(cards.map((c) => c.name)),
    bannedCards: new Set<string>(),
    categories: {
      lands: [card('Island', { type_line: 'Basic Land — Island' })],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
      synergy: cards,
      utility: [],
    },
    currentCurveCounts: {},
    currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    mustIncludeNames: [],
    mustIncludeSources: new Map(),
    liftSeedPools: seedPools,
    seedAdmitInclusion: new Map(admits),
    edhrecData: { cardlists: { allNonLand: page } },
  } as unknown as GenerationState;
}

const names = (s: GenerationState) =>
  Object.values(s.categories)
    .flat()
    .map((c) => c.name);

const TARGETS = { ramp: 4, removal: 2, boardwipe: 1, cardDraw: 4 };
const PAGE = [
  row('Sol Ring', 82),
  row('Mind Stone', 40),
  row('Sky Diamond', 38),
  row('Thin Rock', 12),
  row('Time Warp', 21),
  row('Back to Basics', 14),
  row('Filler', 26),
];

describe('seedRoleRestorePhase', () => {
  it('gives each ramp pick the best unseated ramp card, for the weakest generic card', async () => {
    const state = finished({
      admits: [
        ['Etherium Sculptor', 20],
        ['Foundry Inspector', 18],
      ],
      deck: ['Sol Ring', 'Time Warp', 'Back to Basics', 'Filler'],
      page: PAGE,
    });
    const repairs = await seedRoleRestorePhase(state, TARGETS);
    expect(repairs.map((r) => [r.cut, r.added])).toEqual([
      ['Back to Basics', 'Mind Stone'],
      ['Time Warp', 'Sky Diamond'],
    ]);
    expect(repairs[0].reason).toContain('took a ramp slot');
    expect(repairs[0].reason).toContain('40%');
    expect(names(state)).toEqual(expect.arrayContaining(['Mind Stone', 'Sky Diamond', 'Filler']));
    // The picks stay: the package is what the player asked for.
    expect(names(state)).toEqual(
      expect.arrayContaining(['Etherium Sculptor', 'Foundry Inspector'])
    );
    expect(names(state)).toHaveLength(7);
    // A cut card can't be put back by a later pass.
    expect(state.bannedCards.has('Back to Basics')).toBe(true);
  });

  it('does nothing in a build with no build-around picks', async () => {
    const state = finished({ deck: ['Sol Ring', 'Time Warp', 'Back to Basics'], page: PAGE });
    expect(await seedRoleRestorePhase(state, TARGETS)).toEqual([]);
    expect(names(state)).toHaveLength(4);
  });

  it("stops once the commander's own cards in the role reach the role's cap", async () => {
    // Target 1 caps at 3: Sol Ring plus two more of the deck's own ramp is full.
    const state = finished({
      admits: [['Etherium Sculptor', 20]],
      deck: ['Sol Ring', 'Sky Diamond', 'Thin Rock', 'Back to Basics'],
      page: PAGE,
    });
    expect(await seedRoleRestorePhase(state, { ...TARGETS, ramp: 1 })).toEqual([]);
  });

  it('never cuts protection, a theme card, a card the seeds lift, or a kept card', async () => {
    const page = [
      ...PAGE,
      row('Lightning Greaves', 5),
      row('Theme Card', 6, { isThemeSynergyCard: true }),
      row('Seed Partner', 7),
      row('Kept', 3),
    ];
    const state = finished({
      admits: [['Etherium Sculptor', 20]],
      deck: ['Sol Ring', 'Lightning Greaves', 'Theme Card', 'Seed Partner', 'Kept', 'Filler'],
      page,
      seedPools: new Map([
        [
          'Sai, Master Thopterist',
          [{ name: 'Seed Partner', lift: 5, coPlayPct: 40, numDecks: 500 }],
        ],
      ]),
    });
    // The seed has to be in the deck for its partners to count as lifted.
    state.categories.synergy.push(card('Sai, Master Thopterist'));
    const repairs = await seedRoleRestorePhase(state, TARGETS);
    expect(repairs.map((r) => [r.cut, r.added])).toEqual([['Filler', 'Mind Stone']]);
  });

  it('trades nothing when the only cards left are played nearly as often', async () => {
    const state = finished({
      admits: [['Etherium Sculptor', 20]],
      deck: ['Sol Ring', 'Filler'],
      page: [row('Sol Ring', 82), row('Mind Stone', 34), row('Filler', 26)],
    });
    expect(await seedRoleRestorePhase(state, TARGETS)).toEqual([]);
  });

  it("holds the incoming card to the player's limits", async () => {
    const page = [row('Off Color Rock', 60), row('Pricey Rock', 55), ...PAGE];
    const base = {
      admits: [['Etherium Sculptor', 20]] as [string, number][],
      deck: ['Sol Ring', 'Back to Basics'],
    };
    // Off-color is skipped outright; the next claim is not made for it.
    const offColor = await seedRoleRestorePhase(finished({ ...base, page }), TARGETS);
    expect(offColor).toEqual([]);
    const capped = finished({
      ...base,
      page: page.filter((c) => c.name !== 'Off Color Rock'),
      cfg: { maxCardPrice: 10 },
    });
    expect(await seedRoleRestorePhase(capped, TARGETS)).toEqual([]);
    const owned = finished({
      ...base,
      page: PAGE,
      cfg: { collectionStrategy: 'available' },
    });
    (owned.context as { collectionNames?: Set<string> }).collectionNames = new Set(['Sky Diamond']);
    const got = await seedRoleRestorePhase(owned, TARGETS);
    expect(got.map((r) => r.added)).toEqual(['Sky Diamond']);
  });

  it('skips a build on a total budget, and caps its trades', async () => {
    const admits = Array.from({ length: 6 }, (_, i) => [`Pick ${i}`, 10] as [string, number]);
    for (const [n] of admits) ROLES[n] = 'ramp';
    const rocks = Array.from({ length: 6 }, (_, i) => `Rock ${i}`);
    for (const n of rocks) ROLES[n] = 'ramp';
    const fillers = Array.from({ length: 6 }, (_, i) => `Weak ${i}`);
    const page = [...rocks.map((n) => row(n, 50)), ...fillers.map((n) => row(n, 5))];
    const setup = { admits, deck: fillers, page };
    expect(
      await seedRoleRestorePhase(finished({ ...setup, cfg: { deckBudget: 50 } }), {
        ...TARGETS,
        ramp: 20,
      })
    ).toEqual([]);
    const repairs = await seedRoleRestorePhase(finished(setup), { ...TARGETS, ramp: 20 });
    expect(repairs).toHaveLength(RESTORE_MAX_SWAPS);
  });
});
