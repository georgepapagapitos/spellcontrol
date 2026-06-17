// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCollapsedPref } from './use-collapsed-pref';

afterEach(() => window.localStorage.clear());

describe('useCollapsedPref', () => {
  it('defaults to collapsed when no preference is stored', () => {
    const { result } = renderHook(() => useCollapsedPref('k1'));
    expect(result.current[0]).toBe(true);
  });

  it('honors an explicit default of expanded', () => {
    const { result } = renderHook(() => useCollapsedPref('k2', false));
    expect(result.current[0]).toBe(false);
  });

  it('persists changes to localStorage as 1/0 and re-reads them', () => {
    const first = renderHook(() => useCollapsedPref('k3', false));
    act(() => first.result.current[1](true));
    expect(window.localStorage.getItem('k3')).toBe('1');

    // A fresh mount reads the persisted value, ignoring the default.
    const second = renderHook(() => useCollapsedPref('k3', false));
    expect(second.result.current[0]).toBe(true);
  });

  it('supports a functional updater (toggle)', () => {
    const { result } = renderHook(() => useCollapsedPref('k4'));
    act(() => result.current[1]((c) => !c));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem('k4')).toBe('0');
  });
});
