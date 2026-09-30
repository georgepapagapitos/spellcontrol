// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSelection } from './use-selection';

describe('useSelection', () => {
  it('starts off, with an empty selection', () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });

  it('toggles ids on and off', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('b'));
    expect([...result.current.selected]).toEqual(['a', 'b']);
    act(() => result.current.toggle('a'));
    expect([...result.current.selected]).toEqual(['b']);
  });

  it('selectAll replaces the selection; clear empties it', () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle('z'));
    act(() => result.current.selectAll(['a', 'b', 'c']));
    expect([...result.current.selected]).toEqual(['a', 'b', 'c']);
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
  });

  it('enter turns mode on; exit turns it off and drops the selection', () => {
    const { result } = renderHook(() => useSelection());
    act(() => {
      result.current.enter();
      result.current.toggle('a');
    });
    expect(result.current.selectMode).toBe(true);
    expect(result.current.selected.size).toBe(1);
    act(() => result.current.exit());
    expect(result.current.selectMode).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });
});
