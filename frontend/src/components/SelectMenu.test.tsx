// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectMenu } from './SelectMenu';

const options = [
  { value: 'name', label: 'Name' },
  { value: 'price', label: 'Price' },
  { value: 'rarity', label: 'Rarity' },
];

describe('SelectMenu', () => {
  it('opens a listbox and focuses the currently selected option', () => {
    render(<SelectMenu value="price" options={options} onChange={() => {}} ariaLabel="Sort" />);
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Price' }));
  });

  it('navigates options with arrows and picks with a click, returning focus to the trigger', () => {
    const onChange = vi.fn();
    render(<SelectMenu value="name" options={options} onChange={onChange} ariaLabel="Sort" />);
    const trigger = screen.getByRole('button', { name: /Sort/ });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Price' }));

    fireEvent.click(screen.getByRole('option', { name: 'Price' }));
    expect(onChange).toHaveBeenCalledWith('price');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('stays open after a pick when closeOnSelect is false', () => {
    const onChange = vi.fn();
    render(
      <SelectMenu
        value="name"
        options={options}
        onChange={onChange}
        ariaLabel="Sort"
        closeOnSelect={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Rarity' }));
    expect(onChange).toHaveBeenCalledWith('rarity');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('searchable: focuses the filter input on open, narrows options, picks first match on Enter', () => {
    const onChange = vi.fn();
    render(
      <SelectMenu value="" options={options} onChange={onChange} ariaLabel="Tags" searchable />
    );
    fireEvent.click(screen.getByRole('button', { name: /Tags/ }));
    const input = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'rar' } });
    expect(screen.queryByRole('option', { name: 'Name' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Rarity' })).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('rarity');
  });

  it('searchable: shows "No matches" when the query matches nothing', () => {
    render(
      <SelectMenu value="" options={options} onChange={() => {}} ariaLabel="Tags" searchable />
    );
    fireEvent.click(screen.getByRole('button', { name: /Tags/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('closes on Escape (focus to trigger) and on an outside pointerdown', () => {
    render(<SelectMenu value="name" options={options} onChange={() => {}} ariaLabel="Sort" />);
    const trigger = screen.getByRole('button', { name: /Sort/ });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
