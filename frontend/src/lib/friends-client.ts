import { apiUrl } from './api-base';

export type FriendStatus = 'none' | 'friends' | 'request_sent' | 'request_received';

export interface FriendUser {
  id: string;
  username: string;
  friendStatus: FriendStatus;
}

export interface FriendRequest {
  requesterId: string;
  requesterUsername: string;
  addresseeId: string;
  addresseeUsername: string;
  createdAt: number;
}

export interface Friend {
  id: string;
  username: string;
  friendedAt: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function searchUsers(q: string): Promise<FriendUser[]> {
  const res = await fetch(apiUrl(`/api/users/search?q=${encodeURIComponent(q)}`), {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to search users.'));
  }
  const body = (await res.json()) as { users: FriendUser[] };
  return body.users;
}

export async function sendFriendRequest(
  username: string
): Promise<{ friendStatus: FriendStatus; addressee: { id: string; username: string } }> {
  const res = await fetch(apiUrl('/api/friends/requests'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to send friend request.'));
  }
  return (await res.json()) as {
    friendStatus: FriendStatus;
    addressee: { id: string; username: string };
  };
}

export async function acceptRequest(requesterId: string): Promise<Friend> {
  const res = await fetch(
    apiUrl(`/api/friends/requests/${encodeURIComponent(requesterId)}/accept`),
    {
      method: 'POST',
      credentials: 'include',
    }
  );
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to accept friend request.'));
  }
  const body = (await res.json()) as { friend: Friend };
  return body.friend;
}

export async function declineRequest(requesterId: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/friends/requests/${encodeURIComponent(requesterId)}/decline`),
    {
      method: 'POST',
      credentials: 'include',
    }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to decline friend request.'));
  }
}

export async function cancelRequest(addresseeId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/friends/requests/${encodeURIComponent(addresseeId)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to cancel friend request.'));
  }
}

export async function removeFriend(friendId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/friends/${encodeURIComponent(friendId)}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, 'Failed to remove friend.'));
  }
}

export async function listFriends(): Promise<Friend[]> {
  const res = await fetch(apiUrl('/api/friends'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load friends.'));
  }
  const body = (await res.json()) as { friends: Friend[] };
  return body.friends;
}

export async function listRequests(): Promise<{
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}> {
  const res = await fetch(apiUrl('/api/friends/requests'), { credentials: 'include' });
  if (!res.ok) {
    throw new Error(await readError(res, 'Failed to load friend requests.'));
  }
  return (await res.json()) as { incoming: FriendRequest[]; outgoing: FriendRequest[] };
}
