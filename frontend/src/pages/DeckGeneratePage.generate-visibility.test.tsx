// @vitest-environment happy-dom
/**
 * The visibility choice sits above BOTH "Generate deck" and "Start blank",
 * but only the latter ever applied it — a generated deck was created
 * private no matter what the user picked, with no error and no toast. These
 * tests pin the `onCreated` hand-off that fixes it.
 *
 * `useDeckGeneration` is faked so the hand-off itself is what's under test,
 * not the EDHREC/generator stack behind it: the fake captures the options the
 * page passes in, and the test invokes `onCreated` the way a completed build
 * would. Sibling suite DeckGeneratePage.start-blank.test.tsx covers the
 * "Start blank" path against the real hook.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishResult } from '../lib/publications-client';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'new-deck-id' }),
}));

vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'authed' }),
}));

vi.mock('../lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));

const publishDeckMock = vi.fn<() => Promise<PublishResult>>();
vi.mock('../lib/publications-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/publications-client')>();
  return {
    ...actual,
    publishDeck: () => publishDeckMock(),
    publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  };
});

type OnCreated = (
  deckId: string,
  destination: string,
  navState?: Record<string, unknown>
) => boolean | Promise<boolean>;

let capturedOnCreated: OnCreated | undefined;
let capturedVisibility: string | undefined;
vi.mock('../lib/use-deck-generation', () => ({
  useDeckGeneration: (opts: { onCreated?: OnCreated; initialVisibility?: string }) => {
    capturedOnCreated = opts.onCreated;
    capturedVisibility = opts.initialVisibility;
    return {
      // A picked commander: the visibility choice and the build bar only
      // render once there is one to build around.
      commander: {
        id: 'krenko',
        name: 'Krenko, Mob Boss',
        color_identity: ['R'],
        type_line: 'Legendary Creature — Goblin Warrior',
        legalities: { commander: 'legal' },
      },
      partnerCommander: null,
      setPartnerCommander: () => {},
      colorIdentity: [],
      customization: {
        generationMode: 'edhrec',
        artThemeTag: '',
        historicalYear: 2000,
        targetBracket: 'all',
      },
      updateCustomization: () => {},
      commanderProfile: null,
      selectedThemes: [],
      selectedThemeSlugs: new Set<string>(),
      toggleTheme: () => {},
      selectCommander: () => {},
      build: () => {},
      isBuilding: false,
      progress: null,
      error: null,
      progressRef: { current: null },
    };
  },
}));

vi.mock('../components/deck/CommanderSearch', () => ({ CommanderSearch: () => null }));
vi.mock('../components/deck/CommanderProfileCard', () => ({ CommanderProfileCard: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => null,
}));
vi.mock('../components/deck/ThemePicker', () => ({ ThemePicker: () => null }));
vi.mock('../components/deck/DeckCustomizer', () => ({ DeckCustomizer: () => null }));
vi.mock('../components/deck/GenerationModePicker', () => ({ GenerationModePicker: () => null }));
vi.mock('../components/deck/GenerationTakeover', () => ({ GenerationTakeover: () => null }));

import { DeckGeneratePage } from './DeckGeneratePage';

const PUB: PublishResult = {
  slug: 'generated-deck',
  url: 'https://spellcontrol.com/d/generated-deck',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 0,
  copyCount: 0,
  isFirstPublish: true,
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/decks/new/generate']}>
      <DeckGeneratePage />
    </MemoryRouter>
  );
}

// The visibility ChoiceList radio's accessible name is its label plus its
// (always-visible) hint text glued together — match just the label, at the
// start.
const byLabel = (name: string) => new RegExp(`^${name}`);
const visibilityRadio = (name: string) => screen.getByRole('radio', { name: byLabel(name) });

describe('DeckGeneratePage — generated decks obey the visibility choice', () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockClear();
    capturedOnCreated = undefined;
    publishDeckMock.mockReset().mockResolvedValue(PUB);
  });

  it('hands the generation hook a publish callback at all', () => {
    renderPage();
    expect(typeof capturedOnCreated).toBe('function');
  });

  it('publishes the generated deck and takes over navigation when Public is selected', async () => {
    renderPage();
    fireEvent.click(visibilityRadio('Public'));

    const tookOverNavigation = await capturedOnCreated!('gen-id', '/decks/gen-id', {
      justGenerated: true,
    });

    expect(tookOverNavigation).toBe(true);
    await waitFor(() => expect(publishDeckMock).toHaveBeenCalledTimes(1));
    // Both flags survive: the build report still auto-opens AND the
    // first-publish seal still fires. Neither may swallow the other.
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/decks/gen-id', {
        state: { justGenerated: true, justPublished: true },
      })
    );
  });

  it('preserves a regenerate compare-diff landing rather than dumping the user on the editor', async () => {
    renderPage();
    fireEvent.click(visibilityRadio('Public'));

    await capturedOnCreated!('gen-id', '/decks/compare?a=src&b=gen-id', undefined);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/decks/compare?a=src&b=gen-id', {
        state: { justPublished: true },
      })
    );
  });

  it('creates the generated deck as Public by default (board T136)', () => {
    renderPage();
    expect(capturedVisibility).toBe('public');
  });

  it('leaves navigation to the generation hook when Private is picked, and stamps it private', async () => {
    // The stamp is what keeps it private: the server would otherwise publish
    // a new deck by default on its first sync.
    renderPage();
    fireEvent.click(visibilityRadio('Private'));
    expect(capturedVisibility).toBe('private');

    const tookOverNavigation = await capturedOnCreated!('gen-id', '/decks/gen-id', {
      justGenerated: true,
    });

    expect(tookOverNavigation).toBe(false);
    expect(publishDeckMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('echoes the pick in the build bar, which carries no second visibility control', () => {
    renderPage();
    const bar = screen.getByRole('group', { name: 'Build this deck' });
    expect(bar.textContent).toContain('Public');
    fireEvent.click(visibilityRadio('Private'));
    expect(bar.textContent).toContain('Private');
    expect(bar.querySelector('input[type="radio"]')).toBeNull();
  });
});
