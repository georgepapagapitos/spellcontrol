// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/use-deck-visibility', () => ({
  useDeckVisibility: () => ({ visibility: 'private', refetch: vi.fn() }),
}));
vi.mock('../ShareDialog', () => ({ ShareDialog: () => null }));

import { DeckVisibilityChip } from './DeckVisibilityChip';

describe('DeckVisibilityChip', () => {
  it('says what it is for on its face, not only in the accessible name', () => {
    // The chip is the deck editor's only share door. A face that read just
    // "Private" told a first-time user the state, never that tapping it is
    // how you share the deck.
    render(
      <MemoryRouter>
        <DeckVisibilityChip deckId="d1" deckName="Teysa aristocrats" />
      </MemoryRouter>
    );
    const chip = screen.getByRole('button', { name: 'Sharing: Private — change visibility' });
    expect(chip.textContent?.replace(/\s+/g, ' ').trim()).toBe('Sharing: Private');
  });
});
