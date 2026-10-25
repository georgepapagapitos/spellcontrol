// @vitest-environment node
//
// Contention in the Cuts lane, over Meren's real page: a replacement with a free
// copy is offered before one committed to another deck, and a committed one that
// is the only acceptable card says which deck loses it.
import { describe, expect, it } from 'vitest';
import {
  BASELINE,
  FIX,
  MEREN,
  card,
} from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { ScryfallCard } from '@/deck-builder/types';
import { buildCoachObjective } from './coach-objective';
import { holdRank, pairCuts, type CutOutcome } from './coach-cut-swaps';
import type { Change } from './deck-change';
import type { Hold } from './contention';

const rows = new Map(Object.entries(FIX.merenPage));
const o = buildCoachObjective({
  deck: {
    format: 'commander',
    commander: MEREN,
    partnerCommander: null,
    cards: BASELINE.cards.map((c, i) => ({ slotId: String(i), card: c, allocatedCopyId: null })),
    generationContext: {
      selectedThemes: [],
      targetBracket: 'all',
      landCount: 37,
      collectionMode: false,
      customization: { deckFormat: 99, currency: 'USD' },
    },
    bracketOverride: null,
  },
  rows,
  roleTargets: FIX.meren.roleTargets,
  combos: FIX.meren.combos,
  pacing: FIX.meren.pacing,
  liftPools: new Map(Object.entries(FIX.lift)),
  manaSim: { games: 300 },
});
if (!o.ok) throw new Error(o.reason);

const POOL: ScryfallCard[] = [
  'Demonic Tutor',
  'Kokusho, the Evening Star',
  'Butcher of Malakir',
  'Twilight Diviner',
  'Natural Order',
  'Cultivate',
  'Gilded Lotus',
  'Grave Pact',
  'Hermit Druid',
  'Enlightened Tutor',
].map((n) => card(n));

const cut = (name: string): Change => ({
  id: `upgrade:cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
  reason: 'Low inclusion',
});
const CUTS = ['Skull Prophet', 'Strionic Resonator', 'Dread Return', 'Life // Death', 'Skullclamp'];

const atraxaHold = (role: string | null, short: boolean): Hold[] => [
  { deckId: 'atraxa', deckName: 'Atraxa', role, left: 0, target: 2, short },
];

const base = (
  candidates: ScryfallCard[],
  holds?: (n: string) => readonly Hold[],
  owned: ReadonlySet<string> = new Set()
) => ({
  objective: o,
  resolve: (n: string) => card(n),
  candidates,
  ownership: (n: string) =>
    owned.has(n)
      ? ('owned' as const)
      : holds?.(n).length
        ? ('in-other-deck' as const)
        : ('unowned' as const),
  holds,
});

const swapFor = (m: Map<string, CutOutcome>, cutName: string) => {
  const r = m.get(`upgrade:cut:${cutName}`);
  return r?.status === 'swap' ? r.change : undefined;
};

/** The first accepted pairing with every card unowned: the card the objective likes best. */
async function best() {
  const plain = await pairCuts(CUTS.map(cut), base(POOL));
  const first = [...plain.values()].find((r) => r.status === 'swap');
  if (first?.status !== 'swap') throw new Error('no accepted pairing in the baseline');
  return { cutName: first.change.inName!, name: first.change.name };
}

describe('where a replacement stands against your other decks', () => {
  it('ranks a free copy, then a committed one that loses nothing, then unowned, then one that costs a role', () => {
    const none: Hold[] = [];
    const harmless = atraxaHold('ramp', false);
    const harmful = atraxaHold('boardwipe', true);
    expect(holdRank('owned', none)).toBe(0);
    expect(holdRank('in-other-deck', harmless)).toBe(1);
    expect(holdRank('unowned', none)).toBe(2);
    expect(holdRank('in-other-deck', harmful)).toBe(3);
  });
});

describe('free copies first', { timeout: 300_000 }, () => {
  it('offers a free owned card before the best card when that one is committed and costs a role', async () => {
    const { cutName, name } = await best();
    const free = POOL.filter((c) => c.name !== name).map((c) => c.name);
    const holds = (n: string) => (n === name ? atraxaHold('boardwipe', true) : []);
    const again = await pairCuts([cut(cutName)], base(POOL, holds, new Set(free)));
    const row = swapFor(again, cutName);
    expect(row, 'a free card is acceptable for this slot').toBeDefined();
    expect(row!.name).not.toBe(name);
    expect(row!.ownership).toBe('owned');
    expect(row!.contention).toBeUndefined();
  });

  it('offers a committed card that loses the other deck nothing ahead of an unowned one', async () => {
    const { cutName, name } = await best();
    const holds = (n: string) => (n === name ? atraxaHold('ramp', false) : []);
    const again = await pairCuts([cut(cutName)], base(POOL, holds));
    const row = swapFor(again, cutName);
    expect(row?.name).toBe(name);
    expect(row?.ownership).toBe('in-other-deck');
    expect(row?.contention).toContain('In your Atraxa deck.');
    expect(row?.contentionShort).toBeUndefined();
  });

  it('puts a committed card that costs a role behind unowned ones', async () => {
    const { cutName, name } = await best();
    const holds = (n: string) => (n === name ? atraxaHold('boardwipe', true) : []);
    const again = await pairCuts([cut(cutName)], base(POOL, holds));
    const row = swapFor(again, cutName);
    expect(row, 'an unowned card is acceptable for this slot').toBeDefined();
    expect(row!.name).not.toBe(name);
  });

  it('still offers the committed card when it is the only acceptable one, naming the role it costs', async () => {
    const { cutName, name } = await best();
    const holds = (n: string) => (n === name ? atraxaHold('boardwipe', true) : []);
    const only = await pairCuts([cut(cutName)], base([card(name)], holds));
    const row = swapFor(only, cutName);
    expect(row?.name).toBe(name);
    expect(row?.contention).toContain('In your Atraxa deck.');
    expect(row?.contentionShort).toBe(true);
  });

  it('leaves a free replacement without a contention note', async () => {
    const plain = await pairCuts(
      CUTS.map(cut),
      base(POOL, () => [])
    );
    for (const r of plain.values())
      if (r.status === 'swap') expect(r.change.contention).toBeUndefined();
  });
});
