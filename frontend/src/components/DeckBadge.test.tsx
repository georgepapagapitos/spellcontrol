// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeckBadge } from './DeckBadge';
import { makeDeckAllocationInfo } from '../lib/allocations';

function renderBadge(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('DeckBadge listed cubes (E503)', () => {
  it('renders nothing with no allocations and no listings', () => {
    const { container } = renderBadge(<DeckBadge allocations={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('one listing links to the cube and says the cube only lists it', () => {
    renderBadge(<DeckBadge allocations={[]} listedIn={[{ cubeId: 'c1', cubeName: 'Shelf' }]} />);
    const link = screen.getByRole('link', { name: 'Listed in cube: Shelf' });
    expect(link.getAttribute('href')).toBe('/decks/cube/c1');
    expect(link.className).toContain('card-list-deck-badge--listed');
  });

  it('several listings are one unlinked badge naming every cube', () => {
    renderBadge(
      <DeckBadge
        allocations={[]}
        listedIn={[
          { cubeId: 'c1', cubeName: 'Shelf' },
          { cubeId: 'c2', cubeName: 'Pauper' },
        ]}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByLabelText('Listed in 2 cubes: Shelf, Pauper')).toBeTruthy();
  });

  it('sits beside a deck badge rather than replacing it', () => {
    renderBadge(
      <DeckBadge
        allocations={[makeDeckAllocationInfo('d1', 'Atraxa', '', 'Sol Ring')]}
        listedIn={[{ cubeId: 'c1', cubeName: 'Shelf' }]}
      />
    );
    expect(screen.getByRole('link', { name: 'In deck: Atraxa' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Listed in cube: Shelf' })).toBeTruthy();
  });

  it('on art, a listing is the hollow identity mark, never the filled disc', () => {
    // A filled violet disc is a physical cube holding a copy; a listing holds
    // none, so it must not look the same on a grid tile.
    renderBadge(
      <DeckBadge
        allocations={[
          {
            ownerKind: 'cube',
            ownerId: 'p1',
            ownerName: 'Physical',
            ownerColor: 'var(--cube-color)',
            deckId: '',
            deckName: 'Physical',
            deckColor: 'var(--cube-color)',
            cardName: 'Sol Ring',
          },
        ]}
        listedIn={[
          { cubeId: 'c1', cubeName: 'Shelf' },
          { cubeId: 'c2', cubeName: 'Pauper' },
        ]}
        placement="art"
      />
    );
    const held = screen.getByRole('link', { name: 'In cube: Physical' });
    expect(held.getAttribute('data-identity')).toBe('one');
    const listed = screen.getByLabelText('Listed in 2 cubes: Shelf, Pauper');
    expect(listed.getAttribute('data-identity')).toBe('listed');
    expect(listed.className).not.toContain('card-list-deck-badge');
  });
});
