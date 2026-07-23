// @vitest-environment happy-dom
/**
 * Tests for the creation-time visibility fieldset on ImportDeckDialog's
 * single-deck (paste) path — the second consumer of usePublishOnCreate,
 * the same shared choke point DeckNewPage.test.tsx exercises. Uses the
 * 'standard' format (hasCommander: false) so a clean, empty import takes
 * the direct finalize branch with no commander-picker/review-step detour,
 * mirroring DeckNewPage.test.tsx's own format choice for the same reason.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../store/auth';
import { DisplayNameRequiredError, type PublishResult } from '../../lib/publications-client';
import type { DeckImportResponse } from '../../types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[] }) => unknown) => sel({ decks: [] }),
}));

const buildDeckFromResultMock = vi.fn(() => 'new-deck-id');
vi.mock('../../lib/build-deck-from-import', () => ({
  useBuildDeckFromImport: () => buildDeckFromResultMock,
}));

const importDeckTextMock = vi.fn<() => Promise<DeckImportResponse>>();
vi.mock('../../lib/api', () => ({
  importDeckText: () => importDeckTextMock(),
  importDeckFile: vi.fn(),
}));

vi.mock('../../lib/sync', () => ({
  isOnline: () => true,
  onSyncedChange: () => () => {},
}));

const updateProfileMock = vi.fn();
vi.mock('../../lib/auth-api', () => ({
  updateProfile: (patch: { displayName: string }) => updateProfileMock(patch),
}));

const publishDeckMock = vi.fn<() => Promise<PublishResult>>();
vi.mock('../../lib/publications-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/publications-client')>();
  return {
    ...actual,
    publishDeck: () => publishDeckMock(),
    publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  };
});

// Never rendered by the 'standard'-format paths under test (no commander
// step), but still imported transitively — stub it out rather than pull in
// its live useCollectionStore (IndexedDB) dependency, mirroring
// DeckNewPage.test.tsx's identical stub for the same reason.
vi.mock('./CommanderSearch', () => ({ CommanderSearch: () => null }));

import { ImportDeckDialog } from './ImportDeckDialog';

const CLEAN_RESULT: DeckImportResponse = {
  commander: null,
  companion: null,
  cards: [],
  unresolvedNames: [],
  fetchErrors: [],
  detectedFormat: '',
  cardCount: 0,
};

const PUB: PublishResult = {
  slug: 'my-deck',
  url: 'https://spellcontrol.com/d/my-deck',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 0,
  copyCount: 0,
  isFirstPublish: true,
};

function renderDialog() {
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter>
      <ImportDeckDialog onClose={onClose} />
    </MemoryRouter>
  );
  return { onClose, ...utils };
}

/** Standard has no commander step, so a clean paste import finalizes
 *  immediately — mirrors DeckNewPage.test.tsx's selectStandardFormat(). */
function selectStandardFormat() {
  fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
}

function pasteAndImport() {
  fireEvent.change(screen.getByPlaceholderText(/Lightning Strike/), {
    target: { value: '4 Lightning Bolt' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
}

beforeEach(() => {
  useAuth.setState({
    user: { id: 'u1', username: 'alice', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: {
      displayName: 'Alice',
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    },
  });
  navigateMock.mockClear();
  buildDeckFromResultMock.mockClear().mockReturnValue('new-deck-id');
  importDeckTextMock.mockReset().mockResolvedValue(CLEAN_RESULT);
  updateProfileMock.mockReset();
  publishDeckMock.mockReset().mockResolvedValue(PUB);
});
afterEach(() => localStorage.clear());

describe('ImportDeckDialog — creation-time visibility', () => {
  it('shows the Visibility fieldset on the single-deck (no staged files) path, defaulting to Private', () => {
    renderDialog();
    selectStandardFormat();
    expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect((screen.getByRole('radio', { name: 'Public' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('never calls publishDeck when Private (the default) is kept, and closes + navigates with no router state', async () => {
    const { onClose } = renderDialog();
    selectStandardFormat();
    pasteAndImport();

    await waitFor(() => expect(buildDeckFromResultMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(publishDeckMock).not.toHaveBeenCalled();
  });

  it('publishes after creating when Public is selected, closes, and navigates with justPublished: true', async () => {
    const { onClose } = renderDialog();
    selectStandardFormat();
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    pasteAndImport();

    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', {
        state: { justPublished: true },
      })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on display_name_required, swaps to the inline substep instead of navigating, then completes on save', async () => {
    publishDeckMock.mockRejectedValueOnce(new DisplayNameRequiredError());
    updateProfileMock.mockResolvedValue({
      displayName: 'Bob',
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    });
    const { onClose } = renderDialog();
    selectStandardFormat();
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    pasteAndImport();

    await screen.findByText('Set a display name');
    expect(navigateMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(updateProfileMock).toHaveBeenCalledWith({ displayName: 'Bob' }));
    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', {
        state: { justPublished: true },
      })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the Public radio for a guest, with a sign-in hint, and never blocks creation', () => {
    useAuth.setState({
      user: null,
      status: 'guest',
      error: null,
      autoLinkedAt: null,
      profile: null,
    });
    renderDialog();
    selectStandardFormat();

    const publicRadio = screen.getByRole('radio', { name: 'Public' }) as HTMLButtonElement;
    expect(publicRadio.disabled).toBe(true);
    expect(screen.getByText(/Sign in to publish/)).toBeTruthy();

    // The Import button itself must still be enabled for a guest — only
    // gated on having text to import, never on publish eligibility.
    fireEvent.change(screen.getByPlaceholderText(/Lightning Strike/), {
      target: { value: '4 Lightning Bolt' },
    });
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});
