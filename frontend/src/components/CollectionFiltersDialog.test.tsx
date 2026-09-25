// @vitest-environment happy-dom
/**
 * The collection Filters dialog on the config-surface kit (board T139):
 * sections now order by the same registry groups the Add-condition picker
 * uses (lib/filter-fields.ts), Surplus/Proxy/Options are one "This copy"
 * heading of switch rows instead of three checkbox headings, and the footer
 * grew a "Save as a binder…" link that seeds BinderEditor from the draft.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ChipExpression, EnrichedCard } from '../types';
import type { ColorMatchMode } from '../lib/colors';
import type { FilterableRow } from '../lib/collection-filter';
import { useCollectionStore } from '../store/collection';
import { CollectionFiltersDialog } from './CollectionFiltersDialog';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

function Harness({ rows }: { rows?: FilterableRow[] } = {}) {
  const [supertypeExpr, setSupertypeExpr] = useState(EMPTY_EXPR);
  const [typesExpr, setTypesExpr] = useState(EMPTY_EXPR);
  const [subtypeExpr, setSubtypeExpr] = useState(EMPTY_EXPR);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<ColorMatchMode>('any');
  const [rarityExpr, setRarityExpr] = useState(EMPTY_EXPR);
  const [oracleExpr, setOracleExpr] = useState(EMPTY_EXPR);
  const [legalityExpr, setLegalityExpr] = useState(EMPTY_EXPR);
  const [layoutExpr, setLayoutExpr] = useState(EMPTY_EXPR);
  const [treatmentExpr, setTreatmentExpr] = useState(EMPTY_EXPR);
  const [borderExpr, setBorderExpr] = useState(EMPTY_EXPR);
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [surplusOnly, setSurplusOnly] = useState(false);
  const [proxyOnly, setProxyOnly] = useState(false);
  const [groupPrintings, setGroupPrintings] = useState(true);

  return (
    <CollectionFiltersDialog
      supertypeExpr={supertypeExpr}
      setSupertypeExpr={setSupertypeExpr}
      typesExpr={typesExpr}
      setTypesExpr={setTypesExpr}
      subtypeExpr={subtypeExpr}
      setSubtypeExpr={setSubtypeExpr}
      subtypeSuggestions={[]}
      colorFilter={colorFilter}
      setColorFilter={setColorFilter}
      colorMode={colorMode}
      setColorMode={setColorMode}
      colorOptions={[{ key: 'W', label: 'White' }]}
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
      surplusOnly={surplusOnly}
      setSurplusOnly={setSurplusOnly}
      proxyOnly={proxyOnly}
      setProxyOnly={setProxyOnly}
      groupPrintings={groupPrintings}
      setGroupPrintings={setGroupPrintings}
      rows={rows}
      activeCount={0}
    />
  );
}

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }));

const sectionLabels = () =>
  Array.from(document.querySelectorAll('.collection-filters-section-label')).map(
    (el) => el.textContent
  );

beforeEach(() => {
  useCollectionStore.setState({ setEditingBinder: vi.fn() });
});

describe('CollectionFiltersDialog', () => {
  it('orders sections by the Add-condition picker registry groups', () => {
    render(<Harness />);
    openDialog();
    const labels = sectionLabels();
    // The Color heading's element also hosts the AND/OR toggle, so its
    // textContent isn't the bare word — match by prefix.
    const colorIdx = labels.findIndex((l) => l?.startsWith('Color'));
    expect(labels.indexOf('Type line')).toBeLessThan(colorIdx);
    // Rarity/Set (Printing) now come after the shared Text/Value&play block
    // (Format) instead of before it.
    expect(labels.indexOf('Format')).toBeLessThan(labels.indexOf('Rarity'));
    expect(labels.indexOf('Rarity')).toBeLessThan(labels.indexOf('Set'));
    expect(labels[labels.length - 1]).toBe('This copy');
  });

  it('merges Surplus, Proxy and Options under one "This copy" heading of switches', () => {
    render(<Harness />);
    openDialog();
    expect(sectionLabels().filter((l) => l === 'This copy')).toHaveLength(1);

    const thisCopy = screen.getByText('This copy').closest('section') as HTMLElement;
    expect(within(thisCopy).getAllByRole('switch')).toHaveLength(3);
    expect(within(thisCopy).getByRole('switch', { name: 'Tradeable surplus only' })).toBeTruthy();
    expect(within(thisCopy).getByRole('switch', { name: 'Proxies only' })).toBeTruthy();
    expect(within(thisCopy).getByRole('switch', { name: 'Group printings' })).toBeTruthy();
    // Old checkbox rows are gone from this section.
    expect(within(thisCopy).queryByRole('checkbox')).toBeNull();
  });

  it('shows a live match count over the supplied rows', () => {
    const card: EnrichedCard = {
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
    };
    const rows: FilterableRow[] = [{ card, binderName: null }];
    render(<Harness rows={rows} />);
    openDialog();
    expect(screen.getByText(/1 card/)).toBeTruthy();
  });

  it('"Save as a binder…" seeds the binder editor from the draft and closes', () => {
    const setEditingBinder = vi.fn();
    useCollectionStore.setState({ setEditingBinder });
    render(<Harness />);
    openDialog();

    // Set a draft rarity so the draft carries a structured filter.
    fireEvent.click(screen.getByRole('button', { name: /Add rarity/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Rare' }));

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
    // The dialog itself closes — it was never applied.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no "Save as a binder…" link with no structured filter set', () => {
    render(<Harness />);
    openDialog();
    expect(screen.queryByRole('button', { name: 'Save as a binder…' })).toBeNull();
  });
});
