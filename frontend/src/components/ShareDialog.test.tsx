// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../store/auth';
import type { ShareKind, ShareRow } from '../lib/shared-types';

const {
  createShareMock,
  listSharesMock,
  revokeShareMock,
  getPublicationMock,
  publishDeckMock,
  unpublishDeckMock,
  listFriendsMock,
} = vi.hoisted(() => ({
  createShareMock: vi.fn(),
  listSharesMock: vi.fn(),
  revokeShareMock: vi.fn(),
  getPublicationMock: vi.fn(),
  publishDeckMock: vi.fn(),
  unpublishDeckMock: vi.fn(),
  listFriendsMock: vi.fn(),
}));

vi.mock('../lib/share-client', () => ({
  createShare: (input: unknown) => createShareMock(input),
  listShares: () => listSharesMock(),
  revokeShare: (token: string) => revokeShareMock(token),
  shareUrl: (token: string) => `https://spellcontrol.com/s/${token}`,
}));
vi.mock('../lib/publications-client', () => ({
  getPublication: (deckId: string) => getPublicationMock(deckId),
  publishDeck: (deckId: string) => publishDeckMock(deckId),
  unpublishDeck: (deckId: string) => unpublishDeckMock(deckId),
  publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
}));
vi.mock('../lib/friends-client', () => ({ listFriends: () => listFriendsMock() }));

const fireSealMock = vi.fn();
vi.mock('./shared/SealMoment', () => ({
  useSealMoment: () => ({ fire: fireSealMock, moment: null }),
}));

import { ShareDialog } from './ShareDialog';

function renderDialog(kind: ShareKind = 'deck', resourceId: string | undefined = 'd1') {
  return render(
    <MemoryRouter>
      <ShareDialog
        kind={kind}
        resourceId={resourceId}
        resourceLabel="Test Deck"
        colorIdentity={['R']}
        onClose={() => {}}
      />
    </MemoryRouter>
  );
}

function row(audience: ShareRow['audience'], over: Partial<ShareRow> = {}): ShareRow {
  return {
    token: `tok-${audience}`,
    userId: 'u1',
    kind: 'deck',
    resourceId: 'd1',
    audience,
    addresseeId: null,
    createdAt: 1,
    revokedAt: null,
    ...over,
  };
}

const LIVE = {
  slug: 'test-deck',
  url: 'https://spellcontrol.com/d/test-deck',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 3,
  copyCount: 1,
};

// The ChoiceList radio's accessible name is its label plus its (always-
// visible) hint text glued together — match just the label, at the start.
const byLabel = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const radio = (name: string) =>
  screen.getByRole('radio', { name: byLabel(name) }) as HTMLInputElement;
const loaded = () => screen.findByRole('radio', { name: byLabel('Private') });

beforeEach(() => {
  vi.clearAllMocks();
  getPublicationMock.mockResolvedValue(null);
  listSharesMock.mockResolvedValue([]);
  revokeShareMock.mockResolvedValue(undefined);
  unpublishDeckMock.mockResolvedValue(undefined);
  createShareMock.mockImplementation((input: { audience: ShareRow['audience'] }) =>
    Promise.resolve(row(input.audience))
  );
  publishDeckMock.mockResolvedValue({ ...LIVE, isFirstPublish: true });
  listFriendsMock.mockResolvedValue([{ id: 'f1', username: 'bob' }]);
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
});

describe('ShareDialog — a deck', () => {
  it('offers exactly Public, Friends and Private: no link to manage', async () => {
    renderDialog();
    await loaded();
    expect(
      screen
        .getAllByRole('radio')
        .map((r) => r.closest('label')!.querySelector('.choice-option-label')!.textContent)
    ).toEqual(['Public', 'Friends', 'Private']);
  });

  it('opens on the real state and mints nothing just by opening', async () => {
    getPublicationMock.mockResolvedValue(LIVE);
    renderDialog();
    await waitFor(() => expect(radio('Public').checked).toBe(true));
    expect(createShareMock).not.toHaveBeenCalled();
    expect(publishDeckMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('https://spellcontrol.com/d/test-deck')).toBeTruthy();
    expect(screen.getByText(/3 views · 1 copy/)).toBeTruthy();
  });

  it('Public publishes at once, with no confirm step, and fires the first-publish seal', async () => {
    renderDialog();
    await loaded();
    fireEvent.click(radio('Public'));
    await waitFor(() => expect(radio('Public').checked).toBe(true));
    expect(publishDeckMock).toHaveBeenCalledWith('d1');
    expect(fireSealMock).toHaveBeenCalledWith(['R']);
    expect(screen.getByDisplayValue('https://spellcontrol.com/d/test-deck')).toBeTruthy();
  });

  it('never fires the seal on a republish', async () => {
    publishDeckMock.mockResolvedValue({ ...LIVE, isFirstPublish: false });
    renderDialog();
    await loaded();
    fireEvent.click(radio('Public'));
    await waitFor(() => expect(radio('Public').checked).toBe(true));
    expect(fireSealMock).not.toHaveBeenCalled();
  });

  it('Friends mints a friends share and stops showing the public link', async () => {
    getPublicationMock.mockResolvedValue(LIVE);
    renderDialog();
    await waitFor(() => expect(radio('Public').checked).toBe(true));
    fireEvent.click(radio('Friends'));
    await waitFor(() => expect(radio('Friends').checked).toBe(true));
    expect(createShareMock).toHaveBeenCalledWith({
      kind: 'deck',
      resourceId: 'd1',
      audience: 'friends',
    });
    expect(screen.getByDisplayValue('https://spellcontrol.com/s/tok-friends')).toBeTruthy();
    expect(screen.queryByDisplayValue('https://spellcontrol.com/d/test-deck')).toBeNull();
  });

  it('Private revokes every live row and unpublishes, and only then reads as private', async () => {
    getPublicationMock.mockResolvedValue(LIVE);
    listSharesMock.mockResolvedValue([row('direct', { token: 'tok-d', addresseeId: 'f1' })]);
    let finishRevoke: () => void = () => {};
    revokeShareMock.mockReturnValue(new Promise<void>((r) => (finishRevoke = r)));
    renderDialog();
    await waitFor(() => expect(radio('Public').checked).toBe(true));

    fireEvent.click(radio('Private'));
    await waitFor(() => expect(revokeShareMock).toHaveBeenCalledWith('tok-d'));
    expect(radio('Public').checked).toBe(true);

    finishRevoke();
    await waitFor(() => expect(radio('Private').checked).toBe(true));
    expect(unpublishDeckMock).toHaveBeenCalledWith('d1');
    expect(screen.queryByRole('textbox', { name: 'Link' })).toBeNull();
  });

  it('a deck on the retired link rung shows no choice picked until the owner picks one', async () => {
    listSharesMock.mockResolvedValue([row('link')]);
    renderDialog();
    await loaded();
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(screen.getByText(/older link that anyone can open/)).toBeTruthy();

    fireEvent.click(radio('Friends'));
    await waitFor(() => expect(radio('Friends').checked).toBe(true));
  });

  it('a failed change says so and leaves the previous choice selected', async () => {
    publishDeckMock.mockRejectedValue(new Error('A moderator took this deck down.'));
    renderDialog();
    await loaded();
    fireEvent.click(radio('Public'));
    expect((await screen.findByRole('alert')).textContent).toContain('moderator');
    expect(radio('Private').checked).toBe(true);
  });
});

describe('ShareDialog — other kinds', () => {
  it('a binder keeps "Anyone with the link" until binders get a public page', async () => {
    renderDialog('binder', 'b1');
    await loaded();
    expect(
      screen
        .getAllByRole('radio')
        .map((r) => r.closest('label')!.querySelector('.choice-option-label')!.textContent)
    ).toEqual(['Anyone with the link', 'Friends', 'Private']);
    fireEvent.click(radio('Anyone with the link'));
    await waitFor(() => expect(radio('Anyone with the link').checked).toBe(true));
    expect(createShareMock).toHaveBeenCalledWith({
      kind: 'binder',
      resourceId: 'b1',
      audience: 'link',
    });
    expect(getPublicationMock).not.toHaveBeenCalled();
  });
});

describe('ShareDialog — send to a friend', () => {
  it('sends a direct share without changing who can see it', async () => {
    renderDialog();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Send to a friend' }));
    const trigger = await screen.findByRole('button', { name: 'Choose a friend' });
    // A menu button + listbox, not a native <select> — the kit control.
    expect(trigger.tagName).toBe('BUTTON');
    expect(document.querySelector('select')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'bob' }));
    expect((await screen.findByText(/Sent to @bob/)).textContent).toContain('inbox');
    expect(createShareMock).toHaveBeenCalledWith({
      kind: 'deck',
      resourceId: 'd1',
      audience: 'direct',
      addresseeId: 'f1',
    });
    expect(radio('Private').checked).toBe(true);
  });

  it('gets a search box once the friend list is long enough that scrolling stops working', async () => {
    listFriendsMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, username: `friend${i}` }))
    );
    renderDialog();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Send to a friend' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a friend' }));
    expect(screen.getByPlaceholderText('Search friends…')).toBeTruthy();
  });
});

describe('ShareDialog — a guest', () => {
  it('asks them to sign in and reads nothing', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderDialog();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(listSharesMock).not.toHaveBeenCalled();
  });
});
