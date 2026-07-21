import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActivity } from './activity-client';

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

describe('getActivity', () => {
  it('GETs /api/activity with credentials and returns the parsed body', async () => {
    const body = {
      actionRequired: [
        {
          type: 'friend_request',
          id: 'friend_request:u1',
          requesterId: 'u1',
          requesterUsername: 'alice',
          requesterDisplayName: null,
          occurredAt: 100,
        },
      ],
      recent: [
        {
          type: 'deck_liked',
          id: 'deck_liked:my-deck',
          slug: 'my-deck',
          deckName: 'My Deck',
          count: 3,
          occurredAt: 200,
        },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body));

    const result = await getActivity();

    expect(result).toEqual(body);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/activity',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('throws with the server error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Authentication required.' }, { status: 401 })
    );
    await expect(getActivity()).rejects.toThrow(/Authentication required/);
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(getActivity()).rejects.toThrow(/Failed to load activity/);
  });

  it('falls back to a generic message when the error body has no error field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, { status: 500 }));
    await expect(getActivity()).rejects.toThrow(/Failed to load activity/);
  });
});
