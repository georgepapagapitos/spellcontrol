// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useToastsStore } from '../store/toasts';

const { bookmarkDeckMock, unbookmarkDeckMock } = vi.hoisted(() => ({
  bookmarkDeckMock: vi.fn(),
  unbookmarkDeckMock: vi.fn(),
}));
vi.mock('../lib/discover-client', () => ({
  bookmarkDeck: bookmarkDeckMock,
  unbookmarkDeck: unbookmarkDeckMock,
}));

import { BookmarkButton } from './BookmarkButton';

function renderButton(props: Partial<React.ComponentProps<typeof BookmarkButton>> = {}) {
  return render(
    <MemoryRouter>
      <BookmarkButton slug="test-slug" initialBookmarked={false} {...props} />
    </MemoryRouter>
  );
}

describe('BookmarkButton', () => {
  beforeEach(() => {
    bookmarkDeckMock.mockReset();
    unbookmarkDeckMock.mockReset();
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

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('Sign in to save decks')).toBeTruthy();
    expect(bookmarkDeckMock).not.toHaveBeenCalled();
  });

  it('an authed click optimistically flips aria-pressed, and rolls back + toasts on rejection', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    bookmarkDeckMock.mockRejectedValue(new Error('network down'));
    renderButton();

    const btn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    expect(useToastsStore.getState().toasts[0]?.message).toBe(
      "Couldn't save this deck — try again"
    );
  });

  it('calls onChange only after server confirmation, not optimistically', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    let resolveUnbookmark: () => void = () => {};
    unbookmarkDeckMock.mockReturnValue(
      new Promise<void>((resolve) => (resolveUnbookmark = resolve))
    );
    const onChange = vi.fn();
    renderButton({ initialBookmarked: true, onChange });

    const btn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();

    resolveUnbookmark();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(false));
  });

  it('disables itself while in flight, preventing a double-submit race', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    let resolveBookmark: () => void = () => {};
    bookmarkDeckMock.mockReturnValue(new Promise<void>((resolve) => (resolveBookmark = resolve)));
    renderButton();

    const btn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(bookmarkDeckMock).toHaveBeenCalledTimes(1);

    resolveBookmark();
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(false));
  });
});
