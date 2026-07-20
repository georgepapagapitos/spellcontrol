// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useAuth } from '../store/auth';
import * as authApi from '../lib/auth-api';
import type { AvatarPatch, Profile } from '../lib/auth-api';
import { toast } from '../store/toasts';

// AvatarPickerSheet has its own dependency chain (collection store, live
// search, card-thumbs) covered by AvatarPickerSheet.test.tsx — stand it in
// with a single button that fires a fixed pick, so this file stays focused
// on ProfileEditor's own staging + Save behavior.
const MOCK_PICK: AvatarPatch = {
  cardId: 'card-1',
  cardName: 'Sol Ring',
  imageUrl: 'https://cards.scryfall.io/art_crop/card-1.jpg',
};
vi.mock('./AvatarPickerSheet', () => ({
  AvatarPickerSheet: ({ onPick }: { onPick: (avatar: AvatarPatch | null) => void }) => (
    <button type="button" data-testid="avatar-picker-mock-pick" onClick={() => onPick(MOCK_PICK)}>
      mock pick
    </button>
  ),
}));

import { ProfileEditor } from './ProfileEditor';

const PROFILE: Profile = {
  displayName: 'Alice',
  bio: 'Cube nut.',
  avatarCardId: null,
  avatarCardName: null,
  avatarImageUrl: null,
};

function asInput(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement {
  return el as HTMLInputElement | HTMLTextAreaElement;
}

function asButton(el: HTMLElement): HTMLButtonElement {
  return el as HTMLButtonElement;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: { ...PROFILE },
  });
});

describe('ProfileEditor', () => {
  it('renders fields disabled while profile is still loading', () => {
    useAuth.setState({ profile: null });
    render(<ProfileEditor />);
    expect(asInput(screen.getByLabelText('Display name')).disabled).toBe(true);
    expect(asInput(screen.getByLabelText('Bio')).disabled).toBe(true);
    expect(asButton(screen.getByRole('button', { name: 'Save' })).disabled).toBe(true);
  });

  it('disables Save with no edits', () => {
    render(<ProfileEditor />);
    expect(asButton(screen.getByRole('button', { name: 'Save' })).disabled).toBe(true);
  });

  it('edits + Save calls updateProfile with the right patch, including a staged avatar pick', async () => {
    const updateSpy = vi.spyOn(authApi, 'updateProfile').mockResolvedValue({
      displayName: 'Alice B.',
      bio: 'New bio.',
      avatarCardId: MOCK_PICK.cardId,
      avatarCardName: MOCK_PICK.cardName,
      avatarImageUrl: MOCK_PICK.imageUrl,
    });
    render(<ProfileEditor />);

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Alice B.' },
    });
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'New bio.' } });

    // Stage an avatar pick via the (mocked) picker sheet.
    fireEvent.click(screen.getByRole('button', { name: 'Choose avatar' }));
    fireEvent.click(screen.getByTestId('avatar-picker-mock-pick'));

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(asButton(saveButton).disabled).toBe(false);
    fireEvent.click(saveButton);

    await Promise.resolve();
    await Promise.resolve();

    expect(updateSpy).toHaveBeenCalledWith({
      displayName: 'Alice B.',
      bio: 'New bio.',
      avatar: MOCK_PICK,
    });
    // Success returns Save to disabled/not-dirty.
    expect(asButton(screen.getByRole('button', { name: 'Save' })).disabled).toBe(true);
  });

  it('a validation-error response surfaces via toast and preserves the typed value', async () => {
    vi.spyOn(authApi, 'updateProfile').mockRejectedValue(
      new Error('Display name must be 40 characters or fewer.')
    );
    const toastSpy = vi.spyOn(toast, 'show').mockReturnValue('toast-1');
    render(<ProfileEditor />);

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'A very long display name that is not actually too long' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // "Saving…" text reverting to "Save" only happens after the rejected
    // promise's catch/finally settle — poll for it rather than guessing a
    // fixed number of microtask ticks.
    const saveButton = await screen.findByRole('button', { name: 'Save' });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'error',
        message: 'Display name must be 40 characters or fewer.',
      })
    );
    // Typed value preserved, not reverted to the last-saved profile.
    expect(asInput(screen.getByLabelText('Display name')).value).toBe(
      'A very long display name that is not actually too long'
    );
    // Save re-enables (still dirty against the last-saved baseline).
    expect(asButton(saveButton).disabled).toBe(false);
  });
});
