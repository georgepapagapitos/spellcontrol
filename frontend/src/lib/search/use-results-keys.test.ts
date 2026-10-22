// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { jumpTarget, useResultsKeys } from './use-results-keys';
import type { CardSearchResultsHandle } from '@/lib/search/use-results-keys';

function keyEvent(
  key: string,
  over: Partial<{ isComposing: boolean }> = {}
): { event: KeyboardEvent<HTMLInputElement>; preventDefault: () => void } {
  const preventDefault = vi.fn();
  const event = {
    key,
    nativeEvent: { isComposing: over.isComposing ?? false },
    preventDefault,
  } as unknown as KeyboardEvent<HTMLInputElement>;
  return { event, preventDefault };
}

describe('useResultsKeys', () => {
  it('leaves every key alone until a result has gone active', () => {
    const { result } = renderHook(() => useResultsKeys());
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;

    const { event, preventDefault } = keyEvent('ArrowDown');
    act(() => result.current.onKeyDown(event));

    expect(handle.moveActive).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('moves the active row on ArrowDown/ArrowUp and adds it on Enter once active', () => {
    const { result } = renderHook(() => useResultsKeys());
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;

    act(() => result.current.onActiveChange({ id: 'a', name: 'Sol Ring' } as never));

    act(() => result.current.onKeyDown(keyEvent('ArrowDown').event));
    expect(handle.moveActive).toHaveBeenCalledWith(1);

    act(() => result.current.onKeyDown(keyEvent('ArrowUp').event));
    expect(handle.moveActive).toHaveBeenCalledWith(-1);

    act(() => result.current.onKeyDown(keyEvent('Enter').event));
    expect(handle.addActive).toHaveBeenCalledTimes(1);
  });

  it('passes IME composition keys through untouched even while a row is active', () => {
    const { result } = renderHook(() => useResultsKeys());
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;
    act(() => result.current.onActiveChange({ id: 'a', name: 'Sol Ring' } as never));

    const { event, preventDefault } = keyEvent('Enter', { isComposing: true });
    act(() => result.current.onKeyDown(event));

    expect(handle.addActive).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('going back to no active row (an emptied result set) stops swallowing the keys again', () => {
    const { result } = renderHook(() => useResultsKeys());
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;
    act(() => result.current.onActiveChange({ id: 'a', name: 'Sol Ring' } as never));
    act(() => result.current.onActiveChange(null));

    const { event, preventDefault } = keyEvent('Enter');
    act(() => result.current.onKeyDown(event));

    expect(handle.addActive).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

// A lookup page (SearchPage) passes this so an Enter out of habit right
// after typing doesn't silently add CardSearchResults' row-0 default.
describe('useResultsKeys({ enterNeedsNav: true })', () => {
  it('passes Enter through until an arrow has moved the active row, then adds', () => {
    const { result } = renderHook(
      ({ resetKey }) => useResultsKeys({ enterNeedsNav: true, resetKey }),
      {
        initialProps: { resetKey: 'sol ring' as unknown },
      }
    );
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;
    act(() => result.current.onActiveChange({ id: 'a', name: 'Sol Ring' } as never));

    act(() => result.current.onKeyDown(keyEvent('Enter').event));
    expect(handle.addActive).not.toHaveBeenCalled();

    act(() => result.current.onKeyDown(keyEvent('ArrowDown').event));
    // Nothing was selected yet, so the first arrow selects the top hit
    // rather than skipping past it to row 1.
    expect(handle.moveActive).toHaveBeenLastCalledWith(0);
    act(() => result.current.onKeyDown(keyEvent('Enter').event));
    expect(handle.addActive).toHaveBeenCalledTimes(1);

    act(() => result.current.onKeyDown(keyEvent('ArrowDown').event));
    expect(handle.moveActive).toHaveBeenLastCalledWith(1);
  });

  it('re-requires an arrow press once resetKey changes (a new query)', () => {
    const { result, rerender } = renderHook(
      ({ resetKey }) => useResultsKeys({ enterNeedsNav: true, resetKey }),
      { initialProps: { resetKey: 'sol ring' as unknown } }
    );
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;
    act(() => result.current.onActiveChange({ id: 'a', name: 'Sol Ring' } as never));
    act(() => result.current.onKeyDown(keyEvent('ArrowDown').event));

    act(() => rerender({ resetKey: 'lightning bolt' }));

    act(() => result.current.onKeyDown(keyEvent('Enter').event));
    expect(handle.addActive).not.toHaveBeenCalled();
  });
});

// E1008: Home/End reach the ends of the list without taking the input's caret.
describe('jumpTarget / Home and End', () => {
  const press = (key: string, value: string, mods: Record<string, boolean> = {}) =>
    jumpTarget({ key, currentTarget: { value }, ...mods });

  it('Ctrl or Cmd with Home/End always jumps', () => {
    expect(press('Home', 'sol', { ctrlKey: true })).toBe('first');
    expect(press('End', 'sol', { ctrlKey: true })).toBe('last');
    expect(press('End', 'sol', { metaKey: true })).toBe('last');
  });

  it('plain Home/End jump only while the box is empty; otherwise they move the caret', () => {
    expect(press('End', '')).toBe('last');
    expect(press('Home', '')).toBe('first');
    expect(press('End', 'sol')).toBeNull();
    expect(press('Home', 'sol')).toBeNull();
  });

  it('Shift (text selection) and Alt are left alone, and other keys are not jumps', () => {
    expect(press('End', 'sol', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('Home', '', { altKey: true })).toBeNull();
    expect(press('ArrowDown', '')).toBeNull();
  });

  it('the hook moves the active row to either end and swallows the key', () => {
    const { result } = renderHook(() => useResultsKeys());
    const handle: CardSearchResultsHandle = { moveActive: vi.fn(), addActive: vi.fn() };
    result.current.resultsRef.current = handle;
    act(() => result.current.onActiveChange({ id: 'a', name: 'Sol Ring' } as never));

    const end = {
      key: 'End',
      ctrlKey: true,
      currentTarget: { value: 'sol' },
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent<HTMLInputElement>;
    act(() => result.current.onKeyDown(end));
    expect(handle.moveActive).toHaveBeenLastCalledWith('last');
    expect(end.preventDefault).toHaveBeenCalled();

    const caret = { ...end, ctrlKey: false, preventDefault: vi.fn() };
    act(() => result.current.onKeyDown(caret as unknown as KeyboardEvent<HTMLInputElement>));
    expect(handle.moveActive).toHaveBeenCalledTimes(1);
    expect(caret.preventDefault).not.toHaveBeenCalled();
  });
});
