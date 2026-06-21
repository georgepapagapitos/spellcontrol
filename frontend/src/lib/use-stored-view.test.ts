// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStoredView } from './use-stored-view';

const VALID = ['grid', 'list', 'compact'] as const;
type Mode = (typeof VALID)[number];
const KEY = 'test-view-key';

describe('useStoredView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns fallback when nothing is stored', () => {
    const { result } = renderHook(() => useStoredView<Mode>(KEY, VALID, 'grid'));
    expect(result.current[0]).toBe('grid');
  });

  it('loads persisted view from localStorage', () => {
    localStorage.setItem(KEY, 'compact');
    const { result } = renderHook(() => useStoredView<Mode>(KEY, VALID, 'grid'));
    expect(result.current[0]).toBe('compact');
  });

  it('falls back when stored value is not in validValues', () => {
    localStorage.setItem(KEY, 'bogus');
    const { result } = renderHook(() => useStoredView<Mode>(KEY, VALID, 'grid'));
    expect(result.current[0]).toBe('grid');
  });

  it('updates state and persists when setter is called', () => {
    const { result } = renderHook(() => useStoredView<Mode>(KEY, VALID, 'grid'));
    act(() => result.current[1]('list'));
    expect(result.current[0]).toBe('list');
    expect(localStorage.getItem(KEY)).toBe('list');
  });
});
