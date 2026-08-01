import { describe, it, expect } from 'vitest';
import {
  BUDGET_PENALTY_CAP,
  WEIGHT_FLOOR,
  computeManaPhilosophyBoosts,
  normalizeManaPhilosophy,
  resolveManaPhilosophy,
} from './manaPhilosophy';
import type { ManaPhilosophy, ScryfallCard } from '@/deck-builder/types';

const card = (p: Partial<ScryfallCard>): ScryfallCard => ({ name: 'x', ...p }) as ScryfallCard;
const WU = new Set(['W', 'U']);

// Real card shapes — the classifiers this blends over (landColorCoverage,
// hasLandUpside, isMdfcLand) read oracle text and type lines, so synthetic
// stubs would validate nothing.
const dual = card({
  name: 'Hallowed Fountain',
  type_line: 'Land — Plains Island',
  produced_mana: ['W', 'U'],
  oracle_text:
    '({T}: Add {W} or {U}.) As this land enters, you may pay 2 life. If you don’t, it enters tapped.',
  prices: { usd: '9.00' },
});
const utility = card({
  name: 'Mikokoro, Center of the Sea',
  type_line: 'Legendary Land',
  produced_mana: ['C'],
  oracle_text: '{T}: Add {C}. {2}, {T}: Each player draws a card.',
  prices: { usd: '0.50' },
});
const mdfc = card({
  name: 'Sea Gate Restoration',
  type_line: 'Sorcery // Land',
  layout: 'modal_dfc',
  produced_mana: ['U'],
  card_faces: [
    { type_line: 'Sorcery', oracle_text: 'Draw cards equal to the number of cards in your hand.' },
    {
      type_line: 'Land — Island',
      oracle_text:
        'As this land enters, you may pay 3 life. If you don’t, it enters tapped. {T}: Add {U}.',
    },
  ],
  prices: { usd: '6.00' },
} as Partial<ScryfallCard>);

const pool = new Map([
  [dual.name, dual],
  [utility.name, utility],
  [mdfc.name, mdfc],
]);
const wheel = (w: Partial<ManaPhilosophy>): ManaPhilosophy => ({
  reliable: 0,
  greedy: 0,
  spelllands: 0,
  budget: 0,
  ...w,
});

describe('resolveManaPhilosophy', () => {
  it('is OFF unless explicitly set — no smart default', () => {
    expect(resolveManaPhilosophy({})).toBeNull();
    expect(resolveManaPhilosophy({ manaPhilosophy: undefined })).toBeNull();
    expect(resolveManaPhilosophy({ manaPhilosophy: wheel({ greedy: 1 }) })).not.toBeNull();
  });
});

describe('normalizeManaPhilosophy', () => {
  it('sums to 1 and never lets an axis reach 0 (the #1408 no-gradient rule)', () => {
    const w = normalizeManaPhilosophy(wheel({ greedy: 1 }));
    const total = w.reliable + w.greedy + w.spelllands + w.budget;
    expect(total).toBeCloseTo(1, 10);
    for (const v of Object.values(w)) expect(v).toBeGreaterThan(0);
    // The three zeroed axes each keep the floor's share, greedy takes the rest.
    expect(w.reliable).toBeCloseTo(WEIGHT_FLOOR / (1 + 4 * WEIGHT_FLOOR), 10);
    expect(w.greedy).toBeGreaterThan(0.8);
  });

  it('clamps negative and non-finite weights to 0 before flooring', () => {
    const w = normalizeManaPhilosophy({
      reliable: -5,
      greedy: NaN,
      spelllands: 0,
      budget: 1,
    });
    expect(w.reliable + w.greedy + w.spelllands + w.budget).toBeCloseTo(1, 10);
    expect(w.reliable).toBeCloseTo(w.greedy, 10);
    expect(w.budget).toBeGreaterThan(w.reliable);
  });
});

describe('computeManaPhilosophyBoosts', () => {
  it('reliable favors the fixing dual over the colorless-ish utility land', () => {
    const b = computeManaPhilosophyBoosts(pool, WU, wheel({ reliable: 1 }));
    expect(b.get(dual.name)!).toBeGreaterThan(b.get(utility.name)!);
  });

  it('greedy reverses that — the utility land has the ability', () => {
    const b = computeManaPhilosophyBoosts(pool, WU, wheel({ greedy: 1 }));
    expect(b.get(utility.name)!).toBeGreaterThan(b.get(dual.name)!);
  });

  it('spelllands lifts the MDFC above the plain dual with equal fixing', () => {
    const b = computeManaPhilosophyBoosts(pool, WU, wheel({ spelllands: 1 }));
    expect(b.get(mdfc.name)!).toBeGreaterThan(b.get(dual.name)!);
  });

  it('budget penalizes by price, capped', () => {
    const b = computeManaPhilosophyBoosts(pool, WU, wheel({ budget: 1 }));
    expect(b.get(dual.name)!).toBeLessThan(b.get(utility.name)!);
    // $9 × 3 = $27 uncapped; a $100 land must not read worse than the cap.
    const pricey = card({ ...dual, name: 'Pricey', prices: { usd: '100.00' } });
    const capped = computeManaPhilosophyBoosts(
      new Map([[pricey.name, pricey]]),
      WU,
      wheel({ budget: 1 })
    );
    expect(capped.get(pricey.name)!).toBeGreaterThanOrEqual(-BUDGET_PENALTY_CAP);
  });

  it('a blend still applies every axis — no axis is switched off', () => {
    // All-greedy: the budget axis keeps its floor share, so a price difference
    // still moves the number. This is the invariant the wheel exists to hold.
    const cheapDual = card({ ...dual, name: 'Cheap Dual', prices: { usd: '0.10' } });
    const b = computeManaPhilosophyBoosts(
      new Map([
        [dual.name, dual],
        [cheapDual.name, cheapDual],
      ]),
      WU,
      wheel({ greedy: 1 })
    );
    expect(b.get(cheapDual.name)!).toBeGreaterThan(b.get(dual.name)!);
  });
});
