// @vitest-environment happy-dom
/**
 * The owner's deck index wears the same color-identity strip as the deck's
 * Discover and profile tiles, in grid view. It used to show only on those
 * two, so the same Pauper deck had a strip on Discover and none under My
 * Decks. deck-validation is NOT stubbed here: the colors come off the cards
 * through the real `effectiveDeckColors`, most-used first.
 */
import 'fake-indexeddb/auto';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockDecks: unknown[] = [];
vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: mockDecks, deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: 'guest' }),
}));
vi.mock('../components/deck/ImportDeckDialog', () => ({ ImportDeckDialog: () => null }));
vi.mock('@/components/import/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('@/components/share/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('@/components/overlays/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/decks/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
vi.mock('../deck-builder/services/scryfall/client', () => ({ getCardPrice: () => null }));

import { DecksIndexPage } from './DecksIndexPage';

const slot = (name: string, color_identity: string[]) => ({
  slotId: name,
  card: { id: name, name, color_identity, type_line: 'Creature', legalities: {} },
  allocatedCopyId: null,
});

function deck(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    commander: null,
    partnerCommander: null,
    cards: [],
    sideboard: [],
    color: '#888',
    format: 'pauper',
    source: 'manual',
    updatedAt: 0,
    ...overrides,
  };
}

function segments(tileName: string): string[] {
  const tile = [...document.querySelectorAll('li.decks-index-card')].find((li) =>
    li.textContent?.includes(tileName)
  );
  const bar = tile?.querySelector('.color-identity-bar');
  if (!bar) return [];
  expect(bar.getAttribute('aria-hidden')).toBe('true');
  return [...bar.children].map((s) => s.className.replace(/.*--/, ''));
}

describe('DecksIndexPage: color-identity strip', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDecks = [
      deck('elves', 'Mono Green Elves', {
        cards: [slot('Llanowar Elves', ['G']), slot('Llanowar Elves', ['G'])],
        sideboard: [slot('Duress', ['B'])],
      }),
      deck('artifacts', 'Colorless Artifacts', { cards: [slot('Ornithopter', [])] }),
    ];
  });
  afterEach(() => localStorage.clear());

  it('shows a Pauper deck its card colors in grid view, most-used first', () => {
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    expect(segments('Mono Green Elves')).toEqual(['g', 'b']);
  });

  it('gives a colorless deck one neutral segment, never an empty bar', () => {
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    expect(segments('Colorless Artifacts')).toEqual(['c']);
  });

  it.each(['list', 'compact'])('leaves the strip off in %s view', (view) => {
    localStorage.setItem('mtg-decks-view-mode', view);
    render(
      <MemoryRouter>
        <DecksIndexPage />
      </MemoryRouter>
    );
    expect(document.querySelector('.color-identity-bar')).toBeNull();
  });
});
