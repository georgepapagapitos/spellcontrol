// @vitest-environment happy-dom
/**
 * The collection Filters dialog on the filter kit (board E1019): the six
 * questions people ask most up front, everything else behind "More filters",
 * a draft that commits only on "Show N cards", and the footer's "Save as a
 * binder…" link that seeds BinderEditor from the draft.
 */
import { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { BinderFilter, ChipExpression, EnrichedCard } from '@/types/index';
import type { ColorMatchMode } from '@spellcontrol/binder-routing';
import type { FilterableRow } from '@/lib/search/collection-filter';
import { useCollectionStore } from '@/store/collection';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

interface Committed {
  colorFilter: Set<string>;
  colorMode: ColorMatchMode;
  typesExpr: ChipExpression;
  rarityExpr: ChipExpression;
  cmcMin?: number;
  cmcMax?: number;
  manaValues?: BinderFilter['manaValues'];
  manaSymbols?: BinderFilter['manaSymbols'];
  priceMin?: number;
  priceMax?: number;
  setFilter: Set<string>;
}
const committed: { current: Committed } = { current: undefined as unknown as Committed };

interface HarnessProps {
  rows?: FilterableRow[];
  searchTerm?: string;
  /** Seed values for the committed state. */
  seed?: Partial<Committed>;
  /** Leave out the optional field groups the way a shared view does. */
  bare?: boolean;
  showSet?: boolean;
  showOracleText?: boolean;
}

function Harness({
  rows,
  searchTerm,
  seed = {},
  bare,
  showSet,
  showOracleText,
}: HarnessProps = {}) {
  const [supertypeExpr, setSupertypeExpr] = useState(EMPTY_EXPR);
  const [typesExpr, setTypesExpr] = useState(seed.typesExpr ?? EMPTY_EXPR);
  const [subtypeExpr, setSubtypeExpr] = useState(EMPTY_EXPR);
  const [colorFilter, setColorFilter] = useState<Set<string>>(seed.colorFilter ?? new Set());
  const [colorMode, setColorMode] = useState<ColorMatchMode>(seed.colorMode ?? 'any');
  const [rarityExpr, setRarityExpr] = useState(seed.rarityExpr ?? EMPTY_EXPR);
  const [oracleExpr, setOracleExpr] = useState(EMPTY_EXPR);
  const [legalityExpr, setLegalityExpr] = useState(EMPTY_EXPR);
  const [layoutExpr, setLayoutExpr] = useState(EMPTY_EXPR);
  const [treatmentExpr, setTreatmentExpr] = useState(EMPTY_EXPR);
  const [borderExpr, setBorderExpr] = useState(EMPTY_EXPR);
  const [setFilter, setSetFilter] = useState<Set<string>>(seed.setFilter ?? new Set());
  const [surplusOnly, setSurplusOnly] = useState(false);
  const [proxyOnly, setProxyOnly] = useState(false);
  const [groupPrintings, setGroupPrintings] = useState(true);
  const [cmcMin, setCmcMin] = useState<number | undefined>(seed.cmcMin);
  const [cmcMax, setCmcMax] = useState<number | undefined>(seed.cmcMax);
  const [manaValues, setManaValues] = useState<BinderFilter['manaValues']>(seed.manaValues);
  const [manaSymbols, setManaSymbols] = useState<BinderFilter['manaSymbols']>(seed.manaSymbols);
  const [priceMin, setPriceMin] = useState<number | undefined>(seed.priceMin);
  const [priceMax, setPriceMax] = useState<number | undefined>(seed.priceMax);
  useEffect(() => {
    committed.current = {
      colorFilter,
      colorMode,
      typesExpr,
      rarityExpr,
      cmcMin,
      cmcMax,
      manaValues,
      manaSymbols,
      priceMin,
      priceMax,
      setFilter,
    };
  });

  return (
    <CollectionFiltersDialog
      supertypeExpr={supertypeExpr}
      setSupertypeExpr={setSupertypeExpr}
      typesExpr={typesExpr}
      setTypesExpr={setTypesExpr}
      subtypeExpr={subtypeExpr}
      setSubtypeExpr={setSubtypeExpr}
      subtypeSuggestions={['Angel']}
      colorFilter={colorFilter}
      setColorFilter={setColorFilter}
      colorMode={colorMode}
      setColorMode={setColorMode}
      rarityExpr={rarityExpr}
      setRarityExpr={setRarityExpr}
      rarities={['common', 'rare']}
      oracleExpr={oracleExpr}
      setOracleExpr={setOracleExpr}
      legalityExpr={legalityExpr}
      setLegalityExpr={setLegalityExpr}
      layoutExpr={layoutExpr}
      setLayoutExpr={setLayoutExpr}
      treatmentExpr={treatmentExpr}
      setTreatmentExpr={setTreatmentExpr}
      borderExpr={borderExpr}
      setBorderExpr={setBorderExpr}
      setFilter={setFilter}
      setSetFilter={setSetFilter}
      showSet={showSet}
      showOracleText={showOracleText}
      {...(bare
        ? {}
        : {
            surplusOnly,
            setSurplusOnly,
            proxyOnly,
            setProxyOnly,
            groupPrintings,
            setGroupPrintings,
            cmcMin,
            setCmcMin,
            cmcMax,
            setCmcMax,
            manaValues,
            setManaValues,
            manaSymbols,
            setManaSymbols,
            priceMin,
            setPriceMin,
            priceMax,
            setPriceMax,
          })}
      rows={rows}
      searchTerm={searchTerm}
      activeCount={0}
    />
  );
}

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
const dialog = () => screen.getByRole('dialog', { name: 'Collection filters' });
const show = () =>
  fireEvent.click(within(dialog()).getByRole('button', { name: /^Show|^No cards/ }));
const openMore = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
const press = (name: string | RegExp) =>
  fireEvent.click(within(dialog()).getByRole('button', { name }));
const pressed = (name: string) =>
  within(dialog()).getByRole('button', { name }).getAttribute('aria-pressed');

/** The dialog's section headings, in DOM order. */
const sections = () =>
  Array.from(dialog().querySelectorAll('.filter-kit-label')).map((el) =>
    (el.firstChild?.textContent ?? '').trim()
  );

const card = (over: Partial<EnrichedCard>): EnrichedCard => ({
  copyId: 'c1',
  scryfallId: 's1',
  oracleId: 'o1',
  name: 'Sol Ring',
  setCode: 'CMR',
  setName: 'Commander Legends',
  collectorNumber: '1',
  rarity: 'uncommon',
  purchasePrice: 1,
  sourceCategory: '',
  sourceFormat: 'plain',
  foil: false,
  finish: 'nonfoil',
  typeLine: 'Artifact',
  cmc: 1,
  manaCost: '{1}',
  ...over,
});

beforeEach(() => {
  useCollectionStore.setState({ setEditingBinder: vi.fn() });
});

describe('CollectionFiltersDialog', () => {
  it('puts the six everyday questions up front, then More filters', () => {
    render(<Harness />);
    openDialog();
    expect(sections()).toEqual(['Color', 'Card type', 'Mana value', 'Rarity', 'Set', 'Rules text']);
    expect(screen.getByRole('button', { name: /More filters/ }).getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  it('heads sections with the shared sentence-case heading (E595)', () => {
    render(<Harness />);
    openDialog();
    const h = dialog().querySelector('.filter-kit-label') as HTMLElement;
    expect(h.className).toContain('form-section-heading');
  });

  it('hides what a surface cannot answer', () => {
    render(<Harness bare showSet={false} showOracleText={false} />);
    openDialog();
    expect(sections()).toEqual(['Color', 'Card type', 'Rarity']);
    openMore();
    expect(screen.queryByText('Mana cost')).toBeNull();
    expect(screen.queryByText('Price')).toBeNull();
    expect(screen.queryByText('This copy')).toBeNull();
  });

  it('merges Surplus, Proxy and Options under one "This copy" heading of switches', () => {
    render(<Harness />);
    openDialog();
    openMore();
    const thisCopy = screen.getByText('This copy').closest('section') as HTMLElement;
    expect(within(thisCopy).getAllByRole('switch')).toHaveLength(3);
    expect(within(thisCopy).getByRole('switch', { name: 'Tradeable surplus only' })).toBeTruthy();
    expect(within(thisCopy).getByRole('switch', { name: 'Proxies only' })).toBeTruthy();
    expect(within(thisCopy).getByRole('switch', { name: 'Group printings' })).toBeTruthy();
    expect(within(thisCopy).queryByRole('checkbox')).toBeNull();
  });

  it('opens More filters on its own when something inside is on, and counts it', () => {
    render(<Harness seed={{ manaSymbols: { counts: { B: 2 }, mode: 'atLeast' } }} />);
    openDialog();
    expect(screen.getByRole('button', { name: /More filters/ }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(screen.getByRole('heading', { name: 'Mana cost 2 selected' })).toBeTruthy();
  });

  it('states the count on the closed More filters row', () => {
    render(<Harness />);
    openDialog();
    openMore();
    press('Add black mana');
    openMore();
    expect(screen.getByRole('button', { name: /More filters/ }).textContent).toContain('1 on');
  });

  it('commits nothing until Show, and closing discards the draft', () => {
    render(<Harness />);
    openDialog();
    press('Creature');
    fireEvent.click(screen.getByRole('button', { name: 'Close filters without applying' }));
    expect(committed.current.typesExpr.chips).toEqual([]);
    openDialog();
    expect(pressed('Creature')).toBe('false');
  });

  it('sets a color and its Within mode with a live hint, committed by Show', () => {
    render(<Harness />);
    openDialog();
    press('Blue');
    press('Green');
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Within these' }));
    expect(
      screen.getByText('Cards that fit a blue-green deck. Colorless cards included.')
    ).toBeTruthy();
    expect(committed.current.colorFilter.size).toBe(0);
    show();
    expect([...committed.current.colorFilter].sort()).toEqual(['G', 'U']);
    expect(committed.current.colorMode).toBe('within');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('maps the card type chips onto the type expression and toggles them off', () => {
    render(<Harness />);
    openDialog();
    press('Creature');
    press('Land');
    expect(pressed('Creature')).toBe('true');
    press('Creature');
    show();
    expect(committed.current.typesExpr).toEqual({
      chips: [{ value: 'land', negate: false }],
      joiners: [],
    });
  });

  it('removes the first, a middle and the last type chip with the right joiner', () => {
    render(<Harness />);
    openDialog();
    press('Creature');
    press('Land');
    press('Artifact');
    press('Land');
    press('Creature');
    show();
    expect(committed.current.typesExpr).toEqual({
      chips: [{ value: 'artifact', negate: false }],
      joiners: [],
    });
  });

  it('keeps the joiner between the chips that remain', () => {
    render(<Harness />);
    openDialog();
    press('Creature');
    press('Land');
    press('Artifact');
    press('Land');
    show();
    expect(committed.current.typesExpr).toEqual({
      chips: [
        { value: 'creature', negate: false },
        { value: 'artifact', negate: false },
      ],
      joiners: ['OR'],
    });
  });

  it('flips an IS NOT type back to IS instead of doubling it', () => {
    render(
      <Harness
        seed={{ typesExpr: { chips: [{ value: 'creature', negate: true }], joiners: [] } }}
      />
    );
    openDialog();
    // The Type row stays because chips cannot say "not".
    expect(within(dialog()).getByText('Type')).toBeTruthy();
    press('Creature');
    show();
    expect(committed.current.typesExpr.chips).toEqual([{ value: 'creature', negate: false }]);
  });

  it('keeps subtype and supertype search, routing a typed value to its row', () => {
    render(<Harness />);
    openDialog();
    const input = within(dialog()).getByRole('combobox', {
      name: 'Search subtypes and supertypes',
    });
    fireEvent.change(input, { target: { value: 'legendary' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(dialog()).getByText('Supertypes')).toBeTruthy();
    // Types picked as chips do not repeat in a Type row.
    press('Creature');
    expect(within(dialog()).queryByText('Type')).toBeNull();
  });

  it('picks rarities as chips', () => {
    render(<Harness />);
    openDialog();
    press('Rare');
    press('Common');
    show();
    expect(committed.current.rarityExpr.chips.map((c) => c.value)).toEqual(['rare', 'common']);
  });

  it('sets exact mana values: 7+ opens a narrow row, then 9', () => {
    render(<Harness />);
    openDialog();
    press('7+');
    press('9');
    show();
    expect(committed.current.manaValues).toEqual({ values: [9] });
    expect(committed.current.cmcMin).toBeUndefined();
  });

  it('keeps all of 7 and up when 7+ is on with nothing narrowed', () => {
    render(<Harness />);
    openDialog();
    press('2');
    press('7+');
    show();
    expect(committed.current.manaValues).toEqual({ values: [2], atLeast: 7 });
  });

  it('Custom… writes the mana value range and clears the chips', () => {
    render(<Harness seed={{ manaValues: { values: [3] } }} />);
    openDialog();
    press('Custom…');
    const input = within(dialog()).getByRole('spinbutton', { name: 'Mana value' });
    fireEvent.change(input, { target: { value: '4' } });
    show();
    expect(committed.current.cmcMin).toBe(4);
    expect(committed.current.manaValues).toBeUndefined();
  });

  it('opens Custom… when a mana value range is already set', () => {
    render(<Harness seed={{ cmcMin: 2, cmcMax: 5 }} />);
    openDialog();
    expect(within(dialog()).getByRole('radio', { name: 'Between' })).toBeTruthy();
  });

  it('leaving Custom… returns to the chips and drops the range', () => {
    render(<Harness seed={{ cmcMin: 2, cmcMax: 5 }} />);
    openDialog();
    press('Custom…');
    press('3');
    show();
    expect(committed.current.cmcMin).toBeUndefined();
    expect(committed.current.cmcMax).toBeUndefined();
    expect(committed.current.manaValues).toEqual({ values: [3] });
  });

  it('builds a mana cost on the pad and commits it as the engine query', () => {
    render(<Harness />);
    openDialog();
    openMore();
    press('Add black mana');
    press('Add black mana, 1 added');
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Exactly these colored' }));
    show();
    expect(committed.current.manaSymbols).toEqual({ counts: { B: 2 }, mode: 'exactColored' });
  });

  it('commits no mana cost for a pad that constrains nothing', () => {
    render(<Harness />);
    openDialog();
    openMore();
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Exactly these colored' }));
    show();
    expect(committed.current.manaSymbols).toBeUndefined();
  });

  it('sets a price preset', () => {
    render(<Harness />);
    openDialog();
    openMore();
    press('$1–$5');
    show();
    expect(committed.current.priceMin).toBe(1);
    expect(committed.current.priceMax).toBe(5);
  });

  it('lists each active draft filter as a chip and removes just its slice', () => {
    render(<Harness />);
    openDialog();
    press('Creature');
    press('Rare');
    const strip = within(dialog()).getByRole('group', { name: 'Active filters' });
    expect(
      within(strip).getByRole('button', { name: 'Remove filter: Type: creature' })
    ).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: 'Remove filter: Rarity: rare' }));
    expect(pressed('Rare')).toBe('false');
    expect(pressed('Creature')).toBe('true');
    fireEvent.click(within(strip).getByRole('button', { name: 'Remove filter: Type: creature' }));
    expect(within(dialog()).queryByRole('group', { name: 'Active filters' })).toBeNull();
  });

  it('the strip lists mana values and mana cost with the engine labels', () => {
    render(
      <Harness
        seed={{
          manaValues: { values: [2], atLeast: 7 },
          manaSymbols: { counts: { B: 2 }, mode: 'atLeast' },
        }}
      />
    );
    openDialog();
    const strip = within(dialog()).getByRole('group', { name: 'Active filters' });
    expect(within(strip).getByText('Mana value 2, 7+')).toBeTruthy();
    expect(within(strip).getByText('Cost BB')).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: 'Remove filter: Cost BB' }));
    expect(within(dialog()).queryByText('Cost BB')).toBeNull();
  });

  it('Clear all in the strip and Clear in the footer both empty the draft', () => {
    render(<Harness />);
    openDialog();
    press('Creature');
    press('Rare');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Clear all' }));
    expect(within(dialog()).queryByRole('group', { name: 'Active filters' })).toBeNull();
    press('Creature');
    expect(within(dialog()).getByRole('button', { name: 'Clear' }).hasAttribute('disabled')).toBe(
      false
    );
    press('Clear');
    expect(within(dialog()).getByRole('button', { name: 'Clear' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('shows a live match count on the primary button', () => {
    const rows: FilterableRow[] = [
      { card: card({}), binderName: null },
      {
        card: card({ copyId: 'c2', name: 'Llanowar Elves', typeLine: 'Creature' }),
        binderName: null,
      },
    ];
    render(<Harness rows={rows} />);
    openDialog();
    expect(within(dialog()).getByRole('button', { name: 'Show 2 cards' })).toBeTruthy();
    press('Creature');
    expect(within(dialog()).getByRole('button', { name: 'Show 1 card' })).toBeTruthy();
  });

  it('counts against the page search term', () => {
    const rows: FilterableRow[] = [
      { card: card({}), binderName: null },
      { card: card({ copyId: 'c2', name: 'Llanowar Elves' }), binderName: null },
    ];
    render(<Harness rows={rows} searchTerm="sol" />);
    openDialog();
    expect(within(dialog()).getByRole('button', { name: 'Show 1 card' })).toBeTruthy();
  });

  it('counts mana value chips and mana cost symbols over the draft', () => {
    const rows: FilterableRow[] = [
      { card: card({ cmc: 1, manaCost: '{1}' }), binderName: null },
      {
        card: card({ copyId: 'c2', name: 'Bayou Bat', cmc: 2, manaCost: '{B}{B}' }),
        binderName: null,
      },
    ];
    render(<Harness rows={rows} />);
    openDialog();
    press('2');
    expect(within(dialog()).getByRole('button', { name: 'Show 1 card' })).toBeTruthy();
    openMore();
    press('Add black mana');
    press('Add black mana, 1 added');
    expect(within(dialog()).getByRole('button', { name: 'Show 1 card' })).toBeTruthy();
    press('Add white mana');
    expect(within(dialog()).getByRole('button', { name: 'No cards match' })).toBeTruthy();
  });

  it('says "Show cards" with no rows to count', () => {
    render(<Harness />);
    openDialog();
    expect(within(dialog()).getByRole('button', { name: 'Show cards' })).toBeTruthy();
  });

  it('at zero names the one filter whose removal brings cards back', () => {
    const rows: FilterableRow[] = [{ card: card({ rarity: 'rare' }), binderName: null }];
    render(<Harness rows={rows} />);
    openDialog();
    press('Artifact');
    press('Common');
    expect(within(dialog()).getByRole('button', { name: 'No cards match' })).toBeTruthy();
    expect(within(dialog()).getByRole('status').textContent).toContain(
      'Removing "Rarity: common" would bring cards back.'
    );
  });

  it('at zero with no single culprit offers the general nudge', () => {
    const rows: FilterableRow[] = [{ card: card({ rarity: 'rare' }), binderName: null }];
    render(<Harness rows={rows} />);
    openDialog();
    press('Creature');
    press('Common');
    expect(within(dialog()).getByRole('status').textContent).toContain('Try removing a filter');
  });

  it('"Save as a binder…" seeds the binder editor from the draft and closes', () => {
    const setEditingBinder = vi.fn();
    useCollectionStore.setState({ setEditingBinder });
    render(<Harness />);
    openDialog();
    press('Rare');
    fireEvent.click(screen.getByRole('button', { name: 'Save as a binder…' }));
    expect(setEditingBinder).toHaveBeenCalledWith(
      'new',
      expect.objectContaining({
        groups: [
          { filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } } },
        ],
        flagged: [],
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no "Save as a binder…" link with no structured filter set', () => {
    render(<Harness />);
    openDialog();
    expect(screen.queryByRole('button', { name: 'Save as a binder…' })).toBeNull();
  });

  it('is a bottom sheet on a phone through the shared sheet pattern, with a grabber', () => {
    render(<Harness />);
    openDialog();
    expect(document.querySelector('.modal-backdrop--sheet')).toBeTruthy();
    expect(dialog().querySelector('.collection-filters-dialog-grabber')).toBeTruthy();
  });
});
