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
