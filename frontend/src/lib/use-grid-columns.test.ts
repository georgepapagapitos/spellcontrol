// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridTrackCount, useGridColumns } from './use-grid-columns';

describe('gridTrackCount', () => {
  it('counts every track of a laid-out grid, empty auto-fill tracks included', () => {
    expect(gridTrackCount('252px')).toBe(1);
    expect(gridTrackCount('252.5px 252.5px 252.5px 252.5px 252.5px 252.5px 252.5px')).toBe(7);
    expect(gridTrackCount('  180px 180px  ')).toBe(2);
  });

  it('is null for anything that is not a resolved track list', () => {
    expect(gridTrackCount('')).toBeNull();
    expect(gridTrackCount('none')).toBeNull();
    expect(gridTrackCount('repeat(auto-fill, minmax(min(100%, 15rem), 1fr))')).toBeNull();
    expect(gridTrackCount('1fr 1fr')).toBeNull();
  });
});

describe('useGridColumns', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubTracks(get: () => string) {
    const real = window.getComputedStyle.bind(window);
    vi.stubGlobal('getComputedStyle', (el: Element) => {
      const style = real(el);
      return new Proxy(style, {
        get: (t, k) => (k === 'gridTemplateColumns' ? get() : Reflect.get(t, k)),
      });
    });
  }

  it('is null until an element attaches, then reports its tracks', () => {
    stubTracks(() => '200px 200px 200px 200px');
    const { result } = renderHook(() => useGridColumns<HTMLDivElement>());
    expect(result.current[1]).toBeNull();
    act(() => result.current[0](document.createElement('div')));
    expect(result.current[1]).toBe(4);
  });

  it('follows a resize and keeps the last good count through an unmeasurable frame', () => {
    let template = '200px 200px 200px';
    stubTracks(() => template);
    let fire = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const { result, unmount } = renderHook(() => useGridColumns<HTMLDivElement>());
    act(() => result.current[0](document.createElement('div')));
    expect(result.current[1]).toBe(3);

    template = '200px 200px 200px 200px 200px 200px 200px';
    act(() => fire());
    expect(result.current[1]).toBe(7);

    template = 'none';
    act(() => fire());
    expect(result.current[1]).toBe(7);

    act(() => result.current[0](null));
    expect(disconnect).toHaveBeenCalled();
    unmount();
  });
});
