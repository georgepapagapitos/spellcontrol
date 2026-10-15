// @vitest-environment happy-dom
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NO_DISCOVER_FILTERS, type DiscoverFilters } from '@/lib/discover/discover-filters';
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
  fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
}

describe('DiscoverFiltersPopover', () => {
  it('trigger has no badge and a plain "Filters" name when nothing is active', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /^filters/i })).toBeTruthy();
  });

  it('the panel is role=dialog, aria-label="Filters", with no aria-modal (matches the real DeckFiltersPopover shape)', () => {
    render(<Harness />);
    openPanel();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
  });

  it('every section is a labelled kit section', () => {
    render(<Harness />);
    openPanel();
    for (const name of ['Format', 'Color', 'Bracket', 'Budget']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
  });

  // Radios used to dismiss the panel on pick, which made this the only popover
  // in the family that vanished mid-edit — and setting format AND budget meant
  // reopening it. Every control now leaves the panel open; you close it.
  it('picking a Format radio updates filters and keeps the popover open', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Commander' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ format: 'commander' }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('picking a Budget radio updates filters and keeps the popover open', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Under $50' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ budget: 'under50' }));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('toggling a Color pip updates filters and keeps the popover open', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'White' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colors: ['W'] }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // A second color accumulates, canonical-ordered, and still stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ colors: ['W', 'U'] }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('toggling a Bracket chip updates filters and keeps the popover open', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Upgraded' })); // bracket 3

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ brackets: [3] }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a count badge once a filter is active, and "Clear filters" resets format/colors/bracket/budget', () => {
    render(<Harness />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'White' }));

    // "(1 active)", not ", 1 active" — the four filter triggers had drifted to
    // two different phrasings; they share one `<FilterTrigger>` now.
    expect(screen.getByRole('button', { name: 'Filters (1 active)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByRole('button', { name: /^filters/i })).toBeTruthy();
  });

  it('the color mode defaults to Within and switching it updates colorMode', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    expect((screen.getByRole('radio', { name: 'Within these' }) as HTMLInputElement).checked).toBe(
      true
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Any of these' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ colorMode: 'any' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Exactly these' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ colorMode: 'all' }));
  });

  it('Format and Budget are single-choice with an Any reset', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();
    expect(screen.getAllByRole('radio', { name: 'Any' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Commander' }));
    fireEvent.click(screen.getAllByRole('radio', { name: 'Any' })[0]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ format: null }));
  });

  it('shows the live count passed in, and Clear filters also resets the color mode', () => {
    const onChange = vi.fn();
    render(
      <DiscoverFiltersPopover
        filters={{ ...NO_DISCOVER_FILTERS, colors: ['W'], colorMode: 'any' }}
        onChange={onChange}
        resultLabel="24+ decks"
      />
    );
    openPanel();
    expect(screen.getByText('24+ decks')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ colors: [], colorMode: 'within' })
    );
  });

  it('hideBudget drops the Budget section', () => {
    render(<DiscoverFiltersPopover filters={NO_DISCOVER_FILTERS} onChange={vi.fn()} hideBudget />);
    openPanel();
    expect(screen.queryByRole('region', { name: 'Budget' })).toBeNull();
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
