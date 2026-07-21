// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';

const { likeDeckMock, unlikeDeckMock } = vi.hoisted(() => ({
  likeDeckMock: vi.fn(),
  unlikeDeckMock: vi.fn(),
}));
vi.mock('../lib/discover-client', () => ({
  likeDeck: likeDeckMock,
  unlikeDeck: unlikeDeckMock,
}));

import { LikeButton } from './LikeButton';

function renderButton(props: Partial<React.ComponentProps<typeof LikeButton>> = {}) {
  return render(
    <MemoryRouter>
      <LikeButton slug="test-slug" initialLiked={false} initialCount={5} {...props} />
    </MemoryRouter>
  );
}

describe('LikeButton', () => {
  beforeEach(() => {
    likeDeckMock.mockReset();
    unlikeDeckMock.mockReset();
    useToastsStore.setState({ toasts: [] });
  });

  it('a guest click opens GuestActionPopover and fires no network request', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('Sign in to like decks')).toBeTruthy();
    expect(likeDeckMock).not.toHaveBeenCalled();
  });

  it('an authed click optimistically flips aria-pressed before the request resolves, then reconciles the count', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    let resolveLike: (v: { likeCount: number }) => void = () => {};
    likeDeckMock.mockReturnValue(new Promise((resolve) => (resolveLike = resolve)));
    renderButton();

    const btn = screen.getByRole('button', { name: 'Like' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);

    // Optimistic: flips immediately, before the mocked request resolves.
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(likeDeckMock).toHaveBeenCalledWith('test-slug');

    resolveLike({ likeCount: 6 });
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(false));
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('rolls back and toasts on a rejected request', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    likeDeckMock.mockRejectedValue(new Error('network down'));
    renderButton();

    const btn = screen.getByRole('button', { name: 'Like' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    expect(useToastsStore.getState().toasts[0]?.message).toBe(
      "Couldn't like this deck — try again"
    );
  });

  it('disables itself while in flight, preventing a double-submit race', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    let resolveLike: (v: { likeCount: number }) => void = () => {};
    likeDeckMock.mockReturnValue(new Promise((resolve) => (resolveLike = resolve)));
    renderButton();

    const btn = screen.getByRole('button', { name: 'Like' });
    fireEvent.click(btn);
    fireEvent.click(btn); // second tap while the first is still in flight
    expect(likeDeckMock).toHaveBeenCalledTimes(1);

    resolveLike({ likeCount: 6 });
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(false));
  });
});
