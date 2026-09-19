// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';

vi.mock('../lib/use-activity', () => ({
  useActivity: () => ({ count: 0, actionRequired: [], recent: [] }),
}));
vi.mock('../lib/pods-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pods-client')>();
  return { ...actual, listPods: vi.fn(() => Promise.resolve([])) };
});

import { listPods, type Pod } from '../lib/pods-client';
import { SocialHubTabs } from './SocialHubTabs';

const invite: Pod = {
  id: 'p1',
  name: 'Late invite',
  ownerUserId: 'owner1',
  ownerUsername: 'sam',
  createdAt: 1,
  myStatus: 'invited',
  memberCount: 1,
};

beforeEach(() => {
  useAuth.setState({
    user: { id: 'me', username: 'viewer', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
  vi.mocked(listPods).mockReset().mockResolvedValue([]);
});

describe('SocialHubTabs', () => {
  it('refetches the pod-invite chip on window focus (playtest batch 9)', async () => {
    // An invite landing while a social page sat open never reached this chip
    // until a reload — the Trades chip beside it (activity feed) already
    // refetches on focus, and the two must not disagree.
    render(
      <MemoryRouter initialEntries={['/pods']}>
        <SocialHubTabs />
      </MemoryRouter>
    );
    expect(await screen.findByText('Pods')).toBeTruthy();
    expect(screen.queryByLabelText(/invites awaiting your reply/i)).toBeNull();

    vi.mocked(listPods).mockResolvedValue([invite]);
    fireEvent(window, new Event('focus'));

    expect(await screen.findByLabelText('1 invites awaiting your reply')).toBeTruthy();
  });
});
