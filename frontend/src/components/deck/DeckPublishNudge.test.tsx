// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../store/auth';

const unpublishDeck = vi.fn((_id: string): Promise<void> => Promise.resolve());
vi.mock('../../lib/publications-client', () => ({
  unpublishDeck: (id: string) => unpublishDeck(id),
}));
const notifyDeckVisibilityChanged = vi.fn();
vi.mock('../../lib/use-deck-visibility', () => ({
  notifyDeckVisibilityChanged: (id: string) => notifyDeckVisibilityChanged(id),
}));

import { DeckPublishNudge } from './DeckPublishNudge';

beforeEach(() => {
  unpublishDeck.mockReset();
  unpublishDeck.mockResolvedValue(undefined);
  notifyDeckVisibilityChanged.mockReset();
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
});

describe('DeckPublishNudge', () => {
  it('says the new deck is public, with a one-tap way out', () => {
    render(<DeckPublishNudge deckId="d1" />);
    expect(screen.getByRole('status').textContent).toContain('This deck is public');
    expect(screen.getByRole('button', { name: 'Make private' })).toBeTruthy();
  });

  it('renders nothing for a guest, whose decks are never published by default', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    const { container } = render(<DeckPublishNudge deckId="d1" />);
    expect(container.firstChild).toBeNull();
  });

  it('dismiss hides it immediately', () => {
    const { container } = render(<DeckPublishNudge deckId="d1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.firstChild).toBeNull();
  });

  it('Make private unpublishes, tells the header chip, and retires the nudge', async () => {
    const { container } = render(<DeckPublishNudge deckId="d1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make private' }));
    });
    expect(unpublishDeck).toHaveBeenCalledWith('d1');
    expect(notifyDeckVisibilityChanged).toHaveBeenCalledWith('d1');
    expect(container.querySelector('.deck-publish-nudge')).toBeNull();
  });

  it('looks again once when the tap beats the default publish to the server', async () => {
    vi.useFakeTimers();
    try {
      unpublishDeck.mockRejectedValueOnce(new Error('This deck is not published.'));
      const { container } = render(<DeckPublishNudge deckId="d1" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Make private' }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(unpublishDeck).toHaveBeenCalledTimes(2);
      expect(container.querySelector('.deck-publish-nudge')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the nudge and re-enables the button when it fails twice', async () => {
    vi.useFakeTimers();
    try {
      unpublishDeck.mockRejectedValue(new Error('offline'));
      render(<DeckPublishNudge deckId="d1" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Make private' }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const button = screen.getByRole('button', { name: 'Make private' }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(notifyDeckVisibilityChanged).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
