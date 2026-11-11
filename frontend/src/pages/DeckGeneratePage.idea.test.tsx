// @vitest-environment happy-dom
/**
 * Starting from a deck idea (E1112, E1113): the idea lives in the finder, step 1; a pick under an idea
 * preselects the commander's theme of it and discloses the idea, and "Change idea" returns to the
 * finder.
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
  fetchCommanderThemes: (name: string) =>
    Promise.resolve(
      name === 'Lyra Dawnbringer'
        ? [{ name: 'Angels', slug: 'angels', count: 175, url: '/tags/angels' }]
        : []
    ),
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

const { finderProps } = vi.hoisted(() => ({
  finderProps: { current: null as null | Record<string, unknown> },
}));
vi.mock('../components/deck/CommanderSearch', () => ({
  CommanderSearch: (props: {
    ideaFinder?: {
      initialSlug?: string | null;
      onPickWithIdea: (card: unknown, idea: unknown, decks?: number) => Promise<void>;
      selectedNote?: string | null;
      selectedExtra?: React.ReactNode;
    };
  }) => {
    finderProps.current = props as unknown as Record<string, unknown>;
    const f = props.ideaFinder;
    return f ? (
      <>
        <button
          type="button"
          onClick={() =>
            void f.onPickWithIdea(
              { id: 'lyra', name: 'Lyra Dawnbringer', color_identity: ['W'], type_line: 'Angel' },
              {
                slug: 'angels',
                name: 'Angels',
                kind: 'typal',
                decks: 10806,
                commanders: 24,
                card: 'x',
              },
              175
            )
          }
        >
          finder with ideas ({f.initialSlug ?? 'none'}) {f.selectedNote}
        </button>
        {f.selectedExtra}
      </>
    ) : (
      <p>plain finder</p>
    );
  },
}));
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

  it('gives the Commander finder the idea layout, as step 1', () => {
    renderAt('?format=commander');
    expect(screen.getByRole('region', { name: 'Choose a commander' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /finder with ideas \(none\)/ })).toBeTruthy();
    expect(screen.queryByText('Building around an idea')).toBeNull();
    // The steps after it wait, muted, until a commander is chosen.
    const later = screen.getByRole('list', { name: 'Steps after you choose a commander' });
    expect(later.textContent).toContain('Theme');
    expect(later.textContent).toContain('Who can see it');
  });

  it('applies the idea in ?idea= to the finder', () => {
    renderAt('?format=commander&idea=angels');
    expect(screen.getByRole('button', { name: /finder with ideas \(angels\)/ })).toBeTruthy();
  });

  it('is a Commander door only: Pauper Commander keeps the plain finder and renumbers', () => {
    renderAt('?format=paupercommander');
    expect(screen.getByText('plain finder')).toBeTruthy();
    const later = screen.getByRole('list', { name: 'Steps after you choose a commander' });
    expect(later.textContent).not.toContain('Theme');
    expect(later.textContent).toContain('2How to build');
  });

  it('a commander picked under an idea gets that idea theme; the summary row carries the idea, no banner', async () => {
    renderAt('?format=commander');
    fireEvent.click(screen.getByRole('button', { name: /finder with ideas/ }));
    await waitFor(() =>
      expect(useDeckBuilderStore.getState().commander?.name).toBe('Lyra Dawnbringer')
    );
    // The finder is told what to say under the commander's name, and gets Change idea.
    expect(
      await screen.findByRole('button', { name: /From the Angels idea · 175 decks/ })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change idea' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Building around an idea' })).toBeNull();
    expect(screen.queryByText(/has no Angels theme/)).toBeNull();
    // No step placeholders once a commander is chosen.
    expect(screen.queryByRole('list', { name: 'Steps after you choose a commander' })).toBeNull();
  });

  it('a prefilled idea build shows the idea in the summary row and says nothing more when its theme was chosen', () => {
    renderAt('?format=commander', {
      prefill: {
        commander: giada,
        themes: [theme],
        ideaContext: {
          slug: 'angels',
          name: 'Angels',
          kind: 'typal',
          themeSelected: true,
          decks: 3982,
        },
      },
    });
    expect(screen.queryByRole('region', { name: 'Building around an idea' })).toBeNull();
    expect(screen.getByRole('button', { name: /From the Angels idea · 4k decks/ })).toBeTruthy();
    expect(useDeckBuilderStore.getState().commander?.name).toBe('Giada, Font of Hope');
    expect(screen.queryByText(/has no Angels theme/)).toBeNull();
  });

  it('says so, rather than staying silent, when the commander has no such theme', () => {
    renderAt('?format=commander', {
      prefill: {
        commander: giada,
        ideaContext: { slug: 'angels', name: 'Angels', kind: 'typal', themeSelected: false },
      },
    });
    expect(screen.getByText(/has no Angels theme/).textContent).toContain(
      'Giada has no Angels theme on EDHREC, so none is chosen.'
    );
  });

  it('Change idea drops the commander and keeps the finder, with the idea still applied', async () => {
    renderAt('?format=commander', {
      prefill: {
        commander: giada,
        ideaContext: { slug: 'angels', name: 'Angels', kind: 'typal', themeSelected: true },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change idea' }));
    await waitFor(() => expect(useDeckBuilderStore.getState().commander).toBeNull());
    expect(screen.queryByRole('button', { name: 'Change idea' })).toBeNull();
    expect(screen.getByRole('button', { name: /finder with ideas/ })).toBeTruthy();
  });
});
