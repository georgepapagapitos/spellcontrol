// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTaggerData: vi.fn(),
  loadTaggerData: vi.fn(),
}));

import { useTaggerReady } from './use-tagger-ready';
import { hasTaggerData, loadTaggerData } from '@/deck-builder/services/tagger/client';

const mockHas = hasTaggerData as ReturnType<typeof vi.fn>;
const mockLoad = loadTaggerData as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTaggerReady', () => {
  it('returns false initially when tagger not ready and load is pending', () => {
    mockHas.mockReturnValue(false);
    mockLoad.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTaggerReady());
    expect(result.current).toBe(false);
  });

  it('returns true immediately when tagger data is already loaded', () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(Promise.resolve(null));
    const { result } = renderHook(() => useTaggerReady());
    expect(result.current).toBe(true);
  });

  it('flips to true after loadTaggerData resolves', async () => {
    let resolve!: () => void;
    const p = new Promise<void>((r) => {
      resolve = r;
    });
    // useState initializer → false, useEffect guard → false, .then() check → true
    mockHas.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    mockLoad.mockReturnValue(p.then(() => null));
    const { result } = renderHook(() => useTaggerReady());
    expect(result.current).toBe(false);
    resolve();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('does not setState after unmount', async () => {
    let resolve!: () => void;
    const p = new Promise<void>((r) => {
      resolve = r;
    });
    mockHas.mockReturnValue(false);
    mockLoad.mockReturnValue(p.then(() => null));
    const { result, unmount } = renderHook(() => useTaggerReady());
    unmount();
    resolve();
    // allow microtask queue to drain
    await Promise.resolve();
    expect(result.current).toBe(false);
  });
});
