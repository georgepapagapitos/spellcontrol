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
import { pairCuts, type CutOutcome } from './coach-cut-swaps';
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

const base = (candidates: ScryfallCard[], holds?: (n: string) => readonly Hold[]) => ({
  objective: o,
  resolve: (n: string) => card(n),
  candidates,
  ownership: (n: string) => (holds?.(n).length ? ('in-other-deck' as const) : ('owned' as const)),
  holds,
});

const swapFor = (m: Map<string, CutOutcome>, cutName: string) => {
  const r = m.get(`upgrade:cut:${cutName}`);
  return r?.status === 'swap' ? r.change : undefined;
};

describe('free copies first', { timeout: 300_000 }, () => {
  it('offers a card with a free copy before one committed to another deck', async () => {
    const plain = await pairCuts(CUTS.map(cut), base(POOL));
    const first = [...plain.values()].find((r) => r.status === 'swap');
    if (first?.status !== 'swap') throw new Error('no accepted pairing in the baseline');
    const cutName = first.change.inName!;
    const best = first.change.name;

    // The card the objective likes best is the only copy, and Atraxa plays it.
    const holds = (n: string) => (n === best ? atraxaHold('ramp', false) : []);
    const again = await pairCuts([cut(cutName)], base(POOL, holds));
    const row = swapFor(again, cutName);
    expect(row, 'a free card is acceptable for this slot').toBeDefined();
    expect(row!.name, 'the committed card waits behind a free one').not.toBe(best);
    expect(row!.contention).toBeUndefined();
    expect(row!.ownership).toBe('owned');
  });

  it('still offers the committed card when it is the only acceptable one, naming the deck', async () => {
    const plain = await pairCuts(CUTS.map(cut), base(POOL));
    const first = [...plain.values()].find((r) => r.status === 'swap');
    if (first?.status !== 'swap') throw new Error('no accepted pairing in the baseline');
    const best = first.change.name;
    const holds = (n: string) => (n === best ? atraxaHold('boardwipe', true) : []);
    const only = await pairCuts([cut(first.change.inName!)], base([card(best)], holds));
    const row = swapFor(only, first.change.inName!);
    expect(row?.name).toBe(best);
    expect(row?.ownership).toBe('in-other-deck');
    expect(row?.contention).toContain('In your Atraxa deck.');
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
