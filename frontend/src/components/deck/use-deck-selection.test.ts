// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Row } from './deck-display-rows';
import { useDeckSelection } from './use-deck-selection';

const row = (...slotIds: string[]) => ({ slotIds }) as unknown as Row;

describe('useDeckSelection', () => {
  it('toggles a whole stack of slots on and off', () => {
    const { result } = renderHook(() => useDeckSelection());
    act(() => result.current.toggleRowSelected('cards', row('a', 'b')));
    expect(result.current.selection?.keys).toEqual(new Set(['a', 'b']));
    expect(result.current.isRowSelected('cards', row('a', 'b'))).toBe(true);
    act(() => result.current.toggleRowSelected('cards', row('a', 'b')));
    expect(result.current.selection).toBeNull();
  });

  it('keeps a selection to one zone: a row in another zone starts over', () => {
    const { result } = renderHook(() => useDeckSelection());
    act(() => result.current.toggleRowSelected('cards', row('a')));
    act(() => result.current.toggleRowSelected('sideboard', row('s')));
    expect(result.current.selection).toEqual({ zone: 'sideboard', keys: new Set(['s']) });
    expect(result.current.isRowSelected('cards', row('a'))).toBe(false);
  });

  it('ignores a row with no slots (the commander)', () => {
    const { result } = renderHook(() => useDeckSelection());
    act(() => result.current.toggleRowSelected('cards', row()));
    expect(result.current.selection).toBeNull();
    expect(result.current.isRowSelected('cards', row())).toBe(false);
  });

  it('leaving select mode drops the selection', () => {
    const { result } = renderHook(() => useDeckSelection());
    act(() => {
      result.current.setSelectMode(true);
      result.current.toggleRowSelected('cards', row('a'));
    });
    act(() => result.current.exitSelectMode());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selection).toBeNull();
  });
});
