// @vitest-environment happy-dom
/**
 * E474 guard. useSheetExit closes a sheet on Escape unless the key is already
 * defaultPrevented or a layer sits above it. An inline picker is not a layer,
 * so each one must preventDefault() on the Escape it handled (closed its list,
 * cleared its text) and leave an unhandled one alone for the sheet.
 * InfoTip and Legend listen on document/window, after the sheet's own
 * listener, so they register an overlay layer while open instead.
 */
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { InfoTip } from './overlays/InfoTip';
import { Legend } from './Legend';
import { SetFilterPicker } from './search/SetFilterPicker';
import { ChipExpressionBuilder } from './search/ChipExpressionBuilder';
import { TypeLineExpressionBuilder } from './search/TypeLineExpressionBuilder';

vi.mock('@/lib/discover/discover-client', () => ({
  searchCommanders: vi.fn().mockResolvedValue(['Atraxa, Praetors’ Voice']),
}));
import { DiscoverSearch } from './decks/DiscoverSearch';

/** Dispatch Escape on `el` and report whether anything prevented it. */
function escape(el: Element | Window | Document): boolean {
  const ev = createEvent.keyDown(el, { key: 'Escape', cancelable: true });
  fireEvent(el, ev);
  return ev.defaultPrevented;
}

const EMPTY = { chips: [], joiners: [] };

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useSheetExit(onClose, 'sheet-fall', { instantAt: '(min-width: 0px)' });
  return <div>{children}</div>;
}

describe('inline pickers claim the Escape they handle', () => {
  it('SetFilterPicker', () => {
    render(
      <SetFilterPicker
        options={[{ code: 'CMR', label: 'Commander Legends' }]}
        value={new Set()}
        onChange={vi.fn()}
      />
    );
    const input = screen.getByRole('combobox', { name: 'Filter by set' });
    expect(escape(input)).toBe(false);
    fireEvent.focus(input);
    expect(screen.getByText('Commander Legends')).toBeTruthy();
    expect(escape(input)).toBe(true);
    expect(screen.queryByText('Commander Legends')).toBeNull();
  });

  it('ChipExpressionBuilder', () => {
    render(<ChipExpressionBuilder value={EMPTY} onChange={vi.fn()} suggestions={['Angel']} />);
    const input = screen.getByRole('combobox');
    expect(escape(input)).toBe(false);
    fireEvent.change(input, { target: { value: 'ang' } });
    expect(escape(input)).toBe(true);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('TypeLineExpressionBuilder', () => {
    render(
      <TypeLineExpressionBuilder
        supertypeExpr={EMPTY}
        setSupertypeExpr={vi.fn()}
        typesExpr={EMPTY}
        setTypesExpr={vi.fn()}
        subtypeExpr={EMPTY}
        setSubtypeExpr={vi.fn()}
        subtypeSuggestions={['Angel']}
      />
    );
    const input = screen.getByRole('combobox');
    expect(escape(input)).toBe(false);
    fireEvent.change(input, { target: { value: 'ang' } });
    expect(escape(input)).toBe(true);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('DiscoverSearch (commander typeahead)', async () => {
    render(<DiscoverSearch query={null} onQueryChange={vi.fn()} onPickCommander={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: /search public decks/i });
    expect(escape(input)).toBe(false);
    fireEvent.change(input, { target: { value: 'atr' } });
    await screen.findByRole('listbox');
    expect(escape(input)).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(escape(input)).toBe(false);
  });
});

describe('InfoTip and Legend hold a layer so the sheet beneath stands down', () => {
  it('InfoTip: Escape closes the tip, not the sheet', () => {
    const onClose = vi.fn();
    render(
      <Sheet onClose={onClose}>
        <InfoTip label="concept" text="Body" />
      </Sheet>
    );
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    escape(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escape(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Legend: Escape closes the key, not the sheet', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <Sheet onClose={onClose}>
          <Legend context="collection" />
        </Sheet>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show symbol key' }));
    expect(screen.getByRole('dialog', { name: 'Symbol key' })).toBeTruthy();
    escape(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escape(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
