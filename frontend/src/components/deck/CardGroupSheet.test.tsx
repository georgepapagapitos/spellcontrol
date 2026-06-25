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
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />);
    // Sheet is portalled to document.body — query there.
    expect(document.body.querySelector('.card-group-grid')).toBeTruthy();
    expect(document.body.querySelectorAll('.card-group-card').length).toBe(2);
    // Only the 3-copy card gets a ×N badge.
    const badges = Array.from(document.body.querySelectorAll('.card-group-qty')).map(
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
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('List view'));
    // Sheet is portalled to document.body — query there.
    expect(document.body.querySelector('.card-group-list')).toBeTruthy();
    // List rows show the type line.
    expect(screen.getByText('Instant')).toBeTruthy();
    expect(localStorage.getItem('sc-cardgroup-layout')).toBe('list');
  });

  it('opens in the persisted layout on next mount', () => {
    localStorage.setItem('sc-cardgroup-layout', 'list');
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={vi.fn()} />);
    // Sheet is portalled to document.body — query there.
    expect(document.body.querySelector('.card-group-list')).toBeTruthy();
    expect(document.body.querySelector('.card-group-grid')).toBeNull();
  });

  // Every dismiss path goes through the symmetric exit: it flips `is-closing`
  // and fires onClose only when the `sheet-fall` animation ends (not synchronously).
  // Sheet is portalled to document.body — query there.
  const dismissEnd = () => {
    const sheet = document.body.querySelector('.card-group-sheet') as HTMLElement;
    expect(sheet.className).toContain('is-closing');
    fireEvent.animationEnd(sheet, { animationName: 'sheet-fall' });
  };

  it('dismisses via the ✕ button (waits for sheet-fall, then onClose)', () => {
    const onClose = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).not.toHaveBeenCalled(); // exit animation in flight
    dismissEnd();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses via the backdrop', () => {
    const onClose = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />);
    fireEvent.click(document.body.querySelector('.card-group-backdrop') as Element);
    dismissEnd();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses via Escape', () => {
    const onClose = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    dismissEnd();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a downward swipe when the body is at the top', () => {
    const onClose = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />);
    const sheet = document.body.querySelector('.card-group-sheet') as Element;
    // Body defaults to scrollTop 0 → the swipe gate is open.
    fireEvent.touchStart(sheet, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientX: 100, clientY: 320 }] });
    fireEvent.touchEnd(sheet, { changedTouches: [{ clientX: 100, clientY: 320 }] });
    dismissEnd();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT dismiss on a downward swipe while the body is scrolled (defers to native scroll)', () => {
    const onClose = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />);
    const sheet = document.body.querySelector('.card-group-sheet') as Element;
    const body = document.body.querySelector('.card-group-grid') as HTMLElement;
    body.scrollTop = 200; // gate closed — swipe should scroll, not dismiss
    fireEvent.touchStart(sheet, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientX: 100, clientY: 320 }] });
    fireEvent.touchEnd(sheet, { changedTouches: [{ clientX: 100, clientY: 320 }] });
    expect(sheet.className).not.toContain('is-closing');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when the sheet body itself is clicked', () => {
    const onClose = vi.fn();
    render(<CardGroupSheet title="Bucket" tally={tally} onPick={vi.fn()} onClose={onClose} />);
    fireEvent.click(document.body.querySelector('.card-group-sheet') as Element);
    expect(onClose).not.toHaveBeenCalled();
  });
});
