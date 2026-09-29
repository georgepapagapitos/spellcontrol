// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SortPopover } from './SortPopover';
import type { SortEntry } from '../types';

function stubViewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*599px/.test(query) ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function setup(sorts: SortEntry[], { phone = false }: { phone?: boolean } = {}) {
  stubViewport(phone);
  const onSortsChange = vi.fn();
  render(
    <SortPopover
      sorts={sorts}
      valueOrders={{}}
      onSortsChange={onSortsChange}
      onValueOrdersChange={vi.fn()}
    />
  );
  return { onSortsChange };
}

describe('SortPopover — the pill', () => {
  it('shows the matching preset name, sentence case, no arrow glyph', () => {
    setup([
      { field: 'setReleaseDate', dir: 'asc' },
      { field: 'setName', dir: 'asc' },
      { field: 'collectorNumber', dir: 'asc' },
    ]);
    const label = screen.getByText('Set collection');
    expect(label.textContent).not.toMatch(/[↑↓]/);
  });

  it('spells out a chain that matches no preset', () => {
    setup([
      { field: 'rarity', dir: 'asc' },
      { field: 'price', dir: 'desc' },
    ]);
    expect(screen.getByText('Rarity, then price')).toBeTruthy();
  });
});

describe('SortPopover — desktop: anchored popover', () => {
  it('opens on the named orders as compact chips, chain editor visible right below', () => {
    setup([{ field: 'name', dir: 'asc' }]);
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    const panel = screen.getByRole('dialog', { name: 'Sort within binder' });
    // Chips, not the sheet's description-per-row radio list — that's what
    // keeps the panel short enough to show the chain with no scroll.
    expect(within(panel).getByRole('group', { name: 'Order' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'A to Z' })).toBeTruthy();
    // Not a radio group of description rows (the sheet's shape) — a preset
    // pick here is a plain button.
    expect(within(panel).queryByText('Alphabetical by name')).toBeNull();
    // The chain editor (SortEditor) is already showing, not one tap away.
    expect(within(panel).getByText('Sections')).toBeTruthy();
  });

  it('"Choose fields" moves focus to the chain\'s first field picker (E506)', () => {
    setup([{ field: 'name', dir: 'asc' }]);
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    fireEvent.click(screen.getByRole('button', { name: /Choose fields/ }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sort 1 field' }));
  });

  it('picking a preset applies its chain immediately', () => {
    const { onSortsChange } = setup([{ field: 'name', dir: 'asc' }]);
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    fireEvent.click(screen.getByRole('button', { name: 'By color' }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
  });
});

describe('SortPopover — phone: bottom sheet', () => {
  it('opens as a sheet, on the named orders', () => {
    setup([{ field: 'name', dir: 'asc' }], { phone: true });
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    expect(screen.getByRole('dialog', { name: 'Order' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^A to Z/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Choose fields/ })).toBeTruthy();
  });

  it('"Choose fields" drills into the chain editor with a back button', () => {
    setup([{ field: 'name', dir: 'asc' }], { phone: true });
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    fireEvent.click(screen.getByRole('radio', { name: /^Choose fields/ }));
    expect(screen.getByRole('dialog', { name: 'Choose fields' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose fields/ })).toBeTruthy();
    expect(screen.getByText('Sections')).toBeTruthy();
    // Back returns to the named orders.
    fireEvent.click(screen.getByRole('button', { name: /Choose fields/ }));
    expect(screen.getByRole('dialog', { name: 'Order' })).toBeTruthy();
  });

  it('picking a preset applies live and Done closes the sheet', () => {
    const { onSortsChange } = setup([{ field: 'name', dir: 'asc' }], { phone: true });
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    fireEvent.click(screen.getByRole('radio', { name: /^Most valuable first/ }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'price', dir: 'desc' },
      { field: 'name', dir: 'asc' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SortPopover — phone: "Your first sections" preview', () => {
  it('lists the real section labels and pages, with a +N more tail', () => {
    stubViewport(true);
    render(
      <SortPopover
        sorts={[{ field: 'color', dir: 'asc' }]}
        valueOrders={{}}
        onSortsChange={vi.fn()}
        onValueOrdersChange={vi.fn()}
        firstSections={[
          { label: 'White', page: 1 },
          { label: 'Blue', page: 3 },
        ]}
        totalSections={7}
        totalPages={40}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /change sort order/i }));
    fireEvent.click(screen.getByRole('radio', { name: /^Choose fields/ }));
    expect(screen.getByText('Your first sections')).toBeTruthy();
    expect(screen.getByText('White')).toBeTruthy();
    expect(screen.getByText('p. 3')).toBeTruthy();
    expect(screen.getByText('+5 more')).toBeTruthy();
    expect(screen.getByText('40 pages')).toBeTruthy();
  });
});
