// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SortEditor } from './SortEditor';
import type { SortEntry } from '@/types/index';

/** Matches the app's one phone-tier convention (`(max-width: 599px)`), used
 *  by SortEditor to pick a drag handle (wide) vs a row menu (phone). */
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

function setup(
  sorts: SortEntry[],
  {
    phone = false,
    valueOrders = {},
  }: { phone?: boolean; valueOrders?: Partial<Record<SortEntry['field'], string[]>> } = {}
) {
  stubViewport(phone);
  const onSortsChange = vi.fn();
  const onValueOrdersChange = vi.fn();
  render(
    <SortEditor
      sorts={sorts}
      valueOrders={valueOrders}
      onSortsChange={onSortsChange}
      onValueOrdersChange={onValueOrdersChange}
    />
  );
  return { onSortsChange, onValueOrdersChange };
}

describe('SortEditor — direction', () => {
  // The whole point of this control: both outcomes are visible, not a single
  // button stating the current value.
  it('shows direction as a two-option segmented control', () => {
    setup([{ field: 'setReleaseDate', dir: 'desc' }]);
    const group = screen.getByRole('group', { name: 'Sort 1 direction' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(
      within(group).getByRole('radio', { name: 'Sort 1 direction: Oldest first' })
    ).toBeTruthy();
    const newest = within(group).getByRole('radio', { name: 'Sort 1 direction: Newest first' });
    expect((newest as HTMLInputElement).checked).toBe(true);
  });

  it('flips only its own row when the other option is picked', () => {
    const { onSortsChange } = setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    const group = screen.getByRole('group', { name: 'Sort 2 direction' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Sort 2 direction: Z → A' }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'desc' },
    ]);
  });

  it('labels each field in its own vocabulary', () => {
    setup([
      { field: 'name', dir: 'asc' },
      { field: 'edhrec', dir: 'asc' },
      { field: 'price', dir: 'desc' },
    ]);
    expect(screen.getByRole('radio', { name: 'Sort 1 direction: A → Z' })).toBeTruthy();
    // Rank 1 is the most-played card, so ascending rank is the popular end.
    expect(screen.getByRole('radio', { name: 'Sort 2 direction: Most played' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Sort 3 direction: Priciest' })).toBeTruthy();
  });

  it("renders color's ascending option as pips, never the WUBRG acronym", () => {
    setup([{ field: 'color', dir: 'asc' }]);
    // The accessible name still carries the word; the VISIBLE option is pips.
    const pips = screen.getByRole('radio', { name: 'Sort 1 direction: WUBRG' });
    expect(pips.closest('label')?.querySelector('.sort-editor-color-pips')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Sort 1 direction: Reversed' })).toBeTruthy();
  });
});

describe('SortEditor — sections vs inside each section', () => {
  it('labels the first row Sections and the rest Inside each section', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
      { field: 'price', dir: 'desc' },
    ]);
    expect(screen.getByText('Sections')).toBeTruthy();
    expect(screen.getByText('Inside each section')).toBeTruthy();
  });

  it('the sections row has no remove control, ever', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    // Row 2 (Name) can be removed; row 1 (Color, the sections row) cannot.
    expect(screen.getByRole('button', { name: 'Remove the Name sort' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove the Color sort' })).toBeNull();
  });
});

describe('SortEditor — the chain', () => {
  it('does not offer a field another row already uses', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Sort 1 field' }));
    const offered = screen.getAllByRole('option').map((o) => o.textContent);
    expect(offered).toContain('Color');
    expect(offered).not.toContain('Name');
  });
});

describe('SortEditor — desktop reorder (drag handle)', () => {
  it('gives every row a keyboard-operable grip handle, and no row menu', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
    const grip = screen.getByRole('button', {
      name: 'Reorder Color, position 1 of 2',
    });
    expect(grip.getAttribute('aria-roledescription')).toBe('sortable');
    expect(grip.tabIndex).toBe(0);
    expect(screen.queryByRole('button', { name: /sort actions/i })).toBeNull();
  });

  it('activates a real keyboard drag on Space (dnd-kit, not a hand-rolled handler)', () => {
    // dnd-kit's own coordinate math depends on layout geometry
    // (getBoundingClientRect) that happy-dom doesn't compute, so this stops
    // short of asserting the exact reordered output (SortValueOrderEditor's
    // existing dnd-kit drag has the same gap — no test in this codebase
    // simulates its coordinate math either). What IS real dnd-kit machinery,
    // not a static attribute, is `aria-pressed` flipping true only while a
    // drag session from THIS sensor is actually active.
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
      { field: 'price', dir: 'desc' },
    ]);
    const grip = screen.getByRole('button', { name: 'Reorder Color, position 1 of 3' });
    grip.focus();
    expect(grip.getAttribute('aria-pressed')).toBeNull();
    fireEvent.keyDown(grip, { code: 'Space' });
    expect(grip.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SortEditor — phone reorder (row menu, no drag)', () => {
  it('replaces the grip and inline remove with a named row menu', () => {
    setup(
      [
        { field: 'color', dir: 'asc' },
        { field: 'name', dir: 'asc' },
        { field: 'price', dir: 'desc' },
      ],
      { phone: true }
    );
    expect(screen.queryByRole('button', { name: /^Reorder/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove the Name sort' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Color sort actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Name sort actions' })).toBeTruthy();
  });

  it('moves a row up through the menu, naming the row in every item', () => {
    const { onSortsChange } = setup(
      [
        { field: 'color', dir: 'asc' },
        { field: 'name', dir: 'asc' },
      ],
      { phone: true }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Name sort actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move Name up' }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'name', dir: 'asc' },
      { field: 'color', dir: 'asc' },
    ]);
  });

  it('"Use for sections" promotes a row to the first position', () => {
    const { onSortsChange } = setup(
      [
        { field: 'color', dir: 'asc' },
        { field: 'name', dir: 'asc' },
        { field: 'price', dir: 'desc' },
      ],
      { phone: true }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Price sort actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use Price for sections' }));
    expect(onSortsChange).toHaveBeenCalledWith([
      { field: 'price', dir: 'desc' },
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
    ]);
  });

  it('the sections row menu has no "Use for sections" or Remove', () => {
    setup(
      [
        { field: 'color', dir: 'asc' },
        { field: 'name', dir: 'asc' },
      ],
      { phone: true }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Color sort actions' }));
    expect(screen.queryByRole('menuitem', { name: /Use Color for sections/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Remove the Color sort/ })).toBeNull();
  });

  it('removes a row through the menu', () => {
    const { onSortsChange } = setup(
      [
        { field: 'color', dir: 'asc' },
        { field: 'name', dir: 'asc' },
      ],
      { phone: true }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Name sort actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove the Name sort' }));
    expect(onSortsChange).toHaveBeenCalledWith([{ field: 'color', dir: 'asc' }]);
  });
});

describe('SortEditor — tie-breaker sentence', () => {
  it('states one plain sentence instead of the engine vocabulary list', () => {
    setup([{ field: 'color', dir: 'asc' }]);
    // treatment ("showcase" .. "regular"), finish ("foil" .. "etched" — its
    // default order has three stops), then the plain fields, ending in "then".
    // A substring match: the sentence shares its <p> with the "Change" link.
    expect(
      screen.getByText(
        /^Copies that still tie: showcase before regular, foil before etched, name, set, then number\./
      )
    ).toBeTruthy();
  });

  it('Change expands the value-order editors in place, without touching the chain', () => {
    const { onSortsChange } = setup([{ field: 'color', dir: 'asc' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onSortsChange).not.toHaveBeenCalled();
    // Still just the one chain row (Color) — treatment/finish were never
    // appended to it.
    expect(screen.getAllByRole('button', { name: /^Sort \d field$/ })).toHaveLength(1);
    expect(screen.getByRole('list', { name: /^treatment order/ })).toBeTruthy();
    expect(screen.getByRole('list', { name: /^finish order/ })).toBeTruthy();
    expect(screen.getByText('Showcase')).toBeTruthy();
  });

  it('Change toggles to Done and collapses the editors again', () => {
    setup([{ field: 'color', dir: 'asc' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeTruthy();
    fireEvent.click(done);
    expect(screen.queryByText('Showcase')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('Change is available even when the chain is already at MAX_SORTS', () => {
    setup([
      { field: 'color', dir: 'asc' },
      { field: 'name', dir: 'asc' },
      { field: 'price', dir: 'desc' },
    ]);
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('reflects an edited value order in the sentence', () => {
    setup([{ field: 'color', dir: 'asc' }], {
      valueOrders: { treatment: ['regular', 'promo', 'borderless', 'extendedart', 'showcase'] },
    });
    expect(
      screen.getByText(
        /^Copies that still tie: regular before showcase, foil before etched, name, set, then number\./
      )
    ).toBeTruthy();
  });
});
