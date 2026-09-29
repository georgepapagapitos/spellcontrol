// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearchCommanders } = vi.hoisted(() => ({ mockSearchCommanders: vi.fn() }));
vi.mock('@/lib/discover/discover-client', () => ({ searchCommanders: mockSearchCommanders }));

import { DiscoverSearch } from './DiscoverSearch';

function getInput(): HTMLInputElement {
  return screen.getByRole('combobox', { name: /search public decks/i });
}

function renderSearch(query: string | null = null) {
  const onQueryChange = vi.fn();
  const onPickCommander = vi.fn();
  const utils = render(
    <DiscoverSearch query={query} onQueryChange={onQueryChange} onPickCommander={onPickCommander} />
  );
  return { ...utils, onQueryChange, onPickCommander };
}

describe('DiscoverSearch', () => {
  beforeEach(() => {
    mockSearchCommanders.mockReset();
    mockSearchCommanders.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits typed text as the search once typing pauses, not per keystroke', () => {
    vi.useFakeTimers();
    const { onQueryChange } = renderSearch();
    const input = getInput();
    fireEvent.change(input, { target: { value: 'd' } });
    fireEvent.change(input, { target: { value: 'dra' } });
    fireEvent.change(input, { target: { value: 'dragons ' } });
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith('dragons');
  });

  it('Enter searches the typed text straight away', () => {
    const { onQueryChange } = renderSearch();
    const input = getInput();
    fireEvent.change(input, { target: { value: 'elves' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQueryChange).toHaveBeenCalledWith('elves');
  });

  it('clearing the box drops the search at once', () => {
    const { onQueryChange } = renderSearch('elves');
    expect(getInput().value).toBe('elves');
    fireEvent.change(getInput(), { target: { value: '' } });
    expect(onQueryChange).toHaveBeenCalledWith(null);
  });

  it('offers matching commanders, and picking one hands it up and empties the box', async () => {
    mockSearchCommanders.mockResolvedValue(['Korvold, Fae-Cursed King']);
    const { onPickCommander, onQueryChange } = renderSearch();
    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'korvold' } });
    const option = await screen.findByRole('option');
    const commitsBeforePick = onQueryChange.mock.calls.length;
    fireEvent.mouseDown(option);
    expect(onPickCommander).toHaveBeenCalledWith('Korvold, Fae-Cursed King');
    expect(input.value).toBe('');
    // Nothing re-commits the old text afterwards; the page drops q itself.
    await new Promise((r) => setTimeout(r, 300));
    expect(onQueryChange).toHaveBeenCalledTimes(commitsBeforePick);
  });

  it('shows no listbox when no commander matches, and Enter still searches', async () => {
    const { onQueryChange } = renderSearch();
    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(mockSearchCommanders).toHaveBeenCalledWith('zzz', 'community'));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQueryChange).toHaveBeenCalledWith('zzz');
  });

  it('nothing is highlighted until an arrow key, and arrows wrap', async () => {
    mockSearchCommanders.mockResolvedValue(['Alpha', 'Beta', 'Gamma']);
    const { onPickCommander } = renderSearch();
    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPickCommander).toHaveBeenCalledWith('Alpha');
  });

  it('Escape closes the suggestions without touching the search', async () => {
    mockSearchCommanders.mockResolvedValue(['Korvold, Fae-Cursed King']);
    renderSearch();
    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'kor' } });
    await screen.findByRole('option');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('kor');
  });

  it('adopts a query changed from outside, such as Clear all', () => {
    const { rerender, onQueryChange, onPickCommander } = renderSearch('elves');
    rerender(
      <DiscoverSearch
        query={null}
        onQueryChange={onQueryChange}
        onPickCommander={onPickCommander}
      />
    );
    expect(getInput().value).toBe('');
  });
});
