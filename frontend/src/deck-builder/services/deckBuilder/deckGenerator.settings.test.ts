// OFFLINE settings-matrix STRESS test for generateDeck(). Companion to
// deckGenerator.golden.test.ts: same fixture-universe approach, but asserts
// INVARIANTS across a wide Customization matrix instead of a golden snapshot
// — a setting must be honored, or (if genuinely impossible) the deck must
// still land on the right count and disclose the compromise.
// Fully offline (same 3 mocked client boundaries as the golden test). Run
// this file in isolation — never the full suite alongside
// deckGenerator.live.test.ts's network panel.
// The fixture universe lives in __fixtures__/settings-universe.ts.
import { describe, it, expect, vi } from 'vitest';
import type {
  ScryfallCard,
  EDHRECCommanderData,
  Customization,
  GenerationMode,
} from '@/deck-builder/types';
import type { GenerationContext } from './deckGeneration/state';
import {
  COMMANDER,
  FOREST,
  GC_NAMES,
  PARTNER,
  PDH_POOL,
  PERMANENT_POOL,
  POOL,
  STATS,
  baseContext,
  customization,
  deadReducerData,
  edhrecData,
  mkEC,
  mkSC,
  realCard,
  withPartner,
} from './__fixtures__/settings-universe';

// ---- Module mocks -----------------------------------------------------------

vi.mock('@/deck-builder/services/edhrec/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: vi.fn(async () => edhrecData()),
  fetchCommanderThemeData: vi.fn(async () => edhrecData()),
  fetchPartnerCommanderData: vi.fn(async () => edhrecData()),
  fetchPartnerThemeData: vi.fn(async () => edhrecData()),
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
    getCardByName: vi.fn(async (name: string) => POOL.scMap.get(name) ?? FOREST),
    getCardsByNames: vi.fn(async (names: string[]) => {
      const m = new Map<string, ScryfallCard>();
      for (const n of names) {
        const c = POOL.scMap.get(n);
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
    // The real functions (no tagger data loaded here), as spies one case
    // re-points to model a loaded tagger (E528).
    validateCardRole: vi.fn(actual.validateCardRole),
    getCardDrawSubtype: vi.fn(actual.getCardDrawSubtype),
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
import {
  checkDeckInvariants,
  formatViolations,
  hardViolations,
  type InvariantCheck,
} from './deckInvariants';
import {
  getCardPrice,
  searchCards,
  getGameChangerNames,
} from '@/deck-builder/services/scryfall/client';
import type { ScryfallSearchResponse } from '@/deck-builder/types';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import {
  getCardDrawSubtype,
  hasTaggerData,
  validateCardRole,
} from '@/deck-builder/services/tagger/client';
import { CommanderIneligibleError, formatReleaseDate } from './commanderEligibility';

function searchResult(data: ScryfallCard[]): ScryfallSearchResponse {
  return { object: 'list', total_cards: data.length, has_more: false, data };
}

// ---- Invariant checker ------------------------------------------------------

function allCards(deck: Awaited<ReturnType<typeof generateDeck>>): ScryfallCard[] {
  return Object.values(deck.categories).flat();
}

// Universal invariants, gated by whichever settings a case turns on.
// mustIncludeCards bypass exceedsMaxPrice (confirmed by reading
// deckGenerator.ts's must-include loop) but still respect
// exceedsMaxRarity/exceedsCmcCap/notOnArena.
function assertInvariants(
  deck: Awaited<ReturnType<typeof generateDeck>>,
  cz: Customization,
  ctx: GenerationContext
) {
  const cards = allCards(deck);
  const names = cards.map((c) => c.name);
  const commanderCount = ctx.partnerCommander ? 2 : 1;
  // deckGenerator.ts: format 99 is the "standard" 100-card-total sentinel
  // (100 - commanders); any other format number is its literal total minus
  // commanders (a 60-card Brawl deck really is 60 total, not 61).
  const expectedTotal =
    cz.deckFormat === 99 ? 100 - commanderCount : cz.deckFormat - commanderCount;

  expect(cards.length).toBe(expectedTotal);
  expect(deck.stats.totalCards).toBe(cards.length);
  expect(Number.isFinite(deck.stats.averageCmc)).toBe(true);

  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const [n, c] of counts) if (n !== 'Forest') expect(c).toBe(1);

  expect(names).not.toContain(ctx.commander.name);
  if (ctx.partnerCommander) expect(names).not.toContain(ctx.partnerCommander.name);

  const deckIdentity = new Set(ctx.colorIdentity);
  for (const c of cards) {
    if (c.name === 'Forest') continue;
    for (const ci of c.color_identity ?? []) expect(deckIdentity.has(ci)).toBe(true);
  }

  const banned = new Set([...(cz.bannedCards ?? []), ...(cz.tempBannedCards ?? [])]);
  for (const bl of cz.banLists ?? []) if (bl.enabled) bl.cards.forEach((c) => banned.add(c));
  for (const b of banned) expect(names).not.toContain(b);

  // deckGenerator.ts's shortage-fill pass (~line 3037, "shortagePriceCap")
  // relaxes the per-card cap to 5x budget-per-slot when both deckBudget and
  // maxCardPrice are set and the pool ran dry — but maxCardPrice is always
  // the ceiling: the relaxed cap is min(5x budget-per-slot, maxCardPrice),
  // never above it (a must-include is the only exempt case — a forced pick
  // is seated over price regardless, and disclosed).
  if (cz.maxCardPrice != null) {
    for (const c of cards) {
      if (c.name === 'Forest' || c.isMustInclude) continue;
      const priceStr = getCardPrice(c, cz.currency);
      const price = priceStr ? parseFloat(priceStr) : NaN;
      expect(!priceStr || isNaN(price) || price > cz.maxCardPrice).toBe(false);
    }
  }

  if (cz.maxRarity) {
    const order: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };
    for (const c of cards) {
      if (c.name === 'Forest') continue;
      expect(order[c.rarity] ?? 3).toBeLessThanOrEqual(order[cz.maxRarity]);
    }
  }

  if (cz.tinyLeaders) {
    for (const c of cards)
      if (!deck.categories.lands.includes(c)) expect(c.cmc).toBeLessThanOrEqual(3);
  }

  if (cz.arenaOnly) {
    for (const c of cards) {
      if (c.name === 'Forest') continue;
      expect(c.games?.includes('arena')).toBe(true);
    }
  }

  if (deck.roleCounts)
    for (const v of Object.values(deck.roleCounts)) expect(Number.isNaN(v)).toBe(false);
  if (deck.roleTargets)
    for (const v of Object.values(deck.roleTargets)) expect(Number.isNaN(v)).toBe(false);
  if (deck.deckScore != null) expect(Number.isNaN(deck.deckScore)).toBe(false);

  if (cz.landCount === 0) {
    expect(deck.categories.lands.length).toBe(0);
  } else {
    expect(deck.categories.lands.length).toBeGreaterThanOrEqual(1);
  }
}

// E508: the committed deck-invariant checker (deckInvariants.ts, the port of
// the live stress scanner) runs over every deck this matrix builds, so a
// setting leak fails CI instead of waiting for a hand-run sweep.
//
// KNOWN_INVARIANT_FAILURES pins what fires on main today, by case and check,
// with the evidence. A pinned check must STILL fire (so a fix that clears it
// fails here until the entry is deleted), and nothing unpinned may fire.
const KNOWN_INVARIANT_FAILURES: Record<string, { checks: InvariantCheck[]; why: string }> = {};

function expectDeckInvariants(
  caseName: string,
  deck: Awaited<ReturnType<typeof generateDeck>>,
  ctx: GenerationContext
) {
  const hard = hardViolations(checkDeckInvariants(deck, ctx));
  const pinned = new Set(KNOWN_INVARIANT_FAILURES[caseName]?.checks ?? []);
  const unexpected = hard.filter((x) => !pinned.has(x.check));
  expect(formatViolations(unexpected), caseName).toBe('');
  for (const check of pinned) {
    expect(
      hard.some((x) => x.check === check),
      `${caseName}: pinned "${check}" no longer fires; delete its KNOWN_INVARIANT_FAILURES entry`
    ).toBe(true);
  }
}

// ---- The matrix --------------------------------------------------------------

interface Case {
  name: string;
  customize?: Partial<Customization>;
  ctx?: (ctx: GenerationContext) => void;
  setup?: () => void;
  extra?: (deck: Awaited<ReturnType<typeof generateDeck>>, ctx: GenerationContext) => void;
}

// E282: colorless cards only the owned-only fill paths can reach. The
// medallion names a color a mono-G deck can't cast (dead on the table); the
// rocks are legal filler that must be DISCLOSED as thin-pool fills.
const colorless = (name: string, oracle_text: string): ScryfallCard => ({
  ...mkSC(name, 'Artifact', 2, 4),
  colors: [],
  color_identity: [],
  oracle_text,
});
const RUBY_MEDALLION = colorless('Ruby Medallion', 'Red spells you cast cost {1} less to cast.');
const FILLER_ROCKS = [1, 2].map((i) => colorless(`Filler Rock ${i}`, '{T}: Add {C}.'));

// E282: a similar commander whose players run cards the user OWNS that the
// base page never lists. Owned-only builds pull them into the pool.
const SIM_NAMES = [1, 2, 3, 4, 5, 6].map((i) => `Sim_${i}`);
const SIM_COMMANDER = {
  name: 'Sim Guy',
  sanitized: 'sim-guy',
  colorIdentity: ['G'],
  cmc: 3,
  url: '',
};
function simCommanderData(): EDHRECCommanderData {
  const creatures = SIM_NAMES.map((n) => mkEC(n, 'Creature', 60));
  return {
    themes: [],
    stats: STATS,
    similarCommanders: [],
    cardlists: {
      creatures,
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: creatures,
    },
  };
}

const CASES: Case[] = [
  { name: 'baseline' },
  {
    name: 'EDHREC recommends cost reducers for colors the deck cannot cast (E524)',
    setup: () => {
      vi.mocked(fetchCommanderData).mockImplementation(async () => deadReducerData());
    },
    extra: (deck) => {
      // Restore first, so a failure below can't leak the page into later cases.
      vi.mocked(fetchCommanderData)
        .mockReset()
        .mockImplementation(async () => edhrecData());
      const names = allCards(deck).map((c) => c.name);
      expect(names).not.toContain('Ruby Medallion');
      expect(names).not.toContain("Hazoret's Monument");
    },
  },
  { name: 'deckBudget 20', customize: { deckBudget: 20 } },
  {
    name: 'deckBudget 5000 + budgetOption expensive',
    customize: { deckBudget: 5000, budgetOption: 'expensive' },
  },
  { name: 'maxCardPrice 1', customize: { maxCardPrice: 1 } },
  { name: 'maxCardPrice 0.25 + deckBudget 15', customize: { maxCardPrice: 0.25, deckBudget: 15 } },
  { name: 'currency EUR + deckBudget 20', customize: { currency: 'EUR', deckBudget: 20 } },
  {
    name: 'targetBracket 1 (game changers capped to 0)',
    customize: { targetBracket: 1 },
    setup: () => vi.mocked(getGameChangerNames).mockResolvedValueOnce(GC_NAMES),
    extra: (deck) => expect(allCards(deck).some((c) => GC_NAMES.has(c.name))).toBe(false),
  },
  {
    name: 'targetBracket 3 (up to 3 game changers)',
    customize: { targetBracket: 3 },
    setup: () => vi.mocked(getGameChangerNames).mockResolvedValueOnce(GC_NAMES),
    extra: (deck) =>
      expect(allCards(deck).filter((c) => GC_NAMES.has(c.name)).length).toBeLessThanOrEqual(3),
  },
  { name: 'targetBracket 5 (unrestricted)', customize: { targetBracket: 5 } },
  {
    // Settings-conflict disclosure (independent of the upshift composition
    // bug tracked separately below): bracket 5 implies unlimited Game
    // Changers, but a finite limit still caps the deck below that allowance.
    name: 'targetBracket 5 + gameChangerLimit 1 discloses the settings conflict',
    customize: { targetBracket: 5, gameChangerLimit: 1 },
    extra: (deck) => {
      expect(deck.gameChangerBracketConflictNote).toContain('Bracket 5');
      expect(deck.gameChangerBracketConflictNote).toContain('caps this deck at 1');
    },
  },
  {
    // Regression: applyBracketConvergence's "push UP to target" loop once
    // added Game Changers via computeUpshiftPlan without checking
    // cfg.maxGameChangers, silently overriding gameChangerLimit: 'none'.
    name: 'targetBracket 4 + gameChangerLimit none (bracket upshift honors the GC cap)',
    customize: { targetBracket: 4, gameChangerLimit: 'none' },
    setup: () => vi.mocked(getGameChangerNames).mockResolvedValueOnce(GC_NAMES),
    extra: (deck) => {
      expect(allCards(deck).filter((c) => GC_NAMES.has(c.name))).toHaveLength(0);
    },
  },
  {
    name: 'gameChangerLimit 1',
    customize: { gameChangerLimit: 1 },
    setup: () => vi.mocked(getGameChangerNames).mockResolvedValueOnce(GC_NAMES),
    extra: (deck) =>
      expect(allCards(deck).filter((c) => GC_NAMES.has(c.name)).length).toBeLessThanOrEqual(1),
  },
  { name: 'maxRarity common', customize: { maxRarity: 'common' } },
  { name: 'maxRarity uncommon', customize: { maxRarity: 'uncommon' } },
  { name: 'tinyLeaders', customize: { tinyLeaders: true } },
  { name: 'arenaOnly', customize: { arenaOnly: true } },
  { name: 'comboCount 0', customize: { comboCount: 0 } },
  { name: 'comboCount 3', customize: { comboCount: 3 } },
  { name: 'balancedRoles false', customize: { balancedRoles: false } },
  {
    name: 'tempoAutoDetect false + aggressive-early',
    customize: { tempoAutoDetect: false, tempoPacing: 'aggressive-early' },
  },
  {
    name: 'tempoAutoDetect false + late-game',
    customize: { tempoAutoDetect: false, tempoPacing: 'late-game' },
  },
  { name: 'saltTolerance 0', customize: { saltTolerance: 0 } },
  { name: 'saltTolerance 3', customize: { saltTolerance: 3 } },
  {
    name: 'landCount/nonBasic 30/30 (no basics)',
    customize: { landCount: 30, nonBasicLandCount: 30 },
  },
  {
    name: 'landCount/nonBasic 45/0 (all basics)',
    customize: { landCount: 45, nonBasicLandCount: 0 },
    extra: (deck) => expect(deck.categories.lands.every((c) => c.name === 'Forest')).toBe(true),
  },
  { name: 'landCount/nonBasic 25/5', customize: { landCount: 25, nonBasicLandCount: 5 } },
  {
    name: 'nonBasic > landCount (clamped, not crashed)',
    customize: { landCount: 20, nonBasicLandCount: 30 },
  },
  { name: 'landCount 90 (huge)', customize: { landCount: 90, nonBasicLandCount: 25 } },
  { name: 'brewLevel 0 (Staples)', customize: { brewLevel: 0 } },
  { name: 'brewLevel 1 (Brew)', customize: { brewLevel: 1 } },
  {
    name: 'mustIncludeCards: in-pool, off-color, nonexistent, duplicate, banned-by-user',
    customize: {
      mustIncludeCards: [
        'Creature_10',
        'Creature_10',
        'Offcolor Bolt',
        'Nonexistent Card Zzz',
        'Creature_11',
      ],
      bannedCards: ['Creature_11'],
    },
    extra: (deck) => {
      const names = allCards(deck).map((c) => c.name);
      expect(names.filter((n) => n === 'Creature_10').length).toBe(1);
      expect(names).not.toContain('Offcolor Bolt');
      expect(names).not.toContain('Nonexistent Card Zzz');
      expect(names).not.toContain('Creature_11');
      expect(deck.mustIncludeSkippedNote).toBeTruthy();
    },
  },
  {
    // LIVE-CONFIRMED: Lathril + "Elvish Archdruid" in both lists shipped
    // neither the card nor any note — addMustInclude's ban-conflict no-op in
    // state.ts is now routed through the same skip-note channel.
    name: 'a card both must-included and banned',
    customize: { mustIncludeCards: ['Creature_12'], bannedCards: ['Creature_12'] },
    extra: (deck) => {
      expect(allCards(deck).map((c) => c.name)).not.toContain('Creature_12');
      expect(deck.mustIncludeSkippedNote).toContain('Creature_12');
      expect(deck.mustIncludeSkippedNote).toContain('also on your ban list');
    },
  },
  {
    // A must-include is forced even over the game-changer limit — but must
    // say so. Creature_3 is in GC_NAMES; gameChangerLimit 'none' means the
    // limit is already "met" (0) the moment it's seated.
    name: 'must-include kept over the game-changer limit, disclosed',
    customize: { mustIncludeCards: ['Creature_3'], gameChangerLimit: 'none' },
    setup: () => vi.mocked(getGameChangerNames).mockResolvedValueOnce(GC_NAMES),
    extra: (deck) => {
      expect(allCards(deck).map((c) => c.name)).toContain('Creature_3');
      expect(deck.mustIncludeOverrideNote).toContain('Creature_3');
      expect(deck.mustIncludeOverrideNote).toContain('Game Changer limit');
    },
  },
  {
    // A must-include is forced even over maxCardPrice — but must say so.
    // Creature_4 is mythic-rarity ($38 by the fixture's price formula), well
    // over the $1 cap. LIVE-CONFIRMED: this shipped with zero disclosure.
    name: 'must-include kept over max card price, disclosed',
    customize: { mustIncludeCards: ['Creature_4'], maxCardPrice: 1 },
    extra: (deck) => {
      expect(allCards(deck).map((c) => c.name)).toContain('Creature_4');
      expect(deck.mustIncludeOverrideNote).toContain('Creature_4');
      expect(deck.mustIncludeOverrideNote).toContain('max card price');
    },
  },
  {
    // Only an explicit USER/deck pick is forced. An AUTO-sourced must-include
    // (combo completion, via tempMustIncludeCards) is a candidate like any
    // other pick and must respect the game-changer limit — SKIPPED, not
    // kept+disclosed, unlike the user-sourced case above.
    name: 'combo-sourced must-include is SKIPPED over the game-changer limit (not kept+disclosed)',
    customize: { tempMustIncludeCards: ['Creature_3'], gameChangerLimit: 'none' },
    setup: () => vi.mocked(getGameChangerNames).mockResolvedValueOnce(GC_NAMES),
    extra: (deck) => {
      expect(deck.mustIncludeOverrideNote).toBeUndefined();
      // Silent like every other combo-source skip (mustIncludeSkippedNote is
      // user/deck-only, mirroring noteSkip's own source filter).
      expect(deck.mustIncludeSkippedNote).toBeUndefined();
    },
  },
  {
    name: 'combo-sourced must-include is SKIPPED over max card price (not kept+disclosed)',
    customize: { tempMustIncludeCards: ['Creature_4'], maxCardPrice: 1 },
    extra: (deck) => {
      expect(allCards(deck).map((c) => c.name)).not.toContain('Creature_4');
      expect(deck.mustIncludeOverrideNote).toBeUndefined();
    },
  },
  {
    name: 'bannedCards + enabled banList + disabled banList',
    customize: {
      bannedCards: ['Creature_13'],
      banLists: [
        { id: 'x', name: 'Enabled', cards: ['Creature_14'], isPreset: false, enabled: true },
        { id: 'y', name: 'Disabled', cards: ['Creature_15'], isPreset: false, enabled: false },
      ],
    },
    extra: (deck) => {
      const names = allCards(deck).map((c) => c.name);
      expect(names).not.toContain('Creature_13');
      expect(names).not.toContain('Creature_14');
    },
  },
  {
    name: 'tempBannedCards + tempMustIncludeCards',
    customize: { tempBannedCards: ['Creature_16'], tempMustIncludeCards: ['Creature_17'] },
    extra: (deck) => {
      const names = allCards(deck).map((c) => c.name);
      expect(names).not.toContain('Creature_16');
      expect(names).toContain('Creature_17');
    },
  },
  { name: 'permanentsOnly (no-op outside oracle-role mode)', customize: { permanentsOnly: true } },
  {
    name: 'deckFormat 60 + mtgFormat brawl',
    customize: { deckFormat: 60, mtgFormat: 'brawl' },
    // E530: a Brawl build refuses a commander not legal in Brawl, so this
    // one carries the brawl legality a real Brawl commander has.
    ctx: (ctx) => {
      ctx.commander = { ...COMMANDER, legalities: { ...COMMANDER.legalities, brawl: 'legal' } };
    },
  },
  { name: 'deckFormat 40', customize: { deckFormat: 40, landCount: 16, nonBasicLandCount: 6 } },
  {
    name: 'partnerCommander (union identity, 98 cards)',
    // E530: a second commander must pair with the first, so both carry the
    // Partner keyword, as Thrasios and Tymna do.
    ctx: (ctx) => {
      ctx.commander = withPartner(COMMANDER);
      ctx.partnerCommander = withPartner(PARTNER);
      ctx.colorIdentity = ['G', 'U'];
    },
  },
  {
    name: 'collectionMode full (every nonland card owned)',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        collectionMode: true,
        collectionStrategy: 'full',
      };
      ctx.collectionNames = new Set(POOL.cardlists.allNonLand.map((c) => c.name));
    },
    extra: (deck, ctx) => {
      const owned = ctx.collectionNames!;
      for (const c of allCards(deck)) {
        if (c.name === 'Forest') continue;
        expect(owned.has(c.name)).toBe(true);
      }
    },
  },
  {
    name: 'collectionMode available (every nonland card owned)',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        collectionMode: true,
        collectionStrategy: 'available',
      };
      const names = POOL.cardlists.allNonLand.map((c) => c.name);
      ctx.collectionNames = new Set(names);
      ctx.collectionAvailableCounts = new Map(names.map((n) => [n, 4]));
    },
    extra: (deck, ctx) => {
      const owned = ctx.collectionNames!;
      for (const c of allCards(deck)) {
        if (c.name === 'Forest') continue;
        expect(owned.has(c.name)).toBe(true);
      }
    },
  },
  {
    name: 'collectionMode prefer, percent 100 (soft — no throw, right size)',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        collectionMode: true,
        collectionStrategy: 'prefer',
        collectionOwnedPercent: 100,
      };
      ctx.collectionNames = new Set(['Creature_1', 'Creature_2', 'Creature_3']);
    },
  },
  {
    // E281: "owned cards don't count" must reach the final budget note, not
    // only the pick-time gate and the converge phase — a deck built entirely
    // from the collection costs $0 to buy whatever its sticker price, so a
    // $1 budget must not be reported as blown. Failed before the fix: the
    // note summed every card's sticker price.
    name: 'ignoreOwnedBudget: the budget note sums only cards you would buy',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        collectionMode: true,
        collectionStrategy: 'full',
        deckBudget: 1,
        ignoreOwnedBudget: true,
      };
      ctx.collectionNames = new Set(
        [...POOL.cardlists.allNonLand, ...POOL.cardlists.lands].map((c) => c.name)
      );
    },
    extra: (deck) => {
      expect(deck.budgetNote ?? '').not.toContain('over your');
    },
  },
  {
    // E282: a thin owned pool falls through to the typed Scryfall fill, which
    // is gated to owned cards by color identity only — so an owned Ruby
    // Medallion (red cost reducer) used to ship in mono-green. The fill now
    // rejects payoffs naming a color the deck can't cast, and every slot the
    // commander's data couldn't fill from the collection is disclosed.
    name: 'collectionMode full: thin owned pool never seats an off-color medallion and discloses the fills',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        collectionMode: true,
        collectionStrategy: 'full',
      };
      const owned = [
        ...POOL.cardlists.creatures.slice(0, 12),
        ...POOL.cardlists.artifacts.slice(0, 4),
        ...POOL.cardlists.lands,
      ].map((c) => c.name);
      ctx.collectionNames = new Set([
        ...owned,
        RUBY_MEDALLION.name,
        ...FILLER_ROCKS.map((c) => c.name),
      ]);
    },
    setup: () => {
      vi.mocked(searchCards).mockImplementation(async () =>
        searchResult([RUBY_MEDALLION, ...FILLER_ROCKS])
      );
    },
    extra: (deck) => {
      const names = allCards(deck).map((c) => c.name);
      expect(names).not.toContain('Ruby Medallion');
      expect(names).toContain('Filler Rock 1');
      expect(deck.thinPoolFillNote).toContain('2 slots came from your collection');
      expect(deck.thinPoolFillNote).toContain('Filler Rock');
      vi.mocked(searchCards)
        .mockReset()
        .mockImplementation(async () => searchResult([]));
    },
  },
  {
    // E282: a thin owned pool widens from similar commanders' pages — owned
    // cards only — instead of falling straight to the identity-only search.
    name: 'collectionMode full: owned cards from similar commanders widen the pool',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        collectionMode: true,
        collectionStrategy: 'full',
      };
      for (const n of SIM_NAMES) POOL.scMap.set(n, mkSC(n, 'Creature', 3, 5));
      const owned = [
        ...POOL.cardlists.creatures.slice(0, 12),
        ...POOL.cardlists.artifacts.slice(0, 4),
        ...POOL.cardlists.lands,
      ].map((c) => c.name);
      ctx.collectionNames = new Set([...owned, ...SIM_NAMES]);
    },
    setup: () => {
      vi.mocked(fetchCommanderData).mockImplementation(async (name: string) =>
        name === SIM_COMMANDER.name
          ? simCommanderData()
          : { ...edhrecData(), similarCommanders: [SIM_COMMANDER] }
      );
    },
    extra: (deck) => {
      const names = allCards(deck).map((c) => c.name);
      expect(names.some((n) => SIM_NAMES.includes(n))).toBe(true);
      expect(deck.similarPoolNote).toContain('Sim Guy');
      expect(deck.similarPoolNames?.every((n) => SIM_NAMES.includes(n))).toBe(true);
      vi.mocked(fetchCommanderData)
        .mockReset()
        .mockImplementation(async () => edhrecData());
    },
  },
  {
    name: 'mtgFormat paupercommander',
    ctx: (ctx) => {
      ctx.customization = { ...ctx.customization, mtgFormat: 'paupercommander' };
      // E530: Pauper Commander builds around an uncommon creature.
      ctx.commander = { ...COMMANDER, rarity: 'uncommon' };
    },
    setup: () => {
      vi.mocked(searchCards).mockImplementation(async () => searchResult(PDH_POOL));
    },
    extra: (deck) => {
      for (const c of allCards(deck)) {
        if (c.name === 'Forest') continue;
        expect(c.legalities.paupercommander).toBe('legal');
      }
      vi.mocked(searchCards)
        .mockReset()
        .mockImplementation(async () => searchResult([]));
    },
  },
  {
    name: 'generationMode oracle-role + permanentsOnly (no instants/sorceries)',
    ctx: (ctx) => {
      ctx.customization = {
        ...ctx.customization,
        generationMode: 'oracle-role' as GenerationMode,
        permanentsOnly: true,
      };
    },
    setup: () => {
      vi.mocked(searchCards).mockImplementation(async () => searchResult(PERMANENT_POOL));
    },
    extra: (deck) => {
      for (const c of allCards(deck)) {
        expect(/instant|sorcery/i.test(c.type_line)).toBe(false);
      }
      vi.mocked(searchCards)
        .mockReset()
        .mockImplementation(async () => searchResult([]));
    },
  },
  {
    name: 'kitchen sink (budget + bracket + salt + brew + tempo + saltbanned combo)',
    customize: {
      deckBudget: 200,
      maxCardPrice: 15,
      targetBracket: 3,
      maxRarity: 'rare',
      saltTolerance: 1,
      brewLevel: 0.2,
      tempoAutoDetect: false,
      tempoPacing: 'midrange',
      comboCount: 2,
      balancedRoles: true,
      bannedCards: ['Creature_18'],
      mustIncludeCards: ['Creature_19'],
    },
    extra: (deck) => {
      const names = allCards(deck).map((c) => c.name);
      expect(names).not.toContain('Creature_18');
      expect(names).toContain('Creature_19');
    },
  },
  {
    // This squeeze exhausts the pool so hard that a large share of the deck
    // gets padded with basic lands — a plain budget/price/rarity/arena/
    // bracket squeeze with no scryfallQuery and no collectionNames, so
    // neither `collectionShortfall` nor `filterShortfall` (both cause-scoped)
    // ever fired. FIXED: buildPoolExhaustionNote compares the final land
    // count against the pre-generation plan directly (independent of which
    // phase absorbed the shortfall) and names "your budget, price, rarity,
    // or bracket settings" as the cause.
    name: 'impossible combo (budget+price+rarity+arena+bracket) discloses the pool exhaustion',
    customize: {
      deckBudget: 10,
      maxCardPrice: 0.5,
      maxRarity: 'common',
      arenaOnly: true,
      targetBracket: 1,
    },
    // assertInvariants already proves the deck still lands on the right
    // total count (padded with basics) rather than silently shipping fewer
    // cards; here we pin the disclosure itself.
    extra: (deck) => {
      const disclosed =
        !!deck.budgetNote ||
        !!deck.priceSanityNote ||
        !!deck.bracketPriceDisclosureNote ||
        !!deck.poolExhaustionNote ||
        (deck.filterShortfall ?? 0) > 0 ||
        (deck.collectionRelaxedCount ?? 0) > 0;
      expect(disclosed).toBe(true);
    },
  },
];

describe('generateDeck — settings matrix (offline stress)', () => {
  it.each(CASES.map((c): [string, Case] => [c.name, c]))('%s', async (_name, tc) => {
    const ctx = baseContext();
    if (tc.customize) ctx.customization = customization(tc.customize);
    tc.ctx?.(ctx);
    tc.setup?.();
    try {
      const deck = await generateDeck(ctx);
      assertInvariants(deck, ctx.customization, ctx);
      tc.extra?.(deck, ctx);
      // After `extra`: several cases restore their searchCards/fetch mocks
      // there, and a failure here must not leak a mock into the next case.
      expectDeckInvariants(tc.name, deck, ctx);
    } finally {
      clearGenerationCache();
    }
  });

  // Regression: the main pickers and the Scryfall shortfall fill once skipped
  // commander legality for EDHREC-sourced candidates (only lift/PDH paths
  // gated on it), so a bugged or stale feed could ship a banned card.
  // Creature_2 is stamped legalities.commander: 'banned'.
  it('a Scryfall-banned card from the EDHREC pool is filtered out', async () => {
    const ctx = baseContext();
    const deck = await generateDeck(ctx);
    const names = allCards(deck).map((c) => c.name);
    expect(names).not.toContain('Creature_2');
    expectDeckInvariants('a Scryfall-banned card from the EDHREC pool is filtered out', deck, ctx);
    clearGenerationCache();
  });

  // E528: the tagger answers getCardDrawSubtype with 'card-advantage' for any
  // card outside its draw tags (tutor/wheel/cantrip/draw), and
  // stampRoleSubtypes stamps every subtype on every pick for the secondary
  // badges. The stored breakdown used to tally those stamps across every
  // category, lands included (Krenko: card-advantage 22, live recount 5).
  // It must be the recount the deck page runs once the tagger loads; the
  // HARD report-subtypes invariant compares the two.
  it('stores the subtype breakdown the live recount computes, not the pick-time stamps', async () => {
    // A loaded tagger, as far as this deck is concerned: the artifacts are
    // ramp, and the draw-subtype lookup answers the way the real one does
    // for a card in none of its draw tags.
    const actual = await vi.importActual<typeof import('@/deck-builder/services/tagger/client')>(
      '@/deck-builder/services/tagger/client'
    );
    vi.mocked(hasTaggerData).mockReturnValue(true);
    vi.mocked(validateCardRole).mockImplementation((c) =>
      c.name.startsWith('Artifact_') ? 'ramp' : null
    );
    vi.mocked(getCardDrawSubtype).mockImplementation(() => 'card-advantage');
    const ctx = baseContext();
    try {
      const deck = await generateDeck(ctx);
      const stamped = allCards(deck).filter((c) => c.cardDrawSubtype === 'card-advantage').length;
      expect(deck.cardDrawSubtypeCounts).toBeDefined();
      expect(deck.cardDrawSubtypeCounts!['card-advantage'] ?? 0).toBeLessThan(stamped);
      expectDeckInvariants('stored subtype breakdown', deck, ctx);
    } finally {
      vi.mocked(getCardDrawSubtype).mockReset().mockImplementation(actual.getCardDrawSubtype);
      vi.mocked(validateCardRole).mockReset().mockImplementation(actual.validateCardRole);
      vi.mocked(hasTaggerData).mockReset().mockReturnValue(false);
      clearGenerationCache();
    }
  });

  // E530, USER RULING 2026-09-29: an illegal commander refuses before any
  // fetch, naming why. The real Llanowar Elves is no legendary creature.
  it('refuses an illegal commander before fetching anything', async () => {
    vi.mocked(fetchCommanderData).mockClear();
    const ctx = { ...baseContext(), commander: realCard('Llanowar Elves') };
    const run = generateDeck(ctx);
    await expect(run).rejects.toBeInstanceOf(CommanderIneligibleError);
    await expect(run).rejects.toThrow(
      "Llanowar Elves isn't a legendary creature, so it can't be your commander."
    );
    expect(fetchCommanderData).not.toHaveBeenCalled();
  });

  // USER RULING (second pass): a previewed commander, not legal only because
  // it hasn't released, builds and the deck says when it becomes legal.
  it('builds a previewed commander and discloses it', async () => {
    const preview: ScryfallCard = {
      ...COMMANDER,
      legalities: { ...COMMANDER.legalities, commander: 'not_legal' },
      released_at: '2099-06-01',
    };
    const ctx = { ...baseContext(), commander: preview };
    try {
      const deck = await generateDeck(ctx);
      expect(deck.commanderPreviewNote).toBe(
        `Test Commander isn't legal until ${formatReleaseDate('2099-06-01')}.`
      );
      assertInvariants(deck, ctx.customization, ctx);
      expectDeckInvariants('builds a previewed commander and discloses it', deck, ctx);
      expect(
        checkDeckInvariants(deck, ctx).filter((x) => x.check === 'commander-legality')
      ).toEqual([expect.objectContaining({ level: 'SOFT' })]);
    } finally {
      clearGenerationCache();
    }
  });
});
