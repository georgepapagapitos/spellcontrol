// @vitest-environment happy-dom
/**
 * PodsIndexPage — invited + member sections from a mixed list, the create
 * flow (with/without an invite-friends selection, and the create-succeeds-
 * invite-fails degraded path), accept/decline, and the guest gate.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above the file's own top-level code — a variable read
// inside a factory must come from vi.hoisted (see FriendsManagement.test.tsx).
const { authState } = vi.hoisted(() => ({
  authState: { status: 'authed' as 'authed' | 'guest' },
}));

vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector(authState),
}));

vi.mock('../lib/friends-client', () => ({
  listFriends: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../lib/pods-client', () => ({
  listPods: vi.fn(() => Promise.resolve([])),
  createPod: vi.fn(),
  invitePodMembers: vi.fn(() => Promise.resolve({ invited: [] })),
  acceptPodInvite: vi.fn(() => Promise.resolve()),
  declinePodInvite: vi.fn(() => Promise.resolve()),
}));

import { PodsIndexPage } from './PodsIndexPage';
import { listFriends } from '../lib/friends-client';
import {
  acceptPodInvite,
  createPod,
  declinePodInvite,
  invitePodMembers,
  listPods,
  type Pod,
} from '../lib/pods-client';
import { toast } from '../store/toasts';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pods']}>
      <Routes>
        <Route path="/pods" element={<PodsIndexPage />} />
        <Route path="/pods/:id" element={<div data-testid="pod-hub-stub">Pod hub stub</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function pod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: 'p1',
    name: 'Friday commander',
    ownerUserId: 'owner1',
    ownerUsername: 'sam',
    createdAt: 1,
    myStatus: 'member',
    memberCount: 2,
    ...overrides,
  };
}

afterEach(() => {
  authState.status = 'authed';
  vi.mocked(listPods).mockReset().mockResolvedValue([]);
  vi.mocked(createPod).mockReset();
  vi.mocked(invitePodMembers).mockReset().mockResolvedValue({ invited: [] });
  vi.mocked(acceptPodInvite).mockReset().mockResolvedValue(undefined);
  vi.mocked(declinePodInvite).mockReset().mockResolvedValue(undefined);
  vi.mocked(listFriends).mockReset().mockResolvedValue([]);
});

describe('PodsIndexPage — guest gate', () => {
  it('renders a sign-in prompt instead of the page content', () => {
    authState.status = 'guest';
    renderPage();

    expect(screen.getByText(/sign in to set up your pod/i)).toBeTruthy();
    const signIn = screen.getByRole('link', { name: /^sign in$/i });
    expect(signIn.getAttribute('href')).toBe('/auth');
  });
});

describe('PodsIndexPage — mixed list render', () => {
  it('renders the Invited section and the Your pods grid from a mixed list', async () => {
    vi.mocked(listPods).mockResolvedValue([
      pod({ id: 'invited1', name: 'Invited pod', myStatus: 'invited', memberCount: 3 }),
      pod({ id: 'member1', name: 'My pod', myStatus: 'member', memberCount: 4 }),
    ]);
    renderPage();

    expect(await screen.findByText('Invited pod')).toBeTruthy();
    expect(screen.getByRole('button', { name: /accept invite to invited pod/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /decline invite to invited pod/i })).toBeTruthy();

    const podLink = screen.getByRole('link', { name: /my pod/i });
    expect(podLink.getAttribute('href')).toBe('/pods/member1');
  });
});

describe('PodsIndexPage — create flow', () => {
  it('posts just {name} when no friends are checked', async () => {
    vi.mocked(createPod).mockResolvedValue(pod({ id: 'new1', name: 'New table' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^create pod$/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByPlaceholderText(/friday commander table/i), {
      target: { value: 'New table' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^create pod$/i }));

    await waitFor(() => expect(createPod).toHaveBeenCalledWith('New table'));
    expect(invitePodMembers).not.toHaveBeenCalled();
    expect(await screen.findByTestId('pod-hub-stub')).toBeTruthy();
  });

  it('posts {name} then invitePodMembers with the checked friend ids', async () => {
    vi.mocked(listFriends).mockResolvedValue([
      { id: 'f1', username: 'bob', displayName: null, friendedAt: 1, cardCount: 0 },
    ]);
    vi.mocked(createPod).mockResolvedValue(pod({ id: 'new2', name: 'New table' }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^create pod$/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByPlaceholderText(/friday commander table/i), {
      target: { value: 'New table' },
    });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /bob/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^create pod$/i }));

    await waitFor(() => expect(createPod).toHaveBeenCalledWith('New table'));
    await waitFor(() => expect(invitePodMembers).toHaveBeenCalledWith('new2', ['f1']));
    expect(await screen.findByTestId('pod-hub-stub')).toBeTruthy();
  });

  it('still navigates and shows a degraded toast when the invite call fails after a successful create', async () => {
    vi.mocked(listFriends).mockResolvedValue([
      { id: 'f1', username: 'bob', displayName: null, friendedAt: 1, cardCount: 0 },
    ]);
    vi.mocked(createPod).mockResolvedValue(pod({ id: 'new3', name: 'New table' }));
    vi.mocked(invitePodMembers).mockRejectedValue(new Error('network blip'));
    const toastSpy = vi.spyOn(toast, 'show').mockReturnValue('toast-1');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^create pod$/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByPlaceholderText(/friday commander table/i), {
      target: { value: 'New table' },
    });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /bob/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^create pod$/i }));

    expect(await screen.findByTestId('pod-hub-stub')).toBeTruthy();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'error',
        message: 'Pod created, but invites failed to send — invite friends from the pod page.',
      })
    );
  });
});

describe('PodsIndexPage — accept / decline', () => {
  it('accepts an invite and removes the row from the Invited section', async () => {
    vi.mocked(listPods)
      .mockResolvedValueOnce([pod({ id: 'invited1', name: 'Invited pod', myStatus: 'invited' })])
      .mockResolvedValueOnce([]);
    renderPage();

    const acceptBtn = await screen.findByRole('button', {
      name: /accept invite to invited pod/i,
    });
    fireEvent.click(acceptBtn);

    await waitFor(() => expect(acceptPodInvite).toHaveBeenCalledWith('invited1'));
    await waitFor(() => expect(screen.queryByText('Invited pod')).toBeNull());
  });

  it('declines an invite and removes the row from the Invited section', async () => {
    vi.mocked(listPods)
      .mockResolvedValueOnce([pod({ id: 'invited1', name: 'Invited pod', myStatus: 'invited' })])
      .mockResolvedValueOnce([]);
    renderPage();

    const declineBtn = await screen.findByRole('button', {
      name: /decline invite to invited pod/i,
    });
    fireEvent.click(declineBtn);

    await waitFor(() => expect(declinePodInvite).toHaveBeenCalledWith('invited1'));
    await waitFor(() => expect(screen.queryByText('Invited pod')).toBeNull());
  });
});
