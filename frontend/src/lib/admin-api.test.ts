import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listUsers } from './admin-api';

const bootstrapMock = vi.fn();
vi.mock('../store/auth', () => ({
  useAuth: { getState: () => ({ bootstrap: bootstrapMock }) },
}));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  bootstrapMock.mockReset();
});

describe('admin-api — a 403 re-checks auth (E351, playtest batch 12)', () => {
  it('a 403 from an admin call re-runs auth bootstrap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Admin required.' }, { status: 403 })
    );
    await expect(listUsers()).rejects.toThrow('Admin required.');
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it('a non-403 failure leaves auth alone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'boom' }, { status: 500 })
    );
    await expect(listUsers()).rejects.toThrow('boom');
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});
