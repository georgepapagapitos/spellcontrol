// @vitest-environment happy-dom
/**
 * Tests for the creation-time visibility choice (visibility-obvious, E-decks):
 * a Private/Public fieldset on the manual-create path. Uses the 'standard'
 * format (hasCommander: false) so the plain "Create deck" button renders
 * immediately — no commander picker interaction required — keeping the
 * heavy generator UI mocked out and irrelevant to what's under test.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishResult } from '../lib/publications-client';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

const createDeckMock = vi.fn(() => 'new-deck-id');
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: typeof createDeckMock }) => unknown) =>
    sel({ decks: [], createDeck: createDeckMock }),
}));

let authStatus: 'unknown' | 'loading' | 'authed' | 'guest' = 'authed';
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

vi.mock('../lib/sync', () => ({
  isOnline: () => true,
  onSyncedChange: () => () => {},
}));

const publishDeckMock = vi.fn<() => Promise<PublishResult>>();
vi.mock('../lib/publications-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/publications-client')>();
  return {
    ...actual,
    publishDeck: () => publishDeckMock(),
    publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  };
});

const createShareMock = vi.fn();
vi.mock('../lib/share-client', () => ({
  createShare: (input: unknown) => createShareMock(input),
}));

// ── Heavy commander-generation UI, irrelevant to the non-commander 'standard'
// format path this suite exercises ─────────────────────────────────────────
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('../components/deck/CommanderSearch', () => ({ CommanderSearch: () => null }));
vi.mock('../components/deck/CommanderProfileCard', () => ({ CommanderProfileCard: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => null,
}));
vi.mock('../components/deck/ThemePicker', () => ({ ThemePicker: () => null }));
vi.mock('../components/deck/DeckCustomizer', () => ({ DeckCustomizer: () => null }));
vi.mock('../components/deck/GenerationModePicker', () => ({ GenerationModePicker: () => null }));
vi.mock('../components/deck/GenerationTakeover', () => ({ GenerationTakeover: () => null }));

import { DeckNewPage } from './DeckNewPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <DeckNewPage />
    </MemoryRouter>
  );
}

/** Switch to the 'standard' format so the plain "Create deck" button (no
 *  commander required) renders immediately. */
function selectStandardFormat() {
  fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
}

// The visibility ChoiceList radio's accessible name is its label plus its
// (always-visible) hint text glued together — match just the label, at the
// start.
const byLabel = (name: string) => new RegExp(`^${name}`);
const visibilityRadio = (name: string) =>
  screen.getByRole('radio', { name: byLabel(name) }) as HTMLInputElement;

const PUB: PublishResult = {
  slug: 'my-new-deck',
  url: 'https://spellcontrol.com/d/my-new-deck',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 0,
  copyCount: 0,
  isFirstPublish: true,
};

describe('DeckNewPage — creation-time visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    authStatus = 'authed';
    createDeckMock.mockClear();
    publishDeckMock.mockReset().mockResolvedValue(PUB);
    createShareMock.mockReset().mockResolvedValue({ token: 'tok', audience: 'friends' });
  });
  afterEach(() => localStorage.clear());

  it('defaults to Public when authed (board T136)', () => {
    renderPage();
    selectStandardFormat();
    // Native <input type="radio"> now — `checked`/`disabled`, not aria-*.
    expect(visibilityRadio('Public').checked).toBe(true);
    expect(visibilityRadio('Private').disabled).toBe(false);
  });

  it('disables Public and Friends for a guest, with a sign-in reason as the hint, and never blocks creation', () => {
    authStatus = 'guest';
    renderPage();
    selectStandardFormat();

    expect(visibilityRadio('Public').disabled).toBe(true);
    expect(visibilityRadio('Friends').disabled).toBe(true);
    expect(screen.getAllByText('Sign in to publish.')).toHaveLength(2);

    // The Create deck button itself must still be enabled for a guest.
    const createButton = screen.getByRole('button', { name: 'Create deck' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
  });

  it('publishes the deck after creation when Public is selected, navigates to the editor, and flags the first-publish seal', async () => {
    renderPage();
    selectStandardFormat();

    fireEvent.click(visibilityRadio('Public'));
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));

    await waitFor(() => expect(createDeckMock).toHaveBeenCalledTimes(1));
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'standard', source: 'manual', initialVisibility: 'public' })
    );
    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', {
        state: { justPublished: true },
      })
    );
  });

  it('threads justPublished: false through when the server reports a republish, not a first publish', async () => {
    publishDeckMock.mockResolvedValue({ ...PUB, isFirstPublish: false });
    renderPage();
    selectStandardFormat();

    fireEvent.click(visibilityRadio('Public'));
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', {
        state: { justPublished: false },
      })
    );
  });

  it('creates the deck as private, and never publishes it, when Private is picked', async () => {
    // The stamp is what keeps it private: the server would otherwise publish
    // a new deck by default on its first sync.
    renderPage();
    selectStandardFormat();
    fireEvent.click(visibilityRadio('Private'));
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));

    await waitFor(() => expect(createDeckMock).toHaveBeenCalledTimes(1));
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialVisibility: 'private' })
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id'));
    expect(publishDeckMock).not.toHaveBeenCalled();
  });

  it('creates the deck as friends-visible via the same share ShareDialog mints, in Public/Friends/Private order', async () => {
    renderPage();
    selectStandardFormat();

    const radios = screen.getAllByRole('radio', { name: /^(Public|Friends|Private)/ });
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['public', 'friends', 'private']);

    fireEvent.click(visibilityRadio('Friends'));
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));

    await waitFor(() => expect(createDeckMock).toHaveBeenCalledTimes(1));
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({ initialVisibility: 'friends' })
    );
    await waitFor(() =>
      expect(createShareMock).toHaveBeenCalledWith({
        kind: 'deck',
        resourceId: 'new-deck-id',
        audience: 'friends',
      })
    );
    expect(publishDeckMock).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', undefined));
  });
});
