// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BinderDef, EnrichedCard } from '@/types/index';

const materialize = vi.hoisted(() => vi.fn());
vi.mock('./materialize', () => ({ materializeBinders: materialize }));

const inputs = vi.hoisted(() => ({
  current: null as unknown as {
    cards: EnrichedCard[];
    binders: BinderDef[];
    allocatedCopyIds: ReadonlySet<string>;
    setMap: undefined;
  },
}));
vi.mock('./use-binder-layout-inputs', () => ({ useBinderLayoutInputs: () => inputs.current }));

import { useBinderByCopyIdAfterPaint } from './use-binder-by-copy';

describe('useBinderByCopyIdAfterPaint', () => {
  let idle: Array<() => void>;
  beforeEach(() => {
    idle = [];
    materialize.mockReset();
    materialize.mockReturnValue({
      binders: [
        {
          def: { id: 'b1', name: 'Staples', color: '#abc' },
          sections: [{ cards: [{ copyId: 'c1' }] }],
        },
      ],
    });
    inputs.current = {
      cards: [{ copyId: 'c1' } as EnrichedCard],
      binders: [{ id: 'b1' } as BinderDef],
      allocatedCopyIds: new Set<string>(),
      setMap: undefined,
    };
    Object.assign(window, {
      requestIdleCallback: (cb: () => void) => idle.push(cb),
      cancelIdleCallback: () => {},
    });
  });

  it('leaves the materialize pass out of the render and runs it from an idle callback', () => {
    const { result } = renderHook(() => useBinderByCopyIdAfterPaint());
    expect(materialize).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);

    act(() => idle.forEach((run) => run()));
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(result.current.get('c1')).toEqual([{ id: 'b1', name: 'Staples', color: '#abc' }]);
  });

  it('keeps the previous map while a changed input waits for the next idle slot', () => {
    const { result, rerender } = renderHook(() => useBinderByCopyIdAfterPaint());
    act(() => idle.splice(0).forEach((run) => run()));
    const filled = result.current;
    expect(filled.size).toBe(1);

    inputs.current = { ...inputs.current, allocatedCopyIds: new Set(['c1']) };
    rerender();
    expect(result.current).toBe(filled);
    expect(materialize).toHaveBeenCalledTimes(1);
  });
});
