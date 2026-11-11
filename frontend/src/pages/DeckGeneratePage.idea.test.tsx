// @vitest-environment happy-dom
/**
 * Starting from a deck idea (E1112): the idea section tops the generator until a commander is
 * chosen, a hand-off from the idea page preselects the theme and discloses the idea, and "Change
 * idea" puts the section back.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: [], createDeck: () => 'id' }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'authed' }),
}));
vi.mock('@/lib/sync', () => ({ isOnline: () => true, onSyncedChange: () => () => {} }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
  fetchPartnerCommanderData: () => Promise.resolve(null),
}));
const { getCardByName } = vi.hoisted(() => ({
  getCardByName: vi.fn(async (name: string) => ({
    id: name,
    name,
    color_identity: ['W'],
    type_line: 'Legendary Creature — Angel',
  })),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({ getCardByName }));

vi.mock('../components/deck/IdeaStart', () => ({
  IdeaStart: ({
    format,
    onPickCommander,
  }: {
    format: string;
    onPickCommander: (n: string) => Promise<void>;
  }) => (
    <button type="button" onClick={() => void onPickCommander('Lyra Dawnbringer')}>
      idea start ({format})
    </button>
  ),
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
import { useDeckBuilderStore } from '@/deck-builder/store';

const giada = {
  id: 'giada',
  name: 'Giada, Font of Hope',
  color_identity: ['W'],
  type_line: 'Legendary Creature — Angel',
};
const theme = { name: 'Angels', slug: 'angels', count: 3982, url: '/tags/angels' };

function renderAt(entry: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/decks/new/generate', search: entry, state }]}>
      <DeckGeneratePage />
    </MemoryRouter>
  );
}

describe('DeckGeneratePage ideas', () => {
  beforeEach(() => {
    localStorage.clear();
    useDeckBuilderStore.getState().reset();
    getCardByName.mockClear();
  });

  it('puts the idea section ahead of the commander finder, and retitles the finder', () => {
    renderAt('?format=commander');
    expect(screen.getByRole('button', { name: 'idea start (commander)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Or find a commander' })).toBeTruthy();
    expect(screen.queryByText('Building around an idea')).toBeNull();
  });

  it('is a Commander door only', () => {
    renderAt('?format=paupercommander');
    expect(screen.queryByRole('button', { name: /idea start/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Find a commander' })).toBeTruthy();
  });

  it('a commander picked from the idea search is the page commander', async () => {
    renderAt('?format=commander');
    fireEvent.click(screen.getByRole('button', { name: 'idea start (commander)' }));
    await waitFor(() =>
      expect(useDeckBuilderStore.getState().commander?.name).toBe('Lyra Dawnbringer')
    );
    expect(getCardByName).toHaveBeenCalledWith('Lyra Dawnbringer');
    // A chosen commander ends the idea section: the build form takes over.
    expect(screen.queryByRole('button', { name: /idea start/ })).toBeNull();
  });

  it('discloses the idea a build came from and where its theme went', () => {
    renderAt('?format=commander', {
      prefill: {
        commander: giada,
        themes: [theme],
        ideaContext: { slug: 'angels', name: 'Angels', kind: 'typal', themeSelected: true },
      },
    });
    const banner = screen.getByRole('region', { name: 'Building around an idea' });
    expect(banner.textContent).toContain('Angels');
    expect(banner.textContent).toContain('Its theme is chosen below.');
    expect(useDeckBuilderStore.getState().commander?.name).toBe('Giada, Font of Hope');
    expect(screen.queryByRole('button', { name: /idea start/ })).toBeNull();
  });

  it('says so, rather than staying silent, when the commander has no such theme', () => {
    renderAt('?format=commander', {
      prefill: {
        commander: giada,
        ideaContext: { slug: 'angels', name: 'Angels', kind: 'typal', themeSelected: false },
      },
    });
    expect(screen.getByRole('region', { name: 'Building around an idea' }).textContent).toContain(
      'Giada has no Angels theme on EDHREC, so none is chosen.'
    );
  });

  it('Change idea drops the commander and brings the idea section back', async () => {
    renderAt('?format=commander', {
      prefill: {
        commander: giada,
        ideaContext: { slug: 'angels', name: 'Angels', kind: 'typal', themeSelected: true },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change idea' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /idea start/ })).toBeTruthy());
    expect(useDeckBuilderStore.getState().commander).toBeNull();
    expect(screen.queryByText('Building around an idea')).toBeNull();
  });
});
