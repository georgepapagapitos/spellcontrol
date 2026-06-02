// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardGroupSheet } from './CardGroupSheet';
import type { CardTally } from './useCardCarousel';
import type { ScryfallCard } from '@/deck-builder/types';

/** Minimal ScryfallCard fixture — only the fields the sheet reads. */
function card(name: string, typeLine: string): ScryfallCard {
  return {
    name,
    type_line: typeLine,
    image_uris: { small: `${name}-s.jpg`, normal: `${name}-n.jpg` },
  } as unknown as ScryfallCard;
}

const tally: CardTally[] = [
  { name: 'Sol Ring', count: 1, card: card('Sol Ring', 'Artifact') },
  { name: 'Lightning Bolt', count: 3, card: card('Lightning Bolt', 'Instant') },
];

describe('CardGroupSheet', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('renders the title and total card count (copies summed)', () => {
    render(
      <CardGroupSheet title="Red · 3 mana value" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Red · 3 mana value')).toBeTruthy();
    // 1 + 3 copies = 4 cards.
    expect(screen.getByText(/4 cards/)).toBeTruthy();
  });

  it('grid layout (default) shows each card with a copy badge for duplicates', () => {
    const { container } = render(
      <CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.querySelector('.card-group-grid')).toBeTruthy();
    expect(container.querySelectorAll('.card-group-card').length).toBe(2);
    // Only the 3-copy card gets a ×N badge.
    const badges = Array.from(container.querySelectorAll('.card-group-qty')).map(
      (b) => b.textContent
    );
    expect(badges).toEqual(['×3']);
  });

  it('hands a tapped card to onPick', () => {
    const onPick = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Inspect Sol Ring'));
    expect(onPick).toHaveBeenCalledWith(tally[0]);
  });

  it('toggles to list layout and persists the choice', () => {
    const { container } = render(
      <CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByLabelText('List view'));
    expect(container.querySelector('.card-group-list')).toBeTruthy();
    // List rows show the type line.
    expect(screen.getByText('Instant')).toBeTruthy();
    expect(localStorage.getItem('sc-cardgroup-layout')).toBe('list');
  });

  it('opens in the persisted layout on next mount', () => {
    localStorage.setItem('sc-cardgroup-layout', 'list');
    const { container } = render(
      <CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.querySelector('.card-group-list')).toBeTruthy();
    expect(container.querySelector('.card-group-grid')).toBeNull();
  });

  it('closes via the ✕ button, the backdrop, and Escape', () => {
    const onClose = vi.fn();
    const { container } = render(
      <CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.click(container.querySelector('.card-group-backdrop') as Element);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not close when the sheet body itself is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(container.querySelector('.card-group-sheet') as Element);
    expect(onClose).not.toHaveBeenCalled();
  });
});
