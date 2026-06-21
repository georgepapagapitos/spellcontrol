import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithAbortTimeout } from './fetch-utils';

// fetchWithAbortTimeout resolves the path via apiUrl which prepends
// VITE_API_BASE_URL when set. In tests that variable is unset so paths pass
// through unchanged.

describe('fetchWithAbortTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with the Response on success', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const result = await fetchWithAbortTimeout('/api/test', { method: 'GET' }, 5000, 'timed out');
    expect(result).toBe(mockResponse);
  });

  it('throws the timeoutError message when the request is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
        )
    );

    await expect(
      fetchWithAbortTimeout('/api/test', { method: 'GET' }, 5000, 'Custom timeout message')
    ).rejects.toThrow('Custom timeout message');
  });

  it('rethrows non-abort errors as-is', async () => {
    const networkErr = new Error('Network failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));

    await expect(
      fetchWithAbortTimeout('/api/test', { method: 'GET' }, 5000, 'timed out')
    ).rejects.toThrow('Network failure');
  });
});
