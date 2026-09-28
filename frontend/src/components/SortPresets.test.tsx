// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SortPresetChips, SortPresetList } from './SortPresets';
import type { SortEntry } from '../types';

describe('SortPresetChips (BinderEditor Order disclosure)', () => {
  it('marks the matching preset as selected', () => {
    render(
      <SortPresetChips
        sorts={
          [
            { field: 'price', dir: 'desc' },
            { field: 'name', dir: 'asc' },
          ] as SortEntry[]
        }
        onPick={vi.fn()}
        onChooseFields={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Most valuable first' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Choose fields' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('marks "Choose fields" as selected when nothing matches', () => {
    render(
      <SortPresetChips
        sorts={[{ field: 'rarity', dir: 'asc' }] as SortEntry[]}
        onPick={vi.fn()}
        onChooseFields={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Choose fields' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('picking a chip applies its saved chain', () => {
    const onPick = vi.fn();
    render(<SortPresetChips sorts={[]} onPick={onPick} onChooseFields={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'A to Z' }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-to-z' }));
  });

  it('"Choose fields" always navigates, even when already selected', () => {
    const onChooseFields = vi.fn();
    render(<SortPresetChips sorts={[]} onPick={vi.fn()} onChooseFields={onChooseFields} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose fields' }));
    expect(onChooseFields).toHaveBeenCalledTimes(1);
  });
});

describe('SortPresetList (sort sheet / desktop popover)', () => {
  function options(sorts: SortEntry[] = []) {
    const onPick = vi.fn();
    const onChooseFields = vi.fn();
    render(<SortPresetList sorts={sorts} onPick={onPick} onChooseFields={onChooseFields} />);
    return { onPick, onChooseFields };
  }

  it("renders By color's hint as pips, not the word WUBRG", () => {
    options();
    const row = screen.getByRole('radio', { name: /^By color/ }).closest('label');
    expect(row?.querySelector('.sort-preset-color-hint')).toBeTruthy();
    expect(row?.textContent).not.toMatch(/WUBRG/);
  });

  it('applies a preset immediately on pick', () => {
    const { onPick } = options();
    fireEvent.click(screen.getByRole('radio', { name: /^Set collection/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'set-collection' }));
  });

  it('"Choose fields" navigates even when it is already the checked option', () => {
    // No preset matches an empty chain, so "Choose fields" starts checked —
    // a native radio fires no change event when you click it again.
    const { onChooseFields } = options([]);
    const fields = screen.getByRole('radio', { name: /^Choose fields/ }) as HTMLInputElement;
    expect(fields.checked).toBe(true);
    fireEvent.click(fields);
    expect(onChooseFields).toHaveBeenCalledTimes(1);
  });

  it('checks the matching preset, not "Choose fields", when one matches', () => {
    options([{ field: 'name', dir: 'asc' }]);
    expect((screen.getByRole('radio', { name: /^A to Z/ }) as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole('radio', { name: /^Choose fields/ }) as HTMLInputElement).checked
    ).toBe(false);
  });
});
