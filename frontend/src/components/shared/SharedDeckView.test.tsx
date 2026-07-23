// @vitest-environment happy-dom
/**
 * SharedDeckView — regression coverage for the missing zero-result empty
 * state: before this fix, a search/filter that matched nothing (or a
 * genuinely cardless deck) rendered a blank gap between the toolbar and the
 * Copy/Export buttons, with no explanation and no way back. Doesn't
 * exhaustively cover the rest of the component (grouping/carousel/export),
 * matching the app's convention of not unit-testing every page/view branch.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import { SharedDeckView } from './SharedDeckView';

function card(name: string, typeLine = 'Creature — Human'): PublicDeckCard {
  return { card: { name, type_line: typeLine } };
}

function makeDeck(overrides: Partial<PublicDeck> = {}): PublicDeck {
  return {
    ownerUsername: 'alice',
    ownerDisplayName: null,
    id: 'deck-1',
    name: 'Atraxa Superfriends',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    cards: [],
    sideboard: [],
    color: '#4477aa',
    ...overrides,
  };
}

describe('SharedDeckView empty states', () => {
  it('shows the genuine-empty state and hides Copy/Export for a cardless deck', () => {
    render(
      <MemoryRouter>
        <SharedDeckView data={makeDeck()} />
      </MemoryRouter>
    );
    expect(screen.getByText('This deck has no cards yet.')).toBeTruthy();
    expect(screen.queryByText('Copy this deck')).toBeNull();
    expect(screen.queryByText('Export decklist')).toBeNull();
  });

  it('shows the filtered-to-zero state (not a blank gap) when a search matches nothing, and keeps Copy/Export', () => {
    render(
      <MemoryRouter>
        <SharedDeckView data={makeDeck({ cards: [card('Sol Ring', 'Artifact')] })} />
      </MemoryRouter>
    );
    // Real card renders before searching.
    expect(screen.getByText('Sol Ring')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search cards in this deck…'), {
      target: { value: 'zzz-no-such-card' },
    });

    expect(screen.getByText('No cards match your search or filters.')).toBeTruthy();
    expect(screen.queryByText('Sol Ring')).toBeNull();
    // The underlying deck still has cards, so Copy/Export stay available —
    // only a genuinely cardless deck hides them.
    expect(screen.getByText('Copy this deck')).toBeTruthy();
    expect(screen.getByText('Export decklist')).toBeTruthy();

    const clearBtn = screen.getByRole('button', { name: 'Reset search' });
    fireEvent.click(clearBtn);
    expect(screen.getByText('Sol Ring')).toBeTruthy();
  });
});
