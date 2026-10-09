import { describe, it, expect } from 'vitest';
import {
  computeShelfPlan,
  defaultShelfPlan,
  defaultPullOutOrder,
  totalCopiesPlanned,
  SHELF_STRATEGIES,
  type ShelfStrategyId,
} from './shelf-plan';
import { SORT_PRESETS } from '@spellcontrol/binder-routing';
import { materializeBinders } from './materialize';
import { getColorKey } from '@spellcontrol/binder-routing';
import type { BinderDef, EnrichedCard } from '@/types/index';

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
    card(
      'Atraxa, Praetors Voice',
      'Legendary Creature — Angel Praetor',
      ['W', 'U', 'B', 'G'],
      'mythic',
      30,
      {
        legalities: { commander: 'legal' },
      }
    )
  );
  // A very expensive card, for the value pull-out / value-then-color tiers.
  out.push(card('Mana Crypt', 'Artifact', [], 'mythic', 220));
  // No color data at all (a Scryfall-lookup miss) — getColorKey reports '?'
  // for this, which must fall through every color binder to Everything
  // else, never vanish and never get its own bucket.
  out.push({
    copyId: `c-unknown-${++n}`,
    scryfallId: `sf-unknown-${n}`,
    oracleId: `o-unknown-${n}`,
    name: 'Unknown Colors Card',
    typeLine: 'Instant',
    rarity: 'common',
    purchasePrice: 2,
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: String(n),
    finish: 'nonfoil',
    foil: false,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
  } as EnrichedCard);
  return out;
}

function defaultsFor(strategy: ShelfStrategyId, pile: EnrichedCard[], existing: BinderDef[] = []) {
  return defaultShelfPlan({
    strategy,
    pullOutOrder: defaultPullOutOrder(),
    pile,
    existingBinders: existing,
  });
}

function defaultCheckedRows(strategy: ShelfStrategyId, pile: EnrichedCard[]) {
  return new Set(defaultsFor(strategy, pile).checked);
}

function plan(
  strategy: ShelfStrategyId,
  pile: EnrichedCard[],
  existing: BinderDef[] = [],
  overrideChecked?: Set<string>
) {
  const checked = overrideChecked ?? defaultsFor(strategy, pile, existing).checked;
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
      // Per-binder counts match the plan's own created-row counts, in order,
      // and not one of them is empty.
      const createdRowCounts = result.rows.filter((r) => r.creates).map((r) => r.count);
      expect(binders.map((b) => b.totalCards)).toEqual(createdRowCounts);
      expect(binders.every((b) => b.totalCards > 0)).toBe(true);
      expect(created).toHaveLength(result.totals.binderCount);
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
      created.map((input, i) => ({
        ...input,
        id: `r${i}`,
        position: i,
        createdAt: 0,
        updatedAt: 0,
      })),
      { search: '' }
    );
    const commanderBinder = binders.find((b) => b.def.name === 'Commanders')!;
    expect(
      commanderBinder.sections.flatMap((s) => s.cards).some((c) => c.name === 'Krenko, Mob Boss')
    ).toBe(true);
    const redBinder = binders.find((b) => b.def.name === 'Red');
    expect(
      redBinder?.sections.flatMap((s) => s.cards).some((c) => c.name === 'Krenko, Mob Boss')
    ).toBe(false);
  });

  it('unchecking a row folds its cards into the next matching row instead of losing them', () => {
    const pile = bigPile();
    const checked = defaultCheckedRows('by-color', pile);
    checked.delete('color-w'); // uncheck White
    const result = plan('by-color', pile, [], checked);
    const white = result.rows.find((r) => r.id === 'color-w')!;
    expect(white.checked).toBe(false);
    // White cards fall through to Everything else instead of vanishing.
    expect(result.totals.leftOver).toBe(0);
    expect(totalCopiesPlanned(result)).toBe(pile.length);
  });

  it('by-color: Multicolor lands cards by the Color-group bucket (getColorKey), never a mono card', () => {
    const pile = bigPile();
    const result = plan('by-color', pile);
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({
        ...input,
        id: `mc${i}`,
        position: i,
        createdAt: 0,
        updatedAt: 0,
      })),
      { search: '' }
    );
    const multi = binders.find((b) => b.def.name === 'Multicolor')!;
    for (const c of multi.sections.flatMap((s) => s.cards)) {
      expect(getColorKey(c)).toBe('M');
    }
    expect(multi.sections.flatMap((s) => s.cards).some((c) => c.name === 'Bant Charm')).toBe(true);
  });

  it('by-color: a card with no color data lands in Everything else, never vanishes, never its own bucket', () => {
    const pile = bigPile();
    const result = plan('by-color', pile);
    const created = result.toCreate(0);
    const { binders, uncategorized } = materializeBinders(
      pile,
      created.map((input, i) => ({
        ...input,
        id: `unk${i}`,
        position: i,
        createdAt: 0,
        updatedAt: 0,
      })),
      { search: '' }
    );
    expect(uncategorized.totalCards).toBe(0); // the catch-all took it, not left behind
    const catchAll = binders.find((b) => b.def.name === 'Everything else')!;
    const everywhereElse = binders.filter((b) => b.def.name !== 'Everything else');
    const inCatchAll = catchAll.sections
      .flatMap((s) => s.cards)
      .some((c) => c.name === 'Unknown Colors Card');
    const inAnyColorBinder = everywhereElse.some((b) =>
      b.sections.flatMap((s) => s.cards).some((c) => c.name === 'Unknown Colors Card')
    );
    expect(inCatchAll).toBe(true);
    expect(inAnyColorBinder).toBe(false);
  });

  it('every proposed binder, in every strategy, is at most 2 rule groups (readable in the rules editor)', () => {
    const pile = bigPile();
    for (const strategy of SHELF_STRATEGIES) {
      const result = plan(strategy.id, pile);
      for (const input of result.toCreate(0)) {
        expect(input.filterGroups.length, `${strategy.id}: ${input.name}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('by-color: lands never land in a color bucket, only Everything else or the Lands pull-out', () => {
    const pile = bigPile();
    const checked = defaultCheckedRows('by-color', pile);
    checked.add('lands');
    const result = plan('by-color', pile, [], checked);
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({
        ...input,
        id: `ld${i}`,
        position: i,
        createdAt: 0,
        updatedAt: 0,
      })),
      { search: '' }
    );
    const landsBinder = binders.find((b) => b.def.name === 'Lands')!;
    const landNames = new Set(landsBinder.sections.flatMap((s) => s.cards).map((c) => c.name));
    expect(landNames.has('Godless Shrine')).toBe(true);
    for (const b of binders) {
      if (['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor'].includes(b.def.name)) {
        expect(b.sections.flatMap((s) => s.cards).some((c) => c.typeLine?.includes('Land'))).toBe(
          false
        );
      }
    }
  });

  it('value-then-color: the pricy card lands in the top tier, not the color split', () => {
    const pile = bigPile();
    const result = plan('value-then-color', pile);
    const created = result.toCreate(0);
    const { binders } = materializeBinders(
      pile,
      created.map((input, i) => ({
        ...input,
        id: `v${i}`,
        position: i,
        createdAt: 0,
        updatedAt: 0,
      })),
      { search: '' }
    );
    const topTier = binders.find((b) => b.def.name === 'Worth $20 or more')!;
    expect(topTier.sections.flatMap((s) => s.cards).some((c) => c.name === 'Mana Crypt')).toBe(
      true
    );
  });

  it('by-set: only sets clearing the minimum become their own binder', () => {
    const pile: EnrichedCard[] = [];
    for (let i = 0; i < 40; i++)
      pile.push(card(`Big Set Card ${i}`, 'Instant', ['U'], 'common', 1, { setCode: 'big' }));
    for (let i = 0; i < 5; i++)
      pile.push(card(`Small Set Card ${i}`, 'Instant', ['R'], 'common', 1, { setCode: 'sm' }));
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

  it('a row that would land nothing starts unchecked and is left out of N and toCreate', () => {
    // bigPile has no sorcery, enchantment, planeswalker or battle, so By card
    // type proposes four rows with nothing for them.
    const pile = bigPile();
    const { checked, plan: result } = defaultsFor('by-type', pile);
    const zero = result.rows.filter((r) => r.count === 0);
    expect(zero.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        'type-sorcery',
        'type-enchantment',
        'type-planeswalker',
        'type-battle',
      ])
    );
    for (const row of zero) {
      if (row.section === 'catch-all') continue;
      expect(row.checked, row.id).toBe(false);
      expect(checked.has(row.id), row.id).toBe(false);
      expect(row.creates, row.id).toBe(false);
    }
    const names = result.toCreate(0).map((b) => b.name);
    for (const row of zero) expect(names).not.toContain(row.name);
    expect(result.totals.binderCount).toBe(
      result.rows.filter((r) => r.count > 0 && r.checked).length
    );
    expect(result.totals.binderCount).toBe(names.length);
    // Every row that does land cards is checked by default.
    for (const row of result.rows.filter((r) => r.count > 0 && r.section === 'split'))
      expect(row.checked, row.id).toBe(true);
  });

  it('the default plan is exactly computeShelfPlan with the checked set it returns', () => {
    const pile = bigPile();
    for (const strategy of SHELF_STRATEGIES) {
      const d = defaultsFor(strategy.id, pile);
      const again = plan(strategy.id, pile, [], d.checked);
      expect(d.plan.rows.map((r) => [r.id, r.checked, r.count, r.pages, r.creates])).toEqual(
        again.rows.map((r) => [r.id, r.checked, r.count, r.pages, r.creates])
      );
      expect(d.plan.totals).toEqual(again.totals);
    }
  });

  it('a checked row that lands nothing stays checked but is never created or counted', () => {
    // Value first, then color, with the Worth $5+ pull-out checked on top:
    // the pull-out takes every card the $20+ and $5 to $20 tiers would hold.
    const pile = bigPile();
    const checked = defaultCheckedRows('value-then-color', pile);
    checked.add('value');
    checked.add('price-20');
    checked.add('price-5');
    const result = plan('value-then-color', pile, [], checked);
    for (const id of ['price-20', 'price-5']) {
      const row = result.rows.find((r) => r.id === id)!;
      expect(row.checked, id).toBe(true);
      expect(row.count, id).toBe(0);
      expect(row.creates, id).toBe(false);
    }
    const names = result.toCreate(0).map((b) => b.name);
    expect(names).not.toContain('Worth $20 or more');
    expect(names).not.toContain('Worth $5 to $20');
    expect(result.totals.binderCount).toBe(names.length);
    expect(result.totals.leftOver).toBe(0);
    expect(totalCopiesPlanned(result)).toBe(pile.length);
  });

  it('the catch-all is not created when every card already has a row', () => {
    const pile = bigPile().filter((c) => c.name !== 'Unknown Colors Card');
    const result = plan('by-type', pile);
    const catchAll = result.rows.find((r) => r.section === 'catch-all')!;
    expect(catchAll.count).toBe(0);
    expect(catchAll.creates).toBe(false);
    expect(result.toCreate(0).map((b) => b.name)).not.toContain('Everything else');
    expect(result.totals.leftOver).toBe(0);
    expect(totalCopiesPlanned(result)).toBe(pile.length);
  });

  it("an unchecked row's count is exactly what checking it would give", () => {
    // An expensive land sits in two unchecked rows' rules (Worth $5+ and
    // Lands under Value first): checking Lands alone must still count it.
    const pile = [...bigPile(), card('Scalding Tarn', 'Land', [], 'rare', 30)];
    for (const strategy of SHELF_STRATEGIES) {
      const { checked, plan: result } = defaultsFor(strategy.id, pile);
      for (const row of result.rows.filter((r) => !r.checked)) {
        const withIt = plan(strategy.id, pile, [], new Set([...checked, row.id]));
        const after = withIt.rows.find((r) => r.id === row.id)!;
        expect([row.count, row.pages], `${strategy.id}: ${row.id}`).toEqual([
          after.count,
          after.pages,
        ]);
      }
    }
    const lands = defaultsFor('value-then-color', pile).plan.rows.find((r) => r.id === 'lands')!;
    expect(lands.checked).toBe(false);
    expect(lands.count).toBeGreaterThanOrEqual(4); // Forest, Command Tower, Godless Shrine, Scalding Tarn
  });

  it('every row names its order with the named-order name the sort pill shows', () => {
    const names = new Set(SORT_PRESETS.map((p) => p.name));
    const pile = bigPile();
    for (const strategy of SHELF_STRATEGIES) {
      for (const row of plan(strategy.id, pile).rows) {
        expect(names.has(row.orderLabel), `${strategy.id}: ${row.id} "${row.orderLabel}"`).toBe(
          true
        );
      }
    }
    const byColor = plan('by-color', pile).rows;
    expect(byColor.find((r) => r.id === 'color-w')!.orderLabel).toBe('A to Z');
    expect(byColor.find((r) => r.id === 'value')!.orderLabel).toBe('Most valuable first');
    expect(byColor.find((r) => r.section === 'catch-all')!.orderLabel).toBe('By card type');
  });
});
