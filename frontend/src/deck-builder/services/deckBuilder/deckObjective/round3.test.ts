// @vitest-environment node
//
// E513 round 3: the flag-on gate's regressed and neutral decks, each over the
// real cards it happened with (Scryfall records from the same bulk file).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { checkConstraints } from './index';
import { optimizeDeck } from './optimizer';
import { rolesMovedBetween } from './swapReasons';
import { countRoles, factsRoleOf, protectedCards, trustVerdict } from './trustRegion';
import { BASELINE, TREATMENT, card, cards, merenCtx, swap } from './__fixtures__/objectiveFixture';

const SMALL = { maxSwaps: 0, maxEvaluations: 60, shortlist: 12, escapes: 0 };
const ONLY_OWNED = { deckFormat: 99, currency: 'USD', collectionMode: true } as const;

/** Meren's list with Swiftfoot Boots unowned in an owned-only build, ramp at its cap. */
function bootsRow(ownedExtras: string[], over: Parameters<typeof merenCtx>[0] = {}) {
  const roleOf = factsRoleOf(merenCtx());
  const ramp = countRoles(BASELINE, roleOf).ramp;
  // cap = target + max(2, 20% of target): a target of ramp - 2 puts the deck one under it at most.
  const target = Math.max(1, ramp - 2);
  const owned = new Set([
    ...BASELINE.cards.map((c) => c.name).filter((n) => n !== 'Swiftfoot Boots'),
    ...ownedExtras,
  ]);
  return merenCtx({
    customization: { ...ONLY_OWNED, collectionStrategy: 'full' },
    ownedNames: owned,
    roleTargets: { ...merenCtx().roleTargets, ramp: target },
    roleOf,
    ...over,
  });
}

describe('a forced repair keeps the cap (Krenko owned-only: Swiftfoot Boots went to Vexing Puzzlebox)', () => {
  it('takes the card of a role under its cap before one over it, and says so', () => {
    const ctx = bootsRow(['Vexing Puzzlebox', 'Grave Pact']);
    const r = optimizeDeck(BASELINE, cards('Vexing Puzzlebox', 'Grave Pact'), ctx, SMALL);
    const repair = r.swaps.find((s) => s.kind === 'repair')!;
    expect(repair.out).toEqual(['Swiftfoot Boots']);
    expect(repair.in).toEqual(['Grave Pact']);
    // No owned protection piece exists, so the class floor is what gives.
    expect(repair.disclosure).toMatch(/class floor/);
    expect(checkConstraints(r.deck, ctx)).toEqual([]);
  });

  it('goes over the cap only when nothing owned fits, and the swap says so', () => {
    const ctx = bootsRow(['Vexing Puzzlebox']);
    const r = optimizeDeck(BASELINE, cards('Vexing Puzzlebox'), ctx, SMALL);
    const repair = r.swaps.find((s) => s.kind === 'repair')!;
    expect(repair.in).toEqual(['Vexing Puzzlebox']);
    expect(repair.disclosure).toMatch(/role limits.*ramp would rise/);
  });

  it('takes the cheaper of two owned protection pieces (Soul of New Phyrexia took Lightning Greaves)', () => {
    const ctx = bootsRow(['Soul of New Phyrexia', 'Heroic Intervention']);
    const r = optimizeDeck(
      BASELINE,
      cards('Soul of New Phyrexia', 'Heroic Intervention'),
      ctx,
      SMALL
    );
    const repair = r.swaps.find((s) => s.kind === 'repair')!;
    expect(repair.in).toEqual(['Heroic Intervention']);
    expect(repair.disclosure).toBeUndefined();
  });

  it('prefers an owned protection piece to both', () => {
    const ctx = bootsRow(['Vexing Puzzlebox', 'Grave Pact', 'Heroic Intervention']);
    const r = optimizeDeck(
      BASELINE,
      cards('Vexing Puzzlebox', 'Grave Pact', 'Heroic Intervention'),
      ctx,
      SMALL
    );
    const repair = r.swaps.find((s) => s.kind === 'repair')!;
    expect(repair.in).toEqual(['Heroic Intervention']);
    expect(repair.disclosure).toBeUndefined();
  });
});

describe('an owned share the generator disclosed short (Yuriko partial 100: Sol Ring went for Vexing Puzzlebox)', () => {
  it('leaves the shortfall rather than evict a staple rock for it', () => {
    const owned = new Set(
      BASELINE.cards.map((c) => c.name).filter((n) => !['Sol Ring'].includes(n))
    );
    owned.add('Vexing Puzzlebox');
    const base = BASELINE;
    const ctx = merenCtx({
      customization: {
        ...ONLY_OWNED,
        collectionStrategy: 'partial',
        collectionOwnedPercent: 100,
      },
      ownedNames: owned,
    });
    expect(checkConstraints(base, ctx).map((v) => v.check)).toEqual(['owned-share']);
    const r = optimizeDeck(base, cards('Vexing Puzzlebox'), ctx, SMALL);
    expect(r.swaps.map((s) => s.out).flat()).not.toContain('Sol Ring');
    expect(r.deck.cards.some((c) => c.name === 'Sol Ring')).toBe(true);
  });
});

describe('swap reasons count the way the report does, in the order the swaps were made (Meren ramp 15 → 14 twice)', () => {
  it('states each ramp cut from the count the swap before it left', () => {
    const roleOf = factsRoleOf(merenCtx());
    const targets = merenCtx().roleTargets;
    const ramp = (d: typeof BASELINE) => countRoles(d, roleOf).ramp;
    const rampCards = BASELINE.cards.filter((c) => roleOf(c) === 'ramp' && c.name !== 'Sol Ring');
    const a = swap(BASELINE, rampCards[0].name, 'Counterspell');
    const b = swap(a, rampCards[1].name, 'Swords to Plowshares');
    const n = ramp(BASELINE);
    expect(rolesMovedBetween(BASELINE, a, roleOf, targets)).toContain(
      `ramp ${n} → ${n - 1} of target ${targets.ramp}`
    );
    expect(rolesMovedBetween(a, b, roleOf, targets)).toContain(
      `ramp ${n - 1} → ${n - 2} of target ${targets.ramp}`
    );
  });
});

describe('the search is never stricter than the generator disclosed ownership relaxation', () => {
  const owned = (unowned: string[], extra: string[]) =>
    new Set([...BASELINE.cards.map((c) => c.name).filter((n) => !unowned.includes(n)), ...extra]);

  it('leaves an owned-only build unowned Swiftfoot Boots (Krenko coll-full), where it repaired before', () => {
    const ctx = merenCtx({
      customization: { ...ONLY_OWNED, collectionStrategy: 'full' },
      ownedNames: owned(['Swiftfoot Boots'], ['Heroic Intervention']),
    });
    expect(checkConstraints(BASELINE, ctx).map((v) => v.check)).toEqual(['collection']);
    const r = optimizeDeck(BASELINE, cards('Heroic Intervention'), ctx, {
      ...SMALL,
      leave: new Set(['collection']),
    });
    expect(r.swaps).toEqual([]);
    expect(r.deck.cards.some((c) => c.name === 'Swiftfoot Boots')).toBe(true);
  });

  it('leaves a partial build unowned staple at the disclosed shortfall (Sythis partial 100: Sanctum Weaver)', () => {
    const ctx = merenCtx({
      customization: { ...ONLY_OWNED, collectionStrategy: 'partial', collectionOwnedPercent: 100 },
      ownedNames: owned(['Sakura-Tribe Elder'], ['Vexing Puzzlebox']),
    });
    const r = optimizeDeck(BASELINE, cards('Vexing Puzzlebox'), ctx, {
      ...SMALL,
      leave: new Set(['owned-share']),
    });
    expect(r.swaps.flatMap((s) => s.out)).not.toContain('Sakura-Tribe Elder');
  });

  it('still repairs a Game Changer limit the generator broke (Atraxa coll-full bracket 2)', () => {
    const ctx = merenCtx({
      customization: { ...ONLY_OWNED, collectionStrategy: 'full', gameChangerLimit: 'none' },
      ownedNames: owned([], ['Grave Pact']),
      gameChangerNames: new Set(['Dread Return']),
    });
    expect(checkConstraints(BASELINE, ctx).map((v) => v.check)).toContain('game-changers');
    const r = optimizeDeck(BASELINE, cards('Grave Pact'), ctx, {
      ...SMALL,
      leave: new Set(['collection', 'owned-share']),
    });
    expect(r.swaps[0]).toMatchObject({ out: ['Dread Return'], kind: 'repair' });
  });
});

describe('a forced repair never seats a card the bracket estimator floors higher (Winter Moon)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  beforeAll(async () => {
    const data = JSON.parse(
      readFileSync(resolve(here, '..', '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
    );
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
    if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
  });
  afterAll(() => vi.unstubAllGlobals());

  it('leaves Boots in rather than take Winter Orb, the only owned card', () => {
    // No Game Changers, so the deck floors below bracket 4 and Winter Orb would raise it.
    const ctx = bootsRow(['Winter Orb'], { gameChangerNames: new Set() });
    const r = optimizeDeck(BASELINE, cards('Winter Orb'), ctx, SMALL);
    expect(r.swaps.flatMap((s) => s.in)).not.toContain('Winter Orb');
  });
});

describe('round 3 gate: a staple leaves for a card played as often, and a 100% owned deck takes nothing unowned', () => {
  it("compares a staple's page play rate, not its price-adjusted read (Enchantress's Presence went for Sterling Grove)", () => {
    const ctx = merenCtx();
    // Assassin's Trophy 52.1% of Meren decks; Reanimate 51.9%, but its adjusted read is higher.
    expect(ctx.qualityOf(card('Reanimate')).q).toBeGreaterThan(
      ctx.qualityOf(card("Assassin's Trophy")).q
    );
    const v = trustVerdict(
      countRoles(BASELINE, factsRoleOf(ctx)),
      cards("Assassin's Trophy"),
      cards('Reanimate'),
      ctx,
      protectedCards(BASELINE, ctx),
      0.3,
      { roleOf: factsRoleOf(ctx) }
    );
    expect(v).toMatchObject({ bound: 'staple' });
  });

  it('never brings an unowned card in at a 100% owned share (Serra Sanctum, bought for $537)', () => {
    const owned = new Set(BASELINE.cards.map((c) => c.name));
    const ctx = merenCtx({
      customization: { ...ONLY_OWNED, collectionStrategy: 'partial', collectionOwnedPercent: 100 },
      ownedNames: owned,
    });
    const pool = [
      ...TREATMENT.cards,
      ...BASELINE.cards,
      ...cards('Counterspell', 'Swords to Plowshares', 'Grave Pact', 'Pitiless Plunderer'),
    ];
    const r = optimizeDeck(BASELINE, pool, ctx, { ...SMALL, maxSwaps: 3, maxEvaluations: 120 });
    const unowned = r.swaps.flatMap((s) => s.in).filter((n) => !owned.has(n));
    expect(unowned).toEqual([]);
  });
});
