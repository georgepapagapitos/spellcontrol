// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockPositionPicker } from './ClockPositionPicker';

afterEach(cleanup);

describe('the clock position picker', () => {
  it('is a native radio group of four, the current one checked', () => {
    render(<ClockPositionPicker value="seat" onChange={vi.fn()} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.type)).toEqual(['radio', 'radio', 'radio', 'radio']);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
    // One group: a shared name, so the arrow keys and the single tab stop are the browser's.
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(document.querySelector('[role="radiogroup"], [role="radio"]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Clock position' })).toBeTruthy();
  });

  it('names each choice with its hint', () => {
    render(<ClockPositionPicker value="seat" onChange={vi.fn()} />);
    for (const label of [
      'Time in the center, End turn on the active seat',
      'Bottom edge',
      'Top edge',
      'Center hub',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(document.querySelectorAll('.clock-position-hint')).toHaveLength(4);
    expect(screen.getByText('Saved on this device.')).toBeTruthy();
  });

  it('reports the choice picked', () => {
    const onChange = vi.fn();
    render(<ClockPositionPicker value="seat" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Top edge/ }));
    expect(onChange).toHaveBeenCalledWith('top');
  });
});
