// @vitest-environment node
//
// E513 round 3: the flag-on gate's regressed and neutral decks, each over the
// real cards it happened with (Scryfall records from the same bulk file).
import { describe, expect, it } from 'vitest';
import { checkConstraints } from './index';
import { optimizeDeck } from './optimizer';
import { rolesMovedBetween } from './swapReasons';
import { countRoles, factsRoleOf } from './trustRegion';
import { BASELINE, cards, merenCtx, swap } from './__fixtures__/objectiveFixture';

const SMALL = { maxSwaps: 0, maxEvaluations: 60, shortlist: 12, escapes: 0 };
const ONLY_OWNED = { deckFormat: 99, currency: 'USD', collectionMode: true } as const;

/** Meren's list with Swiftfoot Boots unowned in an owned-only build, ramp at its cap. */
function bootsRow(ownedExtras: string[]) {
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
