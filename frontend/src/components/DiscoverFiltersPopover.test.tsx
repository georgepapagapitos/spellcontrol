// @vitest-environment happy-dom
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NO_DISCOVER_FILTERS, type DiscoverFilters } from '@/lib/discover-filters';
import { DiscoverFiltersPopover } from './DiscoverFiltersPopover';

/** Stateful harness — mirrors how DiscoverDecksPage actually wires this
 *  (fully controlled by the URL-bound filters object). */
function Harness({ onChange }: { onChange?: (f: DiscoverFilters) => void }) {
  const [filters, setFilters] = useState<DiscoverFilters>(NO_DISCOVER_FILTERS);
  return (
    <DiscoverFiltersPopover
      filters={filters}
      onChange={(next) => {
        setFilters(next);
        onChange?.(next);
      }}
    />
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
}

describe('DiscoverFiltersPopover', () => {
  it('trigger has no badge and a plain "Filters" name when nothing is active', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /^filters$/i })).toBeTruthy();
  });

  it('the panel is role=dialog, aria-label="Filters", with no aria-modal (matches the real DeckFiltersPopover shape)', () => {
    render(<Harness />);
    openPanel();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
  });

  it('every section is a fieldset with a real legend', () => {
    render(<Harness />);
    openPanel();
    for (const name of ['Format', 'Colors', 'Bracket', 'Budget']) {
      expect(screen.getByText(name, { selector: 'legend' })).toBeTruthy();
    }
  });

  it('picking a Format radio updates filters and closes the popover', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Commander' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ format: 'commander' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('picking a Budget radio updates filters and closes the popover', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Under $50' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ budget: 'under50' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggling a Color checkbox updates filters and keeps the popover open', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'White' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colors: ['W'] }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // A second color accumulates, canonical-ordered, and still stays open.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blue' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ colors: ['W', 'U'] }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('toggling a Bracket checkbox updates filters and keeps the popover open', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Upgraded' })); // bracket 3

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ brackets: [3] }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a count badge once a filter is active, and "Clear filters" resets format/colors/bracket/budget', () => {
    render(<Harness />);
    openPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'White' }));

    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByRole('button', { name: /^filters$/i })).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    openPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // pointerdown, not mousedown — the shared useMenuKeyboard contract dismisses
  // on pointerdown so a touch tap outside closes the panel too.
  it('closes on an outside pointerdown', () => {
    render(<Harness />);
    openPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the page scrolls out from under the panel', async () => {
    render(<Harness />);
    openPanel();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // The scroll listener attaches one frame after open.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    fireEvent.scroll(document);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
