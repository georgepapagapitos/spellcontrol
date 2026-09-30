// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOnline } from './use-online';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('useOnline', () => {
  it('follows the connection as it drops and comes back', () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    act(() => setOnline(false));
    expect(result.current).toBe(false);

    act(() => setOnline(true));
    expect(result.current).toBe(true);
  });
});
