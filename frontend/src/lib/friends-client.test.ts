import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  listFriends,
  listRequests,
  removeFriend,
  searchUsers,
  sendFriendRequest,
} from './friends-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchUsers', () => {
  it('GETs the query and unwraps users', async () => {
    const users = [{ id: 'u1', username: 'pat', friendStatus: 'none' as const }];
    fetchMock.mockResolvedValue(jsonResponse({ users }));
    expect(await searchUsers('pat')).toEqual(users);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/users/search?q=pat');
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Search failed.' }, 500));
    await expect(searchUsers('x')).rejects.toThrow('Search failed.');
  });
});

describe('sendFriendRequest', () => {
  it('POSTs the username and unwraps the response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ friendStatus: 'request_sent', addressee: { id: 'u2', username: 'sam' } }, 201)
    );
    const result = await sendFriendRequest('sam');
    expect(result).toEqual({
      friendStatus: 'request_sent',
      addressee: { id: 'u2', username: 'sam' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/friends/requests');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ username: 'sam' });
  });

  it('throws the server error message on failure (e.g. already pending)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Friend request already sent.' }, 409));
    await expect(sendFriendRequest('sam')).rejects.toThrow('Friend request already sent.');
  });
});

describe('acceptRequest / declineRequest / cancelRequest', () => {
  it('acceptRequest POSTs to the requester id and unwraps the friend', async () => {
    const friend = { id: 'u2', username: 'sam', friendedAt: 1, cardCount: 3 };
    fetchMock.mockResolvedValue(jsonResponse({ friend }));
    expect(await acceptRequest('u2')).toEqual(friend);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/friends/requests/u2/accept');
    expect(init.method).toBe('POST');
  });

  it('declineRequest treats 204 as success and surfaces other errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(declineRequest('u2')).resolves.toBeUndefined();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Friend request not found.' }, 404));
    await expect(declineRequest('u3')).rejects.toThrow('Friend request not found.');
  });

  it('cancelRequest DELETEs the outgoing request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(cancelRequest('u2')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/friends/requests/u2');
    expect(init.method).toBe('DELETE');
  });
});

describe('removeFriend / listFriends / listRequests', () => {
  it('removeFriend DELETEs and treats 204 as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removeFriend('u2')).resolves.toBeUndefined();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Friend not found.' }, 404));
    await expect(removeFriend('u3')).rejects.toThrow('Friend not found.');
  });

  it('listFriends unwraps the friends array', async () => {
    const friends = [{ id: 'u2', username: 'sam', friendedAt: 1, cardCount: 3 }];
    fetchMock.mockResolvedValue(jsonResponse({ friends }));
    expect(await listFriends()).toEqual(friends);
  });

  it('listRequests unwraps incoming/outgoing', async () => {
    const body = { incoming: [], outgoing: [] };
    fetchMock.mockResolvedValue(jsonResponse(body));
    expect(await listRequests()).toEqual(body);
  });
});
