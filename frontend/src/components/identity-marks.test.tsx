// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeckBadge } from './DeckBadge';
import { BinderBadge } from './BinderBadge';
import type { AllocationInfo } from '@/lib/collection/allocations';

const deck = (id: string, name: string, color = '#c33'): AllocationInfo => ({
  ownerKind: 'deck',
  ownerId: id,
  ownerName: name,
  ownerColor: color,
  deckId: id,
  deckName: name,
  deckColor: color,
  cardName: 'Sol Ring',
});

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('identity marks on card art (placement="art")', () => {
  it('a single deck is a link on the plate, colored by the deck, with no row chip class', () => {
    inRouter(<DeckBadge allocations={[deck('d1', 'Krenko')]} placement="art" />);
    const link = screen.getByRole('link', { name: 'In deck: Krenko' });
    expect(link.className).toBe('art-badge identity-mark');
    expect(link.getAttribute('data-identity')).toBe('one');
    expect(link.style.getPropertyValue('--identity-color')).toBe('#c33');
  });

  it('several decks are one neutral glyph: no color and no count', () => {
    const { container } = inRouter(
      <DeckBadge allocations={[deck('d1', 'Krenko'), deck('d2', 'Ghalta')]} placement="art" />
    );
    const mark = screen.getByRole('img', { name: 'In 2 decks: Krenko, Ghalta' });
    expect(mark.getAttribute('data-identity')).toBe('many');
    expect(mark.getAttribute('style')).toBeNull();
    expect(container.querySelector('.card-list-deck-badge-count')).toBeNull();
  });

  it('a row keeps the tinted chip and its count', () => {
    const { container } = inRouter(
      <DeckBadge allocations={[deck('d1', 'Krenko'), deck('d2', 'Ghalta')]} />
    );
    expect(container.querySelector('.card-list-deck-badge--multi')).toBeTruthy();
    expect(container.querySelector('.card-list-deck-badge-count')?.textContent).toBe('2');
  });

  it('a single binder is a button on the plate, colored by the binder', () => {
    inRouter(
      <BinderBadge binders={[{ id: 'b1', name: 'Rares', color: '#39f' }]} placement="art" />
    );
    const btn = screen.getByRole('button', { name: 'In binder: Rares' });
    expect(btn.classList.contains('art-badge')).toBe(true);
    expect(btn.classList.contains('card-list-binder-badge')).toBe(false);
    expect(btn.getAttribute('data-identity')).toBe('one');
    expect(btn.style.getPropertyValue('--identity-color')).toBe('#39f');
  });

  it('several binders on art take the scrim text, not the themed text color', () => {
    const binders = [
      { id: 'b1', name: 'Rares', color: '#39f' },
      { id: 'b2', name: 'Trade', color: null },
    ];
    const { container } = inRouter(<BinderBadge binders={binders} placement="art" />);
    const mark = screen.getByRole('img', { name: 'In 2 binders: Rares, Trade' });
    expect(mark.getAttribute('data-identity')).toBe('many');
    expect(container.querySelector('.card-list-binder-badge--multi')).toBeNull();
    expect(container.querySelector('.card-list-deck-badge-count')).toBeNull();
  });
});
