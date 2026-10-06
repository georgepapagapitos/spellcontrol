// @vitest-environment node
//
// Coach's objective context over Meren's real page, cards and combos (the
// objective fixture) and a saved deck shaped the way the store holds one.
import { describe, expect, it, vi } from 'vitest';
import type { ComboMatchResponse } from '@/types/combos';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import { countedRoleOf } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  createObjectiveContext,
  scoreDeck,
} from '@/deck-builder/services/deckBuilder/deckObjective';
import {
  BASELINE,
  FIX,
  MEREN,
  TREATMENT,
  card,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import {
  MIN_PAGE_ROWS,
  buildCoachObjective,
  coachCombos,
  coachCustomization,
  loadCoachObjective,
} from './coach-objective';

const rows = new Map(Object.entries(FIX.merenPage));

type Saved = Parameters<typeof buildCoachObjective>[0]['deck'];
function savedDeck(over: Partial<Saved> = {}, cards = BASELINE.cards): Saved {
  return {
    format: 'commander',
    commander: MEREN,
    partnerCommander: null,
    cards: cards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
    generationContext: {
      selectedThemes: [],
      targetBracket: 'all',
      landCount: 37,
      collectionMode: false,
      customization: { deckFormat: 99, currency: 'USD' },
    },
    bracketOverride: null,
    ...over,
  };
}
const input = (over: Partial<Parameters<typeof buildCoachObjective>[0]> = {}) => ({
  deck: savedDeck(),
  rows,
  roleTargets: FIX.meren.roleTargets,
  combos: FIX.meren.combos,
  pacing: FIX.meren.pacing,
  liftPools: new Map(Object.entries(FIX.lift)),
  manaSim: { games: 1000 },
  ...over,
});

describe('the adapter scores a saved deck as generation scored it', { timeout: 120_000 }, () => {
  // The context phaseWholeDeckSearch.ts builds from generation's state.
  const rank = new Map<string, number>();
  for (const c of FIX.cards) if (c.edhrec_rank && rows.has(c.name)) rank.set(c.name, c.edhrec_rank);
  const generation = createObjectiveContext({
    colorIdentity: FIX.meren.colorIdentity,
    customization: { deckFormat: 99, currency: 'USD', targetBracket: 'all' },
    edhrec: rows,
    roleTargets: FIX.meren.roleTargets,
    roleOf: countedRoleOf,
    pacing: FIX.meren.pacing,
    combos: FIX.meren.combos,
    liftPools: new Map(Object.entries(FIX.lift)),
    globalRank: rank,
    manaSim: { games: 1000 },
  });

  it.each([
    ['the generated list', BASELINE],
    ['the edited list', TREATMENT],
  ])('%s: the same total, term by term', (_name, deck) => {
    const built = buildCoachObjective(input({ deck: savedDeck({}, deck.cards) }));
    if (!built.ok) throw new Error(built.reason);
    expect(built.deck.cards).toHaveLength(99);
    const want = scoreDeck(deck, generation);
    const got = scoreDeck(built.deck, built.ctx);
    // The goldfish is the only noise and both use one seed, so the totals agree to rounding.
    expect(Math.abs(got.total - want.total)).toBeLessThan(0.05);
    for (const k of Object.keys(want.terms) as Array<keyof typeof want.terms>) {
      expect(Math.abs(got.terms[k].contribution - want.terms[k].contribution), k).toBeLessThan(
        0.05
      );
    }
    expect(got.violations).toEqual(want.violations);
  });
});

describe('what the adapter will not score', () => {
  it('names a format without a commander, and a commander format without one chosen', () => {
    expect(buildCoachObjective(input({ deck: savedDeck({ format: 'modern' }) }))).toEqual({
      ok: false,
      reason: 'not-commander',
    });
    expect(buildCoachObjective(input({ deck: savedDeck({ commander: null }) }))).toEqual({
      ok: false,
      reason: 'no-commander',
    });
  });

  it('names no page, a thin page, and missing role targets', () => {
    expect(buildCoachObjective(input({ rows: new Map() }))).toEqual({
      ok: false,
      reason: 'no-page',
    });
    const thin = new Map([...rows].slice(0, MIN_PAGE_ROWS - 1));
    expect(buildCoachObjective(input({ rows: thin }))).toEqual({ ok: false, reason: 'thin-page' });
    expect(buildCoachObjective(input({ roleTargets: undefined }))).toEqual({
      ok: false,
      reason: 'no-role-targets',
    });
    expect(buildCoachObjective(input({ roleTargets: {} }))).toEqual({
      ok: false,
      reason: 'no-role-targets',
    });
  });

  it('scores a page of exactly the minimum', () => {
    const edge = new Map([...rows].filter(([, r]) => r.inclusion > 0).slice(0, MIN_PAGE_ROWS));
    expect(buildCoachObjective(input({ rows: edge })).ok).toBe(true);
  });
});

describe('the customization a saved deck is held to', () => {
  it("takes the target bracket Coach holds the deck to, the user's own first", () => {
    const gc = savedDeck().generationContext!;
    const built = (bracketOverride: 1 | 2 | 3 | 4 | 5 | null, target: number | 'all') =>
      coachCustomization(
        savedDeck({ bracketOverride, generationContext: { ...gc, targetBracket: target } })
      ).targetBracket;
    expect(built(null, 'all')).toBe('all');
    expect(built(null, 3)).toBe(3);
    expect(built(2, 4)).toBe(2);
  });

  it("sizes a Brawl list by its format's own deck size", () => {
    expect(coachCustomization(savedDeck({ format: 'brawl' })).deckFormat).toBe(60);
    expect(coachCustomization(savedDeck()).deckFormat).toBe(99);
    expect(coachCustomization(savedDeck({ format: 'brawl' })).mtgFormat).toBe('brawl');
  });

  it('reads the collection only for a deck built from it', () => {
    const owned = new Set(['Sol Ring']);
    const gc = savedDeck().generationContext!;
    const off = buildCoachObjective(input({ ownedNames: owned }));
    expect(off.ok && off.ctx.ownedNames).toBeUndefined();
    const on = buildCoachObjective(
      input({
        ownedNames: owned,
        deck: savedDeck({
          generationContext: {
            ...gc,
            collectionMode: true,
            customization: {
              ...gc.customization,
              collectionMode: true,
              collectionStrategy: 'full',
            },
          },
        }),
      })
    );
    expect(on.ok && on.ctx.ownedNames?.has('Sol Ring')).toBe(true);
  });

  it('holds an "available" deck to the copies that are free, not every owned name', () => {
    const gc = savedDeck().generationContext!;
    const built = buildCoachObjective(
      input({
        ownedNames: new Set(['Sol Ring', 'Skullclamp']),
        availableNames: new Set(['Sol Ring']),
        deck: savedDeck({
          generationContext: {
            ...gc,
            collectionMode: true,
            customization: {
              ...gc.customization,
              collectionMode: true,
              collectionStrategy: 'available',
            },
          },
        }),
      })
    );
    expect(built.ok && [...(built.ctx.ownedNames ?? [])]).toEqual(['Sol Ring']);
  });

  it('reads the global rank of the cards it was given for page cards only', () => {
    const built = buildCoachObjective(input());
    expect(built.ok && built.ctx.globalRank?.size).toBeGreaterThan(0);
    const off = card('Gilded Lotus');
    expect(rows.has(off.name)).toBe(false);
    const withOff = buildCoachObjective(input({ knownCards: [off] }));
    expect(withOff.ok && withOff.ctx.globalRank?.has(off.name)).toBe(false);
  });
});

describe('loading the page', () => {
  const page = (): EDHRECCommanderData =>
    ({
      cardlists: {
        allNonLand: [...rows].map(([name, r]) => ({ name, ...r })),
        lands: [],
      },
    }) as unknown as EDHRECCommanderData;

  it('replays the page the deck was built from, and scores on it', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page());
    const gc = savedDeck().generationContext!;
    const deck = savedDeck({
      generationContext: { ...gc, selectedThemes: [{ slug: 'zombies' } as never] },
      buildReport: { dataSource: 'theme' },
    });
    const { deck: _d, rows: _r, ...env } = input({ deck });
    const ok = await loadCoachObjective(deck, { ...env, fetchPage });
    expect(ok.ok).toBe(true);
    const [commander, partner, source] = fetchPage.mock.calls[0] as [
      ScryfallCard,
      ScryfallCard | null,
      { themes: Array<{ slug: string }> },
    ];
    expect(commander.name).toBe(MEREN.name);
    expect(partner).toBeNull();
    expect(source.themes.map((t) => t.slug)).toEqual(['zombies']);
  });

  it('is "no page" when the fetch fails, never an exception', async () => {
    const { deck, rows: _r, ...env } = input();
    const result = await loadCoachObjective(deck, {
      ...env,
      fetchPage: () => Promise.reject(new Error('offline')),
    });
    expect(result).toEqual({ ok: false, reason: 'no-page' });
  });

  it('skips the fetch for a deck it will not score', async () => {
    const fetchPage = vi.fn();
    const { rows: _r, ...env } = input();
    expect(
      await loadCoachObjective(savedDeck({ format: 'modern' }), { ...env, fetchPage })
    ).toEqual({ ok: false, reason: 'not-commander' });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('combos for the objective', () => {
  const summary = (id: string, names: string[]) => ({
    id,
    identity: 'BG',
    produces: ['Infinite mana'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 1200,
    cardCount: names.length,
    bracket: 4,
    cards: names.map((n, i) => ({ oracleId: `o${i}`, cardName: n, quantity: 1 })),
  });

  it('holds the lines in the deck and the lines one card away, the latter as near-misses', () => {
    const resp = {
      inDeck: [
        {
          combo: summary('1-2', ['Skullclamp', 'Meren of Clan Nel Toth']),
          presentOracleIds: ['o0', 'o1'],
          missingOracleIds: [],
        },
      ],
      oneAway: [
        {
          combo: summary('3-4', ['Hermit Druid', "Thassa's Oracle"]),
          presentOracleIds: ['o0'],
          missingOracleIds: ['o1'],
        },
      ],
      almostInCollection: [],
      source: 'local',
      almostInCollectionTotal: 0,
    } satisfies ComboMatchResponse;
    const out = coachCombos(resp, BASELINE.cards);
    expect(out.map((c) => [c.comboId, c.isComplete, c.missingCards])).toEqual([
      ['1-2', true, []],
      ['3-4', false, ["Thassa's Oracle"]],
    ]);
    expect(coachCombos(null, [])).toEqual([]);
  });
});
