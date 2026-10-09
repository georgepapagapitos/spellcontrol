// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '@/types/index';
import { CardSlot } from './CardSlot';

// axe `nested-interactive` failed the nightly journey on /collection/binders/:id:
// the "in a deck" link sat inside the pocket's role="button". The pocket and
// the deck link are siblings under the cell, so neither contains the other.
vi.mock('@/lib/collection/allocations', () => ({
  useAllocations: () =>
    new Map([
      [
        'c1',
        { ownerKind: 'deck', ownerId: 'deck_1', ownerName: 'Y’shtola', ownerColor: '#7755cc' },
      ],
    ]),
}));

const card = {
  copyId: 'c1',
  name: 'Sheoldred, the Apocalypse',
  rarity: 'mythic',
  typeLine: 'Legendary Creature',
} as unknown as EnrichedCard;

const INTERACTIVE = 'a[href], button, input, select, textarea, [tabindex], [role="button"]';

describe('an allocated binder pocket', () => {
  it('has no interactive element inside its role="button"', () => {
    render(
      <MemoryRouter>
        <CardSlot card={card} />
      </MemoryRouter>
    );
    const pocket = screen.getByRole('button', { name: /Open details for Sheoldred/ });
    expect(pocket.querySelectorAll(INTERACTIVE)).toHaveLength(0);
  });

  it('puts the deck link beside the pocket, in the same cell', () => {
    render(
      <MemoryRouter>
        <CardSlot card={card} />
      </MemoryRouter>
    );
    const pocket = screen.getByRole('button', { name: /Open details for Sheoldred/ });
    const link = screen.getByRole('link', { name: 'Open deck Y’shtola' });
    expect(pocket.contains(link)).toBe(false);
    expect(link.parentElement).toBe(pocket.parentElement);
    expect(link.parentElement!.classList.contains('slot-cell')).toBe(true);
    expect(link.getAttribute('href')).toBe('/decks/deck_1');
  });
});

describe('the page preview cell (same rule)', () => {
  it('keeps the deck link beside the pocket button, not inside it', async () => {
    const { BinderPagePreview } = await import('./BinderPagePreview');
    render(
      <MemoryRouter>
        <BinderPagePreview
          pages={[{ pageNum: 1, slots: [card, null, null, null] }]}
          pageLabels={['Page 1']}
          startPageIndex={0}
          pocketSize={4}
          binderName="Test"
          resolveCard={() => null}
          onClose={() => {}}
        />
      </MemoryRouter>
    );
    const pocket = screen.getByRole('button', { name: /^Open Sheoldred/ });
    const link = screen.getByRole('link', { name: 'Open deck Y’shtola' });
    expect(pocket.querySelectorAll(INTERACTIVE)).toHaveLength(0);
    expect(pocket.contains(link)).toBe(false);
    expect(link.parentElement).toBe(pocket.parentElement);
  });
});
