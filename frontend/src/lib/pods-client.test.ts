import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  acceptPodInvite,
  createPod,
  declinePodInvite,
  invitePodMembers,
  leavePod,
  listPods,
  pendingPodInviteCount,
  type Pod,
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
