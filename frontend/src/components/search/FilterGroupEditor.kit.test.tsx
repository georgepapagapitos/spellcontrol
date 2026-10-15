// @vitest-environment happy-dom
/**
 * E1019: a rule row's value is edited with the filter kit. The data does not
 * change shape: an old rule (cmcMin/cmcMax, colorIdentity any/all) opens,
 * edits and routes exactly as before, and the new values (Within, mana value
 * chips) round-trip through cleanFilter and a JSON sync payload.
 */
import { useEffect, useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cardMatchesFilter } from '@spellcontrol/binder-routing';
import { cleanFilter } from '@/lib/search/clean-filter';
import { FilterGroupList } from './FilterGroupEditor';
import type { BinderFilter, BinderFilterGroup, EnrichedCard } from '@/types/index';

// Real Scryfall data (mana_cost / cmc / color_identity as printed).
const card = (over: Partial<EnrichedCard>): EnrichedCard =>
  ({ setCode: 'TST', setName: 'Test', collectorNumber: '1', quantity: 1, ...over }) as EnrichedCard;
const SOL_RING = card({ name: 'Sol Ring', manaCost: '{1}', cmc: 1, colorIdentity: [] });
const CULTIVATE = card({ name: 'Cultivate', manaCost: '{2}{G}', cmc: 3, colorIdentity: ['G'] });
const CRYPTIC = card({
  name: 'Cryptic Command',
  manaCost: '{1}{U}{U}{U}',
  cmc: 4,
  colorIdentity: ['U'],
});
const VINDICATE = card({
  name: 'Vindicate',
  manaCost: '{1}{W}{B}',
  cmc: 3,
  colorIdentity: ['W', 'B'],
});
const CRUSHER = card({ name: 'Ulamog Crusher', manaCost: '{8}', cmc: 8, colorIdentity: [] });
const GRAY_MERCHANT = card({
  name: 'Gray Merchant of Asphodel',
  manaCost: '{3}{B}{B}',
  cmc: 5,
  colorIdentity: ['B'],
});
const GYRE = card({
  name: 'Ulamog, the Infinite Gyre',
  manaCost: '{11}',
  cmc: 11,
  colorIdentity: [],
});
const CARDS = [SOL_RING, CULTIVATE, CRYPTIC, VINDICATE, CRUSHER, GRAY_MERCHANT, GYRE];
const names = (f: BinderFilter) => CARDS.filter((c) => cardMatchesFilter(c, f)).map((c) => c.name);

let latest: BinderFilter = {};
function Harness({ initial }: { initial: BinderFilter }) {
  const [groups, setGroups] = useState<BinderFilterGroup[]>([{ filter: initial }]);
  useEffect(() => {
    latest = groups[0].filter;
  });
  return (
    <FilterGroupList
      groups={groups}
      cards={CARDS}
      ownedSets={[]}
      typeSuggestions={[]}
      oracleSuggestions={[]}
      autofocusIdx={null}
      clearAutofocus={() => {}}
      onPatchFilter={(idx, p) =>
        setGroups((gs) =>
          gs.map((g, i) => (i === idx ? { ...g, filter: { ...g.filter, ...p } } : g))
        )
      }
      onSetName={() => {}}
      onAdd={() => {}}
      onDuplicate={() => {}}
      onRemove={() => {}}
    />
  );
}

describe('an old rule opens in the kit and routes as before', () => {
  const OLD: BinderFilter = {
    cmcMin: 7,
    cmcMax: 9,
    colorIdentity: { colors: ['W', 'B'], mode: 'all' },
  };

  it('shows cmcMin/cmcMax in Custom… and the saved color mode', () => {
    render(<Harness initial={OLD} />);
    expect(screen.getByRole('button', { name: 'Custom…' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect((screen.getByLabelText('Mana value, from') as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('Mana value, to') as HTMLInputElement).value).toBe('9');
    expect((screen.getByRole('radio', { name: 'Exactly these' }) as HTMLInputElement).checked).toBe(
      true
    );
    // Opening changed nothing.
    expect(latest).toEqual(OLD);
    expect(names(OLD)).toEqual([]);
  });

  it('editing the number writes cmcMin/cmcMax, never manaValues, and routes by them', () => {
    render(<Harness initial={{ cmcMin: 7, cmcMax: 9 }} />);
    fireEvent.change(screen.getByLabelText('Mana value, from'), { target: { value: '8' } });
    expect(latest.cmcMin).toBe(8);
    expect(latest.cmcMax).toBe(9);
    expect(latest.manaValues).toBeUndefined();
    expect(names(latest)).toEqual(['Ulamog Crusher']);
  });

  it('any and all colors stay editable and keep their meaning', () => {
    render(<Harness initial={{ colorIdentity: { colors: ['W', 'B'], mode: 'any' } }} />);
    expect(names(latest)).toEqual(['Vindicate', 'Gray Merchant of Asphodel']);
    fireEvent.click(screen.getByRole('radio', { name: 'Exactly these' }));
    expect(latest.colorIdentity).toEqual({ colors: ['W', 'B'], mode: 'all' });
    expect(names(latest)).toEqual(['Vindicate']);
  });
});

describe('the new values', () => {
  it('Within U+G writes mode within and routes the commander pool', () => {
    render(<Harness initial={{ colorIdentity: { colors: ['U'], mode: 'any' } }} />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Color identity' })).getByRole('button', {
        name: 'Green',
      })
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Within these' }));
    expect(latest.colorIdentity).toEqual({ colors: ['U', 'G'], mode: 'within' });
    expect(names(latest)).toEqual([
      'Sol Ring',
      'Cultivate',
      'Cryptic Command',
      'Ulamog Crusher',
      'Ulamog, the Infinite Gyre',
    ]);
  });

  it('mana value chips write manaValues and clear a leftover cmc range', () => {
    render(<Harness initial={{ cmcMin: 1, cmcMax: 2 }} />);
    // Leave Custom…, then 7+ and exactly 8.
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }));
    expect(latest.cmcMin).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '7+' }));
    expect(latest.manaValues).toEqual({ values: [], atLeast: 7 });
    expect(names(latest)).toEqual(['Ulamog Crusher', 'Ulamog, the Infinite Gyre']);
    const narrow = screen.getByRole('group', { name: 'Narrow mana value 7 and up' });
    fireEvent.click(within(narrow).getByRole('button', { name: '8' }));
    expect(latest.manaValues).toEqual({ values: [8] });
    expect(names(latest)).toEqual(['Ulamog Crusher']);
  });

  it('clearing the last chip clears the value but keeps the row', () => {
    render(<Harness initial={{ manaValues: { values: [3] } }} />);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(latest.manaValues).toBeUndefined();
    expect(screen.getByRole('group', { name: 'Filter by mana value' })).toBeTruthy();
  });

  it('round-trips through cleanFilter and a JSON sync payload', () => {
    const f: BinderFilter = {
      colorIdentity: { colors: ['U', 'G'], mode: 'within' },
      manaValues: { values: [9], atLeast: 11 },
      rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] },
    };
    const cleaned = cleanFilter(f);
    expect(JSON.parse(JSON.stringify(cleaned))).toEqual(cleaned);
    expect(cleaned.colorIdentity?.mode).toBe('within');
    expect(cleaned.manaValues).toEqual({ values: [9], atLeast: 11 });
    expect(names(cleaned)).toEqual([]);
  });
});

describe('small vocabularies', () => {
  it('rarity chips write the same expression the builder did', () => {
    render(
      <Harness initial={{ rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } }} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mythic' }));
    expect(latest.rarities).toEqual({
      chips: [
        { value: 'rare', negate: false },
        { value: 'mythic', negate: false },
      ],
      joiners: ['OR'],
    });
    // A card has one rarity: no "all of" control.
    expect(screen.queryByRole('radio', { name: 'All of these' })).toBeNull();
  });

  it('a format rule can still say "all of", and a saved NOT keeps its builder', () => {
    const { unmount } = render(
      <Harness
        initial={{ legalities: { chips: [{ value: 'modern', negate: false }], joiners: [] } }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Commander' }));
    fireEvent.click(screen.getByRole('radio', { name: 'All of these' }));
    expect(latest.legalities?.joiners).toEqual(['AND']);
    unmount();

    render(
      <Harness
        initial={{ legalities: { chips: [{ value: 'modern', negate: true }], joiners: [] } }}
      />
    );
    expect(screen.queryByRole('group', { name: 'Filter by format' })).toBeNull();
    expect(latest.legalities?.chips[0].negate).toBe(true);
  });

  it('price presets write priceMin/priceMax', () => {
    render(<Harness initial={{ priceMin: 1, priceMax: 5 }} />);
    expect(screen.getByRole('button', { name: '$1–$5' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '$20+' }));
    expect(latest.priceMin).toBe(20);
    expect(latest.priceMax).toBeUndefined();
  });
});
