// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ListEntry } from '../types';
import { useCurrencyStore } from '../lib/currency';
import { ListEntryTargetPrice } from './ListEntryTargetPrice';

const entry: ListEntry = {
  id: 'e1',
  name: 'Sol Ring',
  scryfallId: 'sf-1',
  setCode: 'CMR',
  collectorNumber: '1',
  finish: 'nonfoil',
  quantity: 1,
};

beforeEach(() => {
  useCurrencyStore.setState({ currency: 'USD' });
});

describe('ListEntryTargetPrice', () => {
  it('renders a discoverable "+ Target" affordance when unset', () => {
    render(<ListEntryTargetPrice entry={entry} onSave={() => {}} />);
    expect(screen.getByRole('button', { name: 'Set target price for Sol Ring' })).toBeTruthy();
  });

  it('sets a target price on Enter, stamped with the active currency', () => {
    const onSave = vi.fn();
    render(<ListEntryTargetPrice entry={entry} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set target price for Sol Ring' }));
    const input = screen.getByLabelText('Target price for Sol Ring, in USD');
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith({ targetPrice: 12.5, currency: 'USD' });
  });

  it('renders an existing value in the currency it was entered in, not the active display currency', () => {
    useCurrencyStore.setState({ currency: 'EUR' });
    render(
      <ListEntryTargetPrice
        entry={{ ...entry, targetPrice: 5, currency: 'USD' }}
        onSave={() => {}}
      />
    );
    // The chip renders "$5.00" (entry.currency) even though the active
    // display currency is EUR — target prices are never relabeled.
    expect(screen.getByRole('button', { name: /\$5\.00/ })).toBeTruthy();
  });

  it('edits an existing value and can clear it back to absent via the × button', () => {
    const onSave = vi.fn();
    render(
      <ListEntryTargetPrice entry={{ ...entry, targetPrice: 5, currency: 'USD' }} onSave={onSave} />
    );
    fireEvent.click(screen.getByRole('button', { name: /\$5\.00/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear target price for Sol Ring' }));
    expect(onSave).toHaveBeenCalledWith({ targetPrice: undefined, currency: undefined });
  });

  it('clears via a pointer press without double-firing onSave', () => {
    // The clear button handles BOTH mousedown (to beat the input's
    // blur-commit) and click (the only event a keyboard Enter/Space emits).
    // A real mouse press fires both, so the handler must be idempotent.
    const onSave = vi.fn();
    render(
      <ListEntryTargetPrice entry={{ ...entry, targetPrice: 5, currency: 'USD' }} onSave={onSave} />
    );
    fireEvent.click(screen.getByRole('button', { name: /\$5\.00/ }));
    const clear = screen.getByRole('button', { name: 'Clear target price for Sol Ring' });
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ targetPrice: undefined, currency: undefined });
  });

  it('clears to absent when committing a blank value', () => {
    const onSave = vi.fn();
    render(
      <ListEntryTargetPrice entry={{ ...entry, targetPrice: 5, currency: 'USD' }} onSave={onSave} />
    );
    fireEvent.click(screen.getByRole('button', { name: /\$5\.00/ }));
    const input = screen.getByLabelText('Target price for Sol Ring, in USD');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith({ targetPrice: undefined, currency: undefined });
  });

  it('rejects a negative or garbage value and leaves the stored value untouched', () => {
    const onSave = vi.fn();
    render(
      <ListEntryTargetPrice entry={{ ...entry, targetPrice: 5, currency: 'USD' }} onSave={onSave} />
    );
    fireEvent.click(screen.getByRole('button', { name: /\$5\.00/ }));
    const input = screen.getByLabelText('Target price for Sol Ring, in USD');
    fireEvent.change(input, { target: { value: '-3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    // Back to the read-only chip, still showing the original value.
    expect(screen.getByRole('button', { name: /\$5\.00/ })).toBeTruthy();
  });

  it('reverts without saving on Escape', () => {
    const onSave = vi.fn();
    render(
      <ListEntryTargetPrice entry={{ ...entry, targetPrice: 5, currency: 'USD' }} onSave={onSave} />
    );
    fireEvent.click(screen.getByRole('button', { name: /\$5\.00/ }));
    const input = screen.getByLabelText('Target price for Sol Ring, in USD');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /\$5\.00/ })).toBeTruthy();
  });

  it('uses a decimal mobile keyboard', () => {
    render(<ListEntryTargetPrice entry={entry} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set target price for Sol Ring' }));
    const input = screen.getByLabelText('Target price for Sol Ring, in USD');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });
});
