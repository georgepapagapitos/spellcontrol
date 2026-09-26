// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LifeKeypad } from './LifeKeypad';

function renderKeypad(currentLife = 40, onConfirm = vi.fn(), onClose = vi.fn()) {
  return render(
    <LifeKeypad
      playerName="Alice"
      currentLife={currentLife}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

function pressDigits(digits: string[]) {
  digits.forEach((d) => {
    fireEvent.click(screen.getByRole('button', { name: d }));
  });
}

function switchToDeltaMode() {
  // The mode toggle button has aria-label "Switch to change mode" in set mode
  fireEvent.click(screen.getByRole('button', { name: 'Switch to change mode' }));
}

describe('LifeKeypad — absolute set mode (default)', () => {
  it('calls onConfirm with the typed absolute value', () => {
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);

    pressDigits(['2', '7']);
    fireEvent.click(screen.getByRole('button', { name: 'Set life' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(27);
  });

  it('defaults to currentLife when buffer is empty', () => {
    const onConfirm = vi.fn();
    renderKeypad(35, onConfirm);

    fireEvent.click(screen.getByRole('button', { name: 'Set life' }));

    expect(onConfirm).toHaveBeenCalledWith(35);
  });

  it('handles keyboard Enter to confirm (uses currentLife when buffer is empty)', () => {
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith(40);
  });

  it('Enter confirms the value typed on the keyboard (no stale-closure drop)', () => {
    // Regression (audit F7): the keydown effect used to bind once with []
    // deps, so Enter read the mount-time empty buffer and dropped the typed
    // total, always sending currentLife instead.
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);

    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: '7' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith(27);
  });

  it('opens with focus on Set life, so typing then Enter confirms by that button', () => {
    renderKeypad(40);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Set life' }));
  });

  it('Enter away from any key confirms exactly once and cancels the default', () => {
    // Regression: the confirm unmounts the keypad and focus returns to the
    // numeral button; an un-cancelled Enter then clicked that button and
    // opened the keypad again.
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: '5' });

    const notCancelled = fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

    expect(notCancelled).toBe(false);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(25);
  });

  it('Enter on a focused digit key types that digit instead of confirming', () => {
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);
    const seven = screen.getByRole('button', { name: '7' });
    seven.focus();

    // The browser turns an un-cancelled Enter on a button into its click.
    const notCancelled = fireEvent.keyDown(seven, { key: 'Enter' });
    if (notCancelled) fireEvent.click(seven);

    expect(notCancelled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('.life-keypad-display')?.textContent).toBe('7');
  });

  it('Enter on the focused Set life button confirms once, through its own click', () => {
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);
    fireEvent.keyDown(window, { key: '9' });
    const set = screen.getByRole('button', { name: 'Set life' });

    const notCancelled = fireEvent.keyDown(set, { key: 'Enter' });
    if (notCancelled) fireEvent.click(set);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(9);
  });

  it('handles keyboard Escape to close', () => {
    const onClose = vi.fn();
    renderKeypad(40, vi.fn(), onClose);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('backspace removes the last digit', () => {
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);

    pressDigits(['1', '3']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear last digit' }));
    // Buffer is now '1'; Set life sends 1
    fireEvent.click(screen.getByRole('button', { name: 'Set life' }));

    expect(onConfirm).toHaveBeenCalledWith(1);
  });
});

describe('LifeKeypad — delta mode', () => {
  it('switches to delta mode when the ±Δ button is pressed', () => {
    renderKeypad(40);
    // Before switch: set mode button present
    expect(screen.getByRole('button', { name: 'Set life' })).toBeTruthy();

    switchToDeltaMode();

    // After switch: delta buttons present instead
    expect(screen.queryByRole('button', { name: 'Set life' })).toBeNull();
    expect(screen.getByRole('button', { name: /Subtract/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add/i })).toBeTruthy();
  });

  it('applies a negative delta: currentLife − typed amount', () => {
    const onConfirm = vi.fn();
    renderKeypad(40, onConfirm);

    switchToDeltaMode();
    pressDigits(['1', '3']);
    fireEvent.click(screen.getByRole('button', { name: /Subtract/i }));

    // 40 − 13 = 27
    expect(onConfirm).toHaveBeenCalledWith(27);
  });

  it('applies a positive delta: currentLife + typed amount', () => {
    const onConfirm = vi.fn();
    renderKeypad(20, onConfirm);

    switchToDeltaMode();
    pressDigits(['5']);
    fireEvent.click(screen.getByRole('button', { name: /Add/i }));

    // 20 + 5 = 25
    expect(onConfirm).toHaveBeenCalledWith(25);
  });

  it('applies zero delta when buffer is empty', () => {
    const onConfirm = vi.fn();
    renderKeypad(30, onConfirm);

    switchToDeltaMode();
    // No digits typed — confirming subtracts 0
    fireEvent.click(screen.getByRole('button', { name: /Subtract/i }));

    expect(onConfirm).toHaveBeenCalledWith(30);
  });

  it('can switch back from delta to set mode', () => {
    renderKeypad(40);
    switchToDeltaMode();
    expect(screen.queryByRole('button', { name: 'Set life' })).toBeNull();

    // Press the toggle again to go back to set mode
    fireEvent.click(screen.getByRole('button', { name: 'Switch to set mode' }));

    expect(screen.getByRole('button', { name: 'Set life' })).toBeTruthy();
  });

  it('can handle a delta that produces a negative life total', () => {
    const onConfirm = vi.fn();
    renderKeypad(5, onConfirm);

    switchToDeltaMode();
    pressDigits(['1', '0']);
    fireEvent.click(screen.getByRole('button', { name: /Subtract/i }));

    // 5 − 10 = −5; the reducer enforces bounds, not the keypad
    expect(onConfirm).toHaveBeenCalledWith(-5);
  });
});

describe('LifeKeypad — banner visibility signal (UX-323 integration note)', () => {
  // The banner itself lives in PlayPage, not the keypad. These checks are
  // for the keypad's own UI integrity across the mode transitions.
  it('shows the player name in the title', () => {
    renderKeypad(40, vi.fn(), vi.fn());
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it('title updates to reflect delta mode', () => {
    renderKeypad(40);
    switchToDeltaMode();
    expect(screen.getByText(/Change life · Alice/)).toBeTruthy();
  });
});
