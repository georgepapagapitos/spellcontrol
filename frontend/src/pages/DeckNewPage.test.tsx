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
import type { Publication } from '../lib/publications-client';

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

const publishDeckMock = vi.fn<() => Promise<Publication>>();
vi.mock('../lib/publications-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/publications-client')>();
  return {
    ...actual,
    publishDeck: () => publishDeckMock(),
    publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  };
});

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

const PUB: Publication = {
  slug: 'my-new-deck',
  url: 'https://spellcontrol.com/d/my-new-deck',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 0,
  copyCount: 0,
};

describe('DeckNewPage — creation-time visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    authStatus = 'authed';
    createDeckMock.mockClear();
    publishDeckMock.mockReset().mockResolvedValue(PUB);
  });
  afterEach(() => localStorage.clear());

  it('defaults to Private, with Public selectable when authed', () => {
    renderPage();
    selectStandardFormat();
    expect(screen.getByRole('radio', { name: 'Private' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect((screen.getByRole('radio', { name: 'Public' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('disables the Public radio for a guest, with a sign-in hint, and never blocks creation', () => {
    authStatus = 'guest';
    renderPage();
    selectStandardFormat();

    const publicRadio = screen.getByRole('radio', { name: 'Public' }) as HTMLButtonElement;
    expect(publicRadio.disabled).toBe(true);
    expect(screen.getByText(/Sign in to publish/)).toBeTruthy();

    // The Create deck button itself must still be enabled for a guest.
    const createButton = screen.getByRole('button', { name: 'Create deck' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
  });

  it('publishes the deck after creation when Public is selected, and navigates to the editor', async () => {
    renderPage();
    selectStandardFormat();

    fireEvent.click(screen.getByRole('radio', { name: 'Public' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));

    await waitFor(() => expect(createDeckMock).toHaveBeenCalledTimes(1));
    expect(createDeckMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'standard', source: 'manual' })
    );
    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id'));
  });

  it('never calls publishDeck when Private (the default) is kept', async () => {
    renderPage();
    selectStandardFormat();
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));

    await waitFor(() => expect(createDeckMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id'));
    expect(publishDeckMock).not.toHaveBeenCalled();
  });
});
