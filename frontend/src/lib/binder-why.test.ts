import { describe, it, expect } from 'vitest';
import { explainPlacement } from './binder-why';
import { materializeBinders } from './materialize';
import { printingFinishKey } from './collection-mutations';
import type { BinderDef, BinderFilter, EnrichedCard } from '../types';

let n = 0;
function card(over: Partial<EnrichedCard> = {}): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o${n}`,
    name: `Card ${n}`,
    typeLine: 'Artifact',
    colorIdentity: [],
    rarity: 'common',
    purchasePrice: 1,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: String(n),
    finish: 'nonfoil',
    ...over,
  } as unknown as EnrichedCard;
}

function binder(
  id: string,
  position: number,
  filterGroups: { name?: string; filter: BinderFilter }[],
  over: Partial<BinderDef> = {}
): BinderDef {
  return {
    id,
    name: id,
    position,
    filterGroups,
    sorts: [],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#888',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const tag = (value: string) => ({
  oracleTagChips: { chips: [{ value, negate: false }], joiners: [] },
});
const artifacts = {
  typeTokenChips: { chips: [{ value: 'artifact', negate: false }], joiners: [] },
};

function explain(target: EnrichedCard, cards: EnrichedCard[], defs: BinderDef[], binderId: string) {
  const { binders } = materializeBinders(cards, defs, { search: '' });
  return explainPlacement(
    target,
    binders.find((b) => b.def.id === binderId)!,
    defs
  );
}

describe('explainPlacement', () => {
  it('names the rule that filed a card, by its name', () => {
    const rock = card({ tags: ['mana-rock'] });
    const defs = [binder('Mana rocks', 0, [{ name: 'Rocks', filter: tag('mana-rock') }])];
    expect(explain(rock, [rock], defs, 'Mana rocks')?.reason).toBe('Filed by the rule “Rocks”.');
  });

  it('names an unnamed rule the way the editor titles it', () => {
    const rock = card();
    const defs = [binder('Artifacts', 0, [{ filter: artifacts }])];
    expect(explain(rock, [rock], defs, 'Artifacts')?.reason).toBe('Filed by the rule “artifact”.');
  });

  it('says a catch-all takes what the binders above pass on', () => {
    const rock = card();
    const defs = [binder('Everything else', 0, [{ filter: {} }])];
    expect(explain(rock, [rock], defs, 'Everything else')?.reason).toMatch(/no conditions/);
  });

  it('says a pinned card was added by hand, and nothing about other binders', () => {
    const rock = card();
    const defs = [
      binder('Pins', 0, [{ filter: tag('removal') }], { pinnedCopyIds: [rock.copyId] }),
      binder('Artifacts', 1, [{ filter: artifacts }]),
    ];
    expect(explain(rock, [rock], defs, 'Pins')).toEqual({
      reason: 'Added here by hand, so it stays whatever the rules say.',
      also: undefined,
    });
  });

  it('explains a price-margin keep', () => {
    const cheap = card({ purchasePrice: 9.6 });
    const defs = [
      binder('Pricey', 0, [{ filter: { priceMin: 10 } }], {
        lastReviewedSnapshot: { at: 1, keys: [printingFinishKey(cheap)], cardSnapshots: {} },
      }),
    ];
    expect(explain(cheap, [cheap], defs, 'Pricey')?.reason).toMatch(/price moved just past/);
  });

  it('explains a printing kept with its sibling', () => {
    const rare = card({ oracleId: 'o-x', rarity: 'rare' });
    const common = card({ oracleId: 'o-x', rarity: 'common' });
    const defs = [
      binder(
        'Rares',
        0,
        [{ filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } } }],
        { keepPrintingsTogether: true }
      ),
    ];
    expect(explain(common, [rare, common], defs, 'Rares')?.reason).toMatch(/other printings/);
  });

  it('names the binder above the user took it out of', () => {
    const rock = card();
    const defs = [
      binder('Artifacts', 0, [{ filter: artifacts }], { excludedCopyIds: [rock.copyId] }),
      binder('Everything else', 1, [{ filter: {} }]),
    ];
    expect(explain(rock, [rock], defs, 'Everything else')?.also).toBe(
      'You took it out of Artifacts, so it came here.'
    );
  });

  it('names the first binder further down whose rules match too', () => {
    const rock = card({ tags: ['mana-rock'] });
    const defs = [
      binder('Mana rocks', 0, [{ filter: tag('mana-rock') }]),
      binder('Manual', 1, [{ filter: artifacts }], { mode: 'manual' }),
      binder('Everything else', 2, [{ filter: {} }]),
      binder('Artifacts', 3, [{ filter: artifacts }]),
    ];
    // Skips the manual binder (it routes nothing by rules) and the catch-all
    // (it matches everything, so saying so tells the user nothing).
    expect(explain(rock, [rock], defs, 'Mana rocks')?.also).toBe(
      'Also matches Artifacts, further down the list.'
    );
  });

  it('says nothing for a card the binder does not hold', () => {
    const rock = card();
    const stranger = card();
    const defs = [binder('Artifacts', 0, [{ filter: artifacts }])];
    expect(explain(stranger, [rock], defs, 'Artifacts')).toBeNull();
  });
});
