// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HordeDamageSheet } from './HordeDamageSheet';

function renderSheet(libraryCount: number, onConfirm = vi.fn()) {
  render(
    <HordeDamageSheet
      libraryCount={libraryCount}
      result={null}
      onConfirm={onConfirm}
      onDone={vi.fn()}
      onClose={vi.fn()}
    />
  );
  return {
    input: screen.getByLabelText('Damage') as HTMLInputElement,
    onConfirm,
  };
}

describe('HordeDamageSheet — typeable amount', () => {
  it('typing a value updates the "Mills N. Library X → Y." preview live', () => {
    const { input } = renderSheet(80);
    fireEvent.change(input, { target: { value: '33' } });
    expect(input.value).toBe('33');
    expect(screen.getByText('Mills 33. Library 80 → 47.')).toBeTruthy();
  });

  it('clamps a typed value above the library size', () => {
    const { input } = renderSheet(10);
    fireEvent.change(input, { target: { value: '999' } });
    expect(input.value).toBe('10');
    expect(screen.getByText('Mills 10. Library 10 → 0.')).toBeTruthy();
  });

  it('ignores non-digit keystrokes rather than crashing to NaN', () => {
    const { input } = renderSheet(80);
    fireEvent.change(input, { target: { value: 'abc' } });
    // Rejected outright — the field keeps its last valid value.
    expect(input.value).toBe('1');
  });

  it('Enter confirms with the typed (clamped) amount', () => {
    const { input, onConfirm } = renderSheet(80);
    fireEvent.change(input, { target: { value: '14' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith(14);
  });

  it('the Confirm button uses the same typed amount as Enter', () => {
    const { input, onConfirm } = renderSheet(80);
    fireEvent.change(input, { target: { value: '33' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith(33);
  });

  it('selects the whole value on focus, so typing over it replaces rather than appends', () => {
    const { input } = renderSheet(80);
    fireEvent.change(input, { target: { value: '5' } });
    const selectSpy = vi.spyOn(input, 'select');
    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('a blank field (mid-clear) reads as 0 in the preview, and settles to 0 on blur', () => {
    const { input } = renderSheet(80);
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Mills 0. Library 80 → 80.')).toBeTruthy();
    fireEvent.blur(input);
    expect(input.value).toBe('0');
  });

  it('+ nudges the amount up by 1, and clamps at the library size', () => {
    renderSheet(2);
    const inc = screen.getByRole('button', { name: 'Increase' }) as HTMLButtonElement;
    fireEvent.click(inc); // 1 -> 2
    expect(screen.getByText('Mills 2. Library 2 → 0.')).toBeTruthy();
    expect(inc.disabled).toBe(true);
  });

  it('− nudges the amount down by 1, and clamps/disables at 0', () => {
    renderSheet(80);
    const dec = screen.getByRole('button', { name: 'Decrease' }) as HTMLButtonElement;
    fireEvent.click(dec); // 1 -> 0
    expect(screen.getByText('Mills 0. Library 80 → 80.')).toBeTruthy();
    expect(dec.disabled).toBe(true);
  });
});

describe('HordeDamageSheet — press-and-hold repeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holding + ramps past the initial tap, the same way the table life steppers do', async () => {
    renderSheet(80);
    const inc = screen.getByRole('button', { name: 'Increase' });
    await act(async () => {
      fireEvent.pointerDown(inc);
      vi.advanceTimersByTime(450 + 90 * 3); // usePressRepeat's default delay + 3 ticks
      fireEvent.pointerUp(inc);
    });
    // 1 immediate + 3 repeat ticks, starting from a draft of 1.
    expect(screen.getByText('Mills 5. Library 80 → 75.')).toBeTruthy();
  });

  it('releasing before the hold delay elapses steps only once', async () => {
    renderSheet(80);
    const inc = screen.getByRole('button', { name: 'Increase' });
    await act(async () => {
      fireEvent.pointerDown(inc);
      vi.advanceTimersByTime(100); // well under the 450ms delay
      fireEvent.pointerUp(inc);
    });
    expect(screen.getByText('Mills 2. Library 80 → 78.')).toBeTruthy();
  });
});
