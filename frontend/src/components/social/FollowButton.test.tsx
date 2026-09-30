// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { useToastsStore } from '../../store/toasts';

const { followMock, unfollowMock } = vi.hoisted(() => ({
  followMock: vi.fn(),
  unfollowMock: vi.fn(),
}));
vi.mock('@/lib/social/brewers-client', () => ({
  followUser: followMock,
  unfollowUser: unfollowMock,
}));

import { FollowButton } from './FollowButton';

function renderButton(props: Partial<React.ComponentProps<typeof FollowButton>> = {}) {
  return render(
    <MemoryRouter>
      <FollowButton username="alice" initialFollowing={false} {...props} />
    </MemoryRouter>
  );
}

function signIn() {
  useAuth.setState({
    user: { id: 'u1', username: 'bob', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
}

describe('FollowButton', () => {
  beforeEach(() => {
    followMock.mockReset();
    unfollowMock.mockReset();
    useToastsStore.setState({ toasts: [] });
  });

  it('a guest tap opens the sign-in popover and sends nothing', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Follow alice' }));
    expect(screen.getByText('Sign in to follow brewers')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(followMock).not.toHaveBeenCalled();
  });

  it('flips at once, then reports the server follower count', async () => {
    signIn();
    let resolve: (v: { following: boolean; followerCount: number }) => void = () => {};
    followMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const onChange = vi.fn();
    renderButton({ onChange });

    const btn = screen.getByRole('button', { name: 'Follow alice' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toContain('Following');
    expect(followMock).toHaveBeenCalledWith('alice');

    resolve({ following: true, followerCount: 7 });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true, 7));
  });

  it('unfollows when already following', async () => {
    signIn();
    unfollowMock.mockResolvedValue({ following: false, followerCount: 2 });
    const onChange = vi.fn();
    renderButton({ initialFollowing: true, onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Follow alice' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(false, 2));
    expect(unfollowMock).toHaveBeenCalledWith('alice');
    expect(screen.getByRole('button', { name: 'Follow alice' }).textContent).toContain('Follow');
  });

  it('reverts and toasts when the request fails', async () => {
    signIn();
    followMock.mockRejectedValue(new Error('You cannot follow yourself.'));
    const onChange = vi.fn();
    renderButton({ onChange });
    const btn = screen.getByRole('button', { name: 'Follow alice' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    expect(onChange).not.toHaveBeenCalled();
    expect(useToastsStore.getState().toasts[0]?.message).toBe('You cannot follow yourself.');
  });
});
