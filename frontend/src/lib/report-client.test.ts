import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitReport } from './report-client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('submitReport', () => {
  it('POSTs kind/targetId/reason with credentials included', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }, { status: 201 }));
    await submitReport({ kind: 'deck', targetId: 'd1', reason: 'Spam' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ kind: 'deck', targetId: 'd1', reason: 'Spam' });
  });

  it('resolves without a value on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }, { status: 201 }));
    await expect(
      submitReport({ kind: 'profile', targetId: 'nova', reason: 'x' })
    ).resolves.toBeUndefined();
  });

  it('throws with the server error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { error: 'reason is required and must be 500 characters or fewer.' },
        { status: 400 }
      )
    );
    await expect(submitReport({ kind: 'deck', targetId: 'd1', reason: '' })).rejects.toThrow(
      /reason is required/
    );
  });

  it('surfaces the distinct "no longer available" 404 message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'This content is no longer available.' }, { status: 404 })
    );
    await expect(submitReport({ kind: 'deck', targetId: 'gone', reason: 'x' })).rejects.toThrow(
      /no longer available/
    );
  });

  it('falls back to a generic message when the error body is unparsable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(submitReport({ kind: 'deck', targetId: 'd1', reason: 'x' })).rejects.toThrow(
      /Failed to submit report/
    );
  });
});
