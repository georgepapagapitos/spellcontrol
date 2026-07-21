import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  acceptPodInvite,
  createPod,
  declinePodInvite,
  deletePod,
  fetchPodGames,
  fetchPodLeaderboard,
  getPod,
  invitePodMembers,
  leavePod,
  listPods,
  pendingPodInviteCount,
  removePodMember,
  renamePod,
  PodNotFoundError,
  type Pod,
  type PodDetail,
} from './pods-client';

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

const pod: Pod = {
  id: 'p1',
  name: 'Friday commander',
  ownerUserId: 'u1',
  ownerUsername: 'george',
  createdAt: 1,
  myStatus: 'member',
  memberCount: 3,
};

describe('listPods', () => {
  it('unwraps the pods array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pods: [pod] }));
    expect(await listPods()).toEqual([pod]);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods');
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Failed to load pods.' }, 500));
    await expect(listPods()).rejects.toThrow('Failed to load pods.');
  });
});

describe('createPod', () => {
  it('POSTs the name and unwraps the pod', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pod }, 201));
    expect(await createPod('Friday commander')).toEqual(pod);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ name: 'Friday commander' });
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Pod name is required (max 60 characters).' }, 400)
    );
    await expect(createPod('')).rejects.toThrow('Pod name is required (max 60 characters).');
  });
});

describe('invitePodMembers', () => {
  it('POSTs the user ids and unwraps the invited list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ invited: ['u2', 'u3'] }));
    expect(await invitePodMembers('p1', ['u2', 'u3'])).toEqual({ invited: ['u2', 'u3'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/invites');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ userIds: ['u2', 'u3'] });
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'You can only invite friends.' }, 403));
    await expect(invitePodMembers('p1', ['u9'])).rejects.toThrow('You can only invite friends.');
  });
});

describe('acceptPodInvite / declinePodInvite / leavePod', () => {
  it('acceptPodInvite POSTs to the pod id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'member' }));
    await expect(acceptPodInvite('p1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/accept');
    expect(init.method).toBe('POST');
  });

  it('acceptPodInvite throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Pod not found.' }, 404));
    await expect(acceptPodInvite('p1')).rejects.toThrow('Pod not found.');
  });

  it('declinePodInvite treats 204 as success and surfaces other errors', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(declinePodInvite('p1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/decline');
    expect(init.method).toBe('POST');

    fetchMock.mockResolvedValue(jsonResponse({ error: 'Pod not found.' }, 404));
    await expect(declinePodInvite('p2')).rejects.toThrow('Pod not found.');
  });

  it('leavePod DELETEs the membership and treats 204 as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(leavePod('p1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/members/me');
    expect(init.method).toBe('DELETE');
  });

  it('leavePod surfaces the server error message on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "You're the pod owner — delete the pod instead." }, 400)
    );
    await expect(leavePod('p1')).rejects.toThrow("You're the pod owner — delete the pod instead.");
  });
});

describe('getPod', () => {
  const detail: PodDetail = {
    id: 'p1',
    name: 'Friday commander',
    ownerUserId: 'u1',
    ownerUsername: 'george',
    createdAt: 1,
    myStatus: 'member',
    members: [{ userId: 'u1', username: 'george', status: 'member', joinedAt: 1 }],
  };

  it('unwraps the pod detail', async () => {
    fetchMock.mockResolvedValue(jsonResponse(detail));
    expect(await getPod('p1')).toEqual(detail);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1');
  });

  it('throws PodNotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Pod not found.' }, 404));
    await expect(getPod('missing')).rejects.toThrow(PodNotFoundError);
  });

  it('throws the server error message on other failures', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    await expect(getPod('p1')).rejects.toThrow('boom');
  });
});

describe('renamePod', () => {
  it('PATCHes the name and returns the server-stored name', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pod: { ...pod, name: 'Saturday crew' } }));
    expect(await renamePod('p1', 'Saturday crew')).toBe('Saturday crew');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ name: 'Saturday crew' });
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Pod not found.' }, 404));
    await expect(renamePod('p1', 'x')).rejects.toThrow('Pod not found.');
  });
});

describe('deletePod', () => {
  it('DELETEs the pod and treats 204 as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deletePod('p1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1');
    expect(init.method).toBe('DELETE');
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Pod not found.' }, 404));
    await expect(deletePod('p1')).rejects.toThrow('Pod not found.');
  });
});

describe('removePodMember', () => {
  it('DELETEs the member and treats 204 as success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removePodMember('p1', 'u2')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/members/u2');
    expect(init.method).toBe('DELETE');
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Member not found.' }, 404));
    await expect(removePodMember('p1', 'u2')).rejects.toThrow('Member not found.');
  });
});

describe('fetchPodGames', () => {
  it('unwraps the games array', async () => {
    const game = {
      sessionId: 's1',
      code: 'CODE',
      format: 'commander',
      startingLife: 40,
      winnerSeat: 0,
      winnerUserId: 'u1',
      startedAt: 1,
      endedAt: 100,
      durationMs: 99,
      participants: [
        {
          seat: 0,
          userId: null,
          username: null,
          name: 'P0',
          deckId: null,
          deckName: null,
          commander: null,
          colorIdentity: [],
          finalLife: 40,
          eliminated: false,
        },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse({ games: [game] }));
    expect(await fetchPodGames('p1')).toEqual([game]);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/games');
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Not a pod member.' }, 403));
    await expect(fetchPodGames('p1')).rejects.toThrow('Not a pod member.');
  });
});

describe('fetchPodLeaderboard', () => {
  it('unwraps the standings array', async () => {
    const standings = [{ userId: 'u1', username: 'george', played: 2, wins: 1, winRate: 0.5 }];
    fetchMock.mockResolvedValue(jsonResponse({ standings }));
    expect(await fetchPodLeaderboard('p1')).toEqual(standings);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/pods/p1/leaderboard');
  });

  it('throws the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Not a pod member.' }, 403));
    await expect(fetchPodLeaderboard('p1')).rejects.toThrow('Not a pod member.');
  });
});

describe('pendingPodInviteCount', () => {
  it('counts only invited pods', () => {
    const pods: Pod[] = [
      { ...pod, id: 'p1', myStatus: 'invited' },
      { ...pod, id: 'p2', myStatus: 'member' },
      { ...pod, id: 'p3', myStatus: 'invited' },
    ];
    expect(pendingPodInviteCount(pods)).toBe(2);
  });

  it('returns 0 for an empty list or no invites', () => {
    expect(pendingPodInviteCount([])).toBe(0);
    expect(pendingPodInviteCount([{ ...pod, myStatus: 'member' }])).toBe(0);
  });
});
