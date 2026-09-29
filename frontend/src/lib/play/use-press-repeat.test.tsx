// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { usePressRepeat } from './use-press-repeat';

function Stepper({ onPress }: { onPress: () => void }) {
  const press = usePressRepeat(onPress, { delay: 400, interval: 100 });
  return (
    <button type="button" {...press}>
      step
    </button>
  );
}

describe('usePressRepeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // fireEvent (not raw dispatchEvent) so React's synthetic handlers actually
  // run — pointerleave in particular doesn't bubble to React's root listener.
  function pressButton() {
    const btn = screen.getByRole('button');
    fireEvent.pointerDown(btn);
    return btn;
  }

  it('fires once immediately on press', () => {
    const onPress = vi.fn();
    render(<Stepper onPress={onPress} />);
    pressButton();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('repeats while held, after the ramp delay', () => {
    const onPress = vi.fn();
    render(<Stepper onPress={onPress} />);
    pressButton();
    // Still just the initial press — the ramp hasn't elapsed.
    vi.advanceTimersByTime(399);
    expect(onPress).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 + 100 * 3);
    expect(onPress).toHaveBeenCalledTimes(4);
  });

  it('stops repeating on pointer up', () => {
    const onPress = vi.fn();
    render(<Stepper onPress={onPress} />);
    const btn = pressButton();
    vi.advanceTimersByTime(400 + 100 * 2);
    const atRelease = onPress.mock.calls.length;
    fireEvent.pointerUp(btn);
    vi.advanceTimersByTime(1000);
    expect(onPress).toHaveBeenCalledTimes(atRelease);
  });

  it('stops repeating when the pointer leaves the button', () => {
    const onPress = vi.fn();
    render(<Stepper onPress={onPress} />);
    const btn = pressButton();
    vi.advanceTimersByTime(400 + 100);
    const atLeave = onPress.mock.calls.length;
    fireEvent.pointerLeave(btn);
    vi.advanceTimersByTime(1000);
    expect(onPress).toHaveBeenCalledTimes(atLeave);
  });

  it('does not double-fire when a pointer press is followed by its click', () => {
    const onPress = vi.fn();
    render(<Stepper onPress={onPress} />);
    const btn = pressButton();
    fireEvent.pointerUp(btn);
    // A real pointer click carries detail >= 1, so the click path must ignore it.
    fireEvent.click(btn, { detail: 1 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('still fires for a keyboard-activated click (detail === 0)', () => {
    const onPress = vi.fn();
    render(<Stepper onPress={onPress} />);
    // Enter/Space synthesize a click with no pointerdown before it.
    fireEvent.click(screen.getByRole('button'), { detail: 0 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('clears the interval on unmount so it cannot fire into a dead component', () => {
    const onPress = vi.fn();
    const { unmount } = render(<Stepper onPress={onPress} />);
    pressButton();
    vi.advanceTimersByTime(400 + 100);
    const atUnmount = onPress.mock.calls.length;
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onPress).toHaveBeenCalledTimes(atUnmount);
  });
});
