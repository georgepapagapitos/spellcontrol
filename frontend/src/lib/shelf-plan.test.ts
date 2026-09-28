import { describe, it, expect } from 'vitest';
import {
  computeShelfPlan,
  defaultCheckedRows,
  defaultPullOutOrder,
  totalCopiesPlanned,
  SHELF_STRATEGIES,
  type ShelfStrategyId,
} from './shelf-plan';
import { materializeBinders } from './materialize';
import type { BinderDef, EnrichedCard } from '../types';

let n = 0;
function card(
  name: string,
  typeLine: string,
  colorIdentity: string[],
  rarity: string,
  purchasePrice: number,
  extra: Partial<EnrichedCard> = {}
): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o-${name}-${n}`,
    name,
    typeLine,
    colorIdentity,
    colors: colorIdentity,
    rarity,
    purchasePrice,
    setCode: extra.setCode ?? 'tst',
    setName: extra.setName ?? 'Test Set',
    collectorNumber: String(n),
    finish: 'nonfoil',
    foil: false,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    ...extra,
  } as EnrichedCard;
}

function bigPile(): EnrichedCard[] {
  const out: EnrichedCard[] = [];
  // Mono-color spells, several per color.
  for (const [color, name] of [
    ['W', 'Pacifism'],
    ['U', 'Counterspell'],
    ['B', 'Doom Blade'],
    ['R', 'Lightning Bolt'],
    ['G', 'Giant Growth'],
  ] as const) {
    for (let i = 0; i < 6; i++) {
      out.push(card(`${name} ${i}`, 'Instant', [color], 'common', 0.5 + i));
    }
  }
  // Multicolor spells.
  out.push(card('Lightning Helix', 'Instant', ['R', 'W'], 'uncommon', 1.2));
  out.push(card('Bant Charm', 'Instant', ['G', 'U', 'W'], 'rare', 2.5));
  // Colorless artifacts.
  for (let i = 0; i < 4; i++) {
    out.push(card(`Sol Ring ${i}`, 'Artifact', [], 'uncommon', 3));
  }
  // Lands, some colored some not.
  out.push(card('Forest', 'Basic Land — Forest', [], 'common', 0.1));
  out.push(card('Command Tower', 'Land', [], 'common', 0.5));
  // Priced under the Worth-$5+ pull-out's floor on purpose, so this fixture
  // can also prove a colored land lands under Lands/Everything else rather
  // than being claimed by the value pull-out first.
  out.push(card('Godless Shrine', 'Land', ['W', 'B'], 'rare', 3));
  // Commanders (legendary creatures).
  out.push(
    card('Krenko, Mob Boss', 'Legendary Creature — Goblin', ['R'], 'rare', 4, {
      legalities: { commander: 'legal' },
    })
  );
  out.push(
    card('Atraxa, Praetors Voice', 'Legendary Creature — Angel Praetor', ['W', 'U', 'B', 'G'], 'mythic', 30, {
      legalities: { commander: 'legal' },
    })
  );
  // A very expensive card, for the value pull-out / value-then-color tiers.
  out.push(card('Mana Crypt', 'Artifact', [], 'mythic', 220));
  return out;
}

function plan(
  strategy: ShelfStrategyId,
  pile: EnrichedCard[],
  existing: BinderDef[] = [],
  overrideChecked?: Set<string>
) {
  const checked = overrideChecked ?? defaultCheckedRows(strategy, pile, undefined);
  return computeShelfPlan({
    strategy,
    pullOutOrder: defaultPullOutOrder(),
    checked,
    pile,
    existingBinders: existing,
  });
}

describe('shelf-plan strategies', () => {
  for (const strategy of SHELF_STRATEGIES) {
    it(`${strategy.id}: 0 left over and every copy accounted for`, () => {
      const pile = bigPile();
      const result = plan(strategy.id, pile);
      expect(result.totals.leftOver).toBe(0);
      expect(totalCopiesPlanned(result)).toBe(pile.length);
    });

    it(`${strategy.id}: the created defs really do land what the plan says (real engine)`, () => {
      const pile = bigPile();
      const result = plan(strategy.id, pile);
      const created = result.toCreate(0);
      const { binders, uncategorized } = materializeBinders(
        pile,
        created.map((input, i) => ({
          ...input,
          id: `real-${i}`,
          position: i,
          createdAt: 0,
          updatedAt: 0,
        })),
        { search: '' }
      );
      expect(uncategorized.totalCards).toBe(0);
      const landed = binders.reduce((n, b) => n + b.totalCards, 0);
      expect(landed).toBe(result.totals.cardCount);
      // Per-binder counts match the plan's own checked-row counts, in order.
      const checkedRowCounts = result.rows.filter((r) => r.checked).map((r) => r.count);
      expect(binders.map((b) => b.totalCards)).toEqual(checkedRowCounts);
    });

    it(`${strategy.id}: is deterministic`, () => {
      const pile = bigPile();
      const a = plan(strategy.id, pile);
      const b = plan(strategy.id, pile);
      expect(a.rows.map((r) => [r.id, r.count, r.pages])).toEqual(
        b.rows.map((r) => [r.id, r.count, r.pages])
      );
      expect(a.totals).toEqual(b.totals);
    });
  }

  it('existing binders keep priority — a card already in one is never re-offered to the plan', () => {
    const pile = bigPile();
    const existing: BinderDef = {
      id: 'existing',
      name: 'My reds',
      position: 0,
      filterGroups: [{ filter: { colorIdentity: { colors: ['R'], mode: 'all' } } }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: 0,
      updatedAt: 0,
    };
    const withExisting = plan('by-color', pile, [existing]);
    const without = plan('by-color', pile, []);
    // Every red spell the existing binder already claims is one fewer card
    // for the plan to report — the plan's own total shrinks accordingly.
    expect(withExisting.totals.cardCount).toBeLessThan(without.totals.cardCount);
    expect(withExisting.totals.leftOver).toBe(0);
    // The existing binder's own claim plus the plan's total plus leftover
    // accounts for the whole pile.
    const { binders: withBinders } = materializeBinders(
      pile,
      [existing, ...withExisting.toCreate(1)].map((d, i) =>
        'id' in d && d.id === 'existing' ? d : { ...d, id: `p${i}`, createdAt: 0, updatedAt: 0 }
      ) as BinderDef[],
      { search: '' }
    );
    const existingClaim = withBinders.find((b) => b.def.id === 'existing')?.totalCards ?? 0;
    expect(existingClaim + withExisting.totals.cardCount).toBe(pile.length);
  });

  it('pull-outs take their cards before the split runs', () => {
    const pile = bigPile();
    const result = plan('by-color', pile);
    const commanderRow = result.rows.find((r) => r.id === 'commanders')!;
    expect(commanderRow.checked).toBe(true);
    expect(commanderRow.count).toBeGreaterThan(0);
    // Krenko is a commander AND red — it must show up under Commanders, not
    // under Red, because pull-outs sit ahead of the color split.
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({ ...input, id: `r${i}`, position: i, createdAt: 0, updatedAt: 0 })),
      { search: '' }
    );
    const commanderBinder = binders.find((b) => b.def.name === 'Commanders')!;
    expect(commanderBinder.sections.flatMap((s) => s.cards).some((c) => c.name === 'Krenko, Mob Boss')).toBe(
      true
    );
    const redBinder = binders.find((b) => b.def.name === 'Red');
    expect(redBinder?.sections.flatMap((s) => s.cards).some((c) => c.name === 'Krenko, Mob Boss')).toBe(
      false
    );
  });

  it('unchecking a row folds its cards into the next matching row instead of losing them', () => {
    const pile = bigPile();
    const checked = defaultCheckedRows('by-color', pile, undefined);
    checked.delete('color-w'); // uncheck White
    const result = plan('by-color', pile, [], checked);
    const white = result.rows.find((r) => r.id === 'color-w')!;
    expect(white.checked).toBe(false);
    // White cards fall through to Everything else instead of vanishing.
    expect(result.totals.leftOver).toBe(0);
    expect(totalCopiesPlanned(result)).toBe(pile.length);
  });

  it('by-color: Multicolor lands cards with 2+ identity colors, never a mono card', () => {
    const pile = bigPile();
    const result = plan('by-color', pile);
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({ ...input, id: `mc${i}`, position: i, createdAt: 0, updatedAt: 0 })),
      { search: '' }
    );
    const multi = binders.find((b) => b.def.name === 'Multicolor')!;
    for (const c of multi.sections.flatMap((s) => s.cards)) {
      expect((c.colorIdentity ?? []).length).toBeGreaterThanOrEqual(2);
    }
    expect(multi.sections.flatMap((s) => s.cards).some((c) => c.name === 'Bant Charm')).toBe(true);
  });

  it('by-color: lands never land in a color bucket, only Everything else or the Lands pull-out', () => {
    const pile = bigPile();
    const checked = defaultCheckedRows('by-color', pile, undefined);
    checked.add('lands');
    const result = plan('by-color', pile, [], checked);
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({ ...input, id: `ld${i}`, position: i, createdAt: 0, updatedAt: 0 })),
      { search: '' }
    );
    const landsBinder = binders.find((b) => b.def.name === 'Lands')!;
    const landNames = new Set(landsBinder.sections.flatMap((s) => s.cards).map((c) => c.name));
    expect(landNames.has('Godless Shrine')).toBe(true);
    for (const b of binders) {
      if (['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor'].includes(b.def.name)) {
        expect(b.sections.flatMap((s) => s.cards).some((c) => c.typeLine?.includes('Land'))).toBe(false);
      }
    }
  });

  it('value-then-color: the pricy card lands in the top tier, not the color split', () => {
    const pile = bigPile();
    const result = plan('value-then-color', pile);
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({ ...input, id: `v${i}`, position: i, createdAt: 0, updatedAt: 0 })),
      { search: '' }
    );
    const topTier = binders.find((b) => b.def.name === 'Worth $20 or more')!;
    expect(topTier.sections.flatMap((s) => s.cards).some((c) => c.name === 'Mana Crypt')).toBe(true);
  });

  it('by-set: only sets clearing the minimum become their own binder', () => {
    const pile: EnrichedCard[] = [];
    for (let i = 0; i < 40; i++) pile.push(card(`Big Set Card ${i}`, 'Instant', ['U'], 'common', 1, { setCode: 'big' }));
    for (let i = 0; i < 5; i++) pile.push(card(`Small Set Card ${i}`, 'Instant', ['R'], 'common', 1, { setCode: 'sm' }));
    const result = plan('by-set', pile);
    expect(result.rows.some((r) => r.id === 'set-big')).toBe(true);
    expect(result.rows.some((r) => r.id === 'set-sm')).toBe(false);
    expect(result.totals.leftOver).toBe(0);
    expect(totalCopiesPlanned(result)).toBe(pile.length);
  });

  it('an all-filed collection plans a shelf that lands nothing (still 0 left over)', () => {
    const pile = bigPile();
    const existing: BinderDef = {
      id: 'catch-existing',
      name: 'Everything',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: 0,
      updatedAt: 0,
    };
    const result = plan('by-color', pile, [existing]);
    expect(result.totals.cardCount).toBe(0);
    expect(result.totals.leftOver).toBe(0);
  });

  it('an empty collection plans an empty, honest shelf', () => {
    const result = plan('by-color', []);
    expect(result.totals.cardCount).toBe(0);
    expect(result.totals.leftOver).toBe(0);
    expect(result.rows.every((r) => r.count === 0)).toBe(true);
  });
});
