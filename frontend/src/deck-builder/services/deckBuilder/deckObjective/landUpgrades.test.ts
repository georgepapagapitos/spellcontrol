// @vitest-environment node
//
// E509: an owned nonbasic land the page never ranked takes a basic's slot when
// the mana needs it. Meren's real treatment deck holds 17 Swamps and one
// Forest next to every Golgari dual; three of the duals go back to Swamps
// here and are offered as the collection's off-page lands.
import { describe, expect, it } from 'vitest';
import { optimizeDeck } from './optimizer';
import { landUpgrades } from './landUpgrades';
import { TREATMENT, card, merenCtx, swap } from './__fixtures__/objectiveFixture';

const DUALS = ['Overgrown Tomb', 'Woodland Cemetery', 'Llanowar Wastes'];
const swapped = DUALS.reduce((d, name) => swap(d, name, 'Swamp'), TREATMENT);
// A "lean on mine" build that owns the whole deck and the three duals.
const owned = () =>
  merenCtx({
    ownedNames: new Set([...swapped.cards.map((c) => c.name), ...DUALS]),
    customization: {
      deckFormat: 99,
      currency: 'USD',
      collectionMode: true,
      collectionStrategy: 'prefer',
    },
  });
const SMALL = { maxSwaps: 3, maxEvaluations: 60, shortlist: 12, escapes: 0, comboPairs: false };

describe('landUpgrades', () => {
  const ctx = merenCtx();

  it('pairs a land with the most numerous basic it shares a colour with and the most numerous it does not', () => {
    const named = (land: string) =>
      landUpgrades(swapped, [card(land)], ctx).map((u) => swapped.cards[u.out].name);
    // Gaea's Cradle taps for green: it replaces the Forest, or a surplus Swamp.
    expect(named("Gaea's Cradle")).toEqual(['Forest', 'Swamp']);
    // A Swamp-and-Forest land shares both colours: the Swamps give way.
    expect(named('Exotic Orchard')).toHaveLength(1);
  });

  it('skips a land the deck already holds and any basic', () => {
    expect(landUpgrades(swapped, [card('Command Tower'), card('Forest')], ctx)).toEqual([]);
  });
});

describe('optimizeDeck with owned lands the page never ranked', { timeout: 60_000 }, () => {
  const pool = DUALS.map(card);

  it('seats an owned dual for a Swamp when the mana needs it', () => {
    const r = optimizeDeck(swapped, pool, owned(), {
      ...SMALL,
      landUpgrades: true,
      offPageOwned: new Set(DUALS),
    });
    const landIns = r.swaps.filter((s) => s.in.some((n) => DUALS.includes(n)));
    expect(landIns.length).toBeGreaterThan(0);
    for (const s of landIns) {
      expect(s.out).toEqual(['Swamp']);
      expect(s.terms.mana).toBeGreaterThan(0);
    }
  });

  it('leaves the basics alone without the option: the land count and mix are the plan', () => {
    const r = optimizeDeck(swapped, pool, owned(), SMALL);
    expect(
      r.swaps.filter((s) => s.out.includes('Swamp') && s.in.some((n) => DUALS.includes(n)))
    ).toEqual([]);
  });
});
