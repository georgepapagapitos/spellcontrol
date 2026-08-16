// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectMenu } from './SelectMenu';
import { SortMenu, type SortMenuOption } from './SortMenu';
import type { SortDir } from '../types';

type Key = 'name' | 'release' | 'edhrec';

const options: SortMenuOption<Key>[] = [
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'release', label: 'Release date', dirLabels: ['Oldest first', 'Newest first'] },
  { value: 'edhrec', label: 'EDHREC rank', dirLabels: ['Most played', 'Least played'] },
];

function setup(value: Key = 'name', dir: SortDir = 'asc') {
  const onChange = vi.fn();
  render(
    <SortMenu<Key> ariaLabel="Sort" value={value} dir={dir} options={options} onChange={onChange} />
  );
  const trigger = screen.getByRole('button', { name: /Sort/ });
  fireEvent.click(trigger);
  return { onChange, trigger };
}

const reverseButton = () => screen.getByRole('button', { name: /Reverse sort order/i });

describe('SortMenu — the direction action', () => {
  // The defect this control exists for: on seven toolbars the only way to
  // reverse was to re-open the field dropdown and re-pick the field you
  // already had, with nothing on screen suggesting that did anything.
  it('offers a named, visible Reverse action inside the open menu', () => {
    setup();
    expect(reverseButton()).toBeTruthy();
  });

  it('reverses without changing the field', () => {
    const { onChange } = setup('release', 'desc');
    fireEvent.click(reverseButton());
    // Reversing IS re-picking the active field — every one of these surfaces'
    // handlers flips direction on a same-field pick and touches nothing else.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('release');
  });

  it('keeps the menu open so the reordering is visible from the same place', () => {
    setup();
    fireEvent.click(reverseButton());
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('names the direction it will PRODUCE, in the field’s own vocabulary', () => {
    // Ascending release date is newest-LAST, so "desc" would be actively
    // misleading here even to a reader who knows what it means.
    setup('release', 'asc');
    expect(reverseButton().getAttribute('aria-label')).toBe('Reverse sort order — Newest first');
  });

  it('uses each field’s own phrasing, not one shared asc/desc pair', () => {
    setup('edhrec', 'asc');
    expect(reverseButton().getAttribute('aria-label')).toBe('Reverse sort order — Least played');
  });

  it('states the resolved direction on the active field row', () => {
    setup('edhrec', 'asc');
    expect(screen.getByRole('option', { name: /EDHREC rank\s*Most played/ })).toBeTruthy();
    // …and only on the active one — an inactive field has no direction yet.
    expect(screen.getByRole('option', { name: 'Name' })).toBeTruthy();
  });

  it('is reachable by keyboard', () => {
    // Tab closes this popover family (see useMenuKeyboard), so the footer has
    // to join the arrow-key cycle or it is pointer-only. End is the cheap
    // check that it is the last stop in that cycle.
    setup('name', 'asc');
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(reverseButton());

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: /Name/ }));
  });

  it('still flips when you re-pick the active field', () => {
    // Muscle memory from before the action existed — harmless now that a
    // visible path exists, and removing it would break the habit for no gain.
    const { onChange } = setup('name', 'asc');
    fireEvent.click(screen.getByRole('option', { name: /Name/ }));
    expect(onChange).toHaveBeenCalledWith('name');
  });
});

describe('the footer stays opt-in', () => {
  it('a plain SelectMenu grows no footer', () => {
    // SelectMenu is shared by many non-sort surfaces (group-by, tag pickers,
    // rule fields). The direction action is SortMenu's, not every menu's.
    render(
      <SelectMenu
        ariaLabel="Group by"
        value="none"
        options={[
          { value: 'none', label: 'No grouping' },
          { value: 'color', label: 'Color' },
        ]}
        onChange={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Group by/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(document.querySelector('.toolbar-popover-footer')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reverse/i })).toBeNull();
  });
});
