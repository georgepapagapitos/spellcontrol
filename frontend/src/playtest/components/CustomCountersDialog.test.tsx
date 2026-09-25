// @vitest-environment happy-dom
/**
 * EDHPlay's Custom Counters dialog (2026-09-24, from the user's screenshots):
 * a searchable list of printed counters, a field for your own, every counter
 * on the card with a count and a delete, and one Apply for all of it.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CustomCountersDialog } from './CustomCountersDialog';

function open(counters: Record<string, number> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <CustomCountersDialog
      cardName="Staunch Crewmate"
      counters={counters}
      onApply={onApply}
      onClose={onClose}
    />
  );
  return { onApply, onClose };
}

const active = () => screen.getByRole('list');

describe('CustomCountersDialog', () => {
  it('lists the counters already on the card with their counts', () => {
    open({ ward: 3, custom: 1 });
    expect((screen.getByLabelText('Ward count') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('custom count') as HTMLInputElement).value).toBe('1');
  });

  // A picker: a bottom sheet on phones that grows only as tall as its
  // content (STYLE_GUIDE, Pattern B). As a plain dialog it filled a phone's
  // height with empty space (the E361 phone sweep, 2026-09-24).
  it('presents as the phone sheet, not a full-height dialog', () => {
    open();
    expect(screen.getByRole('dialog').closest('.modal-backdrop--sheet')).toBeTruthy();
  });

  it('says so when the card has none', () => {
    open();
    expect(screen.getByText('No counters yet.')).toBeTruthy();
  });

  it('finds a printed counter by search and adds it at one', () => {
    const { onApply } = open();
    const search = screen.getByRole('combobox', { name: 'Printed counters' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: 'tim' } });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Time']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect((screen.getByLabelText('Time count') as HTMLInputElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(onApply).toHaveBeenCalledWith({ time: 1 });
  });

  it('adds a printed counter picked with the mouse, and one more on a second pick', () => {
    open();
    const search = screen.getByRole('combobox', { name: 'Printed counters' });
    const pick = (name: string) => {
      fireEvent.focus(search);
      fireEvent.mouseDown(screen.getByRole('option', { name }));
    };
    pick('Shield');
    pick('Shield');
    expect((screen.getByLabelText('Shield count') as HTMLInputElement).value).toBe('2');
  });

  it('adds one of your own by name, and treats a printed name as the printed one', () => {
    const { onApply } = open();
    const field = screen.getByRole('textbox', { name: 'Your own' });
    fireEvent.change(field, { target: { value: 'bounty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this counter' }));
    fireEvent.change(field, { target: { value: 'Charge' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(within(active()).getByText('bounty')).toBeTruthy();
    expect(within(active()).getByText('Charge')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(onApply).toHaveBeenCalledWith({ bounty: 1, charge: 1 });
  });

  it('applies only what changed: a new count, and a removal as a full take-off', () => {
    const { onApply } = open({ ward: 3, custom: 2, stun: 1 });
    fireEvent.change(screen.getByLabelText('Ward count'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove custom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    expect(onApply).toHaveBeenCalledWith({ ward: 2, custom: -2 });
  });

  it('has nothing to apply until something changes, and Cancel applies nothing', () => {
    const { onApply, onClose } = open({ charge: 1 });
    const apply = screen.getByRole('button', { name: 'Apply changes' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('closes the list on Escape without closing the dialog', () => {
    const { onClose } = open();
    const search = screen.getByRole('combobox', { name: 'Printed counters' });
    fireEvent.focus(search);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
