// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStoredSort } from './use-stored-sort';

const DEFAULT_DIR_MAP = {
  name: 'asc' as const,
  cards: 'desc' as const,
  date: 'desc' as const,
};
type Field = keyof typeof DEFAULT_DIR_MAP;

const KEY = 'test-sort-key';

describe('useStoredSort', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with the default field and direction', () => {
    const { result } = renderHook(() => useStoredSort<Field>(KEY, DEFAULT_DIR_MAP, 'name'));
    expect(result.current.sortField).toBe('name');
    expect(result.current.sortDir).toBe('asc');
  });

  it('loads persisted sort from localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify({ field: 'cards', dir: 'asc' }));
    const { result } = renderHook(() => useStoredSort<Field>(KEY, DEFAULT_DIR_MAP, 'name'));
    expect(result.current.sortField).toBe('cards');
    expect(result.current.sortDir).toBe('asc');
  });

  it('ignores stored value with invalid field and falls back to default', () => {
    localStorage.setItem(KEY, JSON.stringify({ field: 'bogus', dir: 'asc' }));
    const { result } = renderHook(() => useStoredSort<Field>(KEY, DEFAULT_DIR_MAP, 'name'));
    expect(result.current.sortField).toBe('name');
    expect(result.current.sortDir).toBe('asc');
  });

  it('toggles direction when clicking the active field', () => {
    const { result } = renderHook(() => useStoredSort<Field>(KEY, DEFAULT_DIR_MAP, 'name'));
    act(() => result.current.toggleSort('name'));
    expect(result.current.sortField).toBe('name');
    expect(result.current.sortDir).toBe('desc');
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toEqual({ field: 'name', dir: 'desc' });
  });

  it('switches field with its default direction', () => {
    const { result } = renderHook(() => useStoredSort<Field>(KEY, DEFAULT_DIR_MAP, 'name'));
    act(() => result.current.toggleSort('cards'));
    expect(result.current.sortField).toBe('cards');
    expect(result.current.sortDir).toBe('desc');
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored).toEqual({ field: 'cards', dir: 'desc' });
  });
});
