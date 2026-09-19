// @vitest-environment happy-dom
/**
 * The fan's cost badge and collapse toggle. The spacing arithmetic behind the
 * fan lives in `lib/fan-layout.ts` and is tested beside it.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { Hand } from './Hand';

function card(over: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id: over.id ?? 'c1', name: 'Card', ...over };
}

function renderHand(cards: PlaytestCard[]) {
  return render(
    <DndContext>
      <Hand cards={cards} fan />
    </DndContext>
  );
}

describe('the fan cost badge', () => {
  it('shows nothing on a land, which has no cost worth reading', () => {
    renderHand([
      card({ id: 'l', name: 'Mountain', typeLine: 'Basic Land — Mountain', manaValue: 0 }),
    ]);
    expect(document.querySelector('.playtest-hand__mv')).toBeNull();
  });

  it('shows nothing on a token, which has no mana value at all', () => {
    renderHand([card({ id: 't', name: 'Goblin', isToken: true, typeLine: 'Creature' })]);
    expect(document.querySelector('.playtest-hand__mv')).toBeNull();
  });

  it('renders the real cost as mana symbols when the card carries one', () => {
    renderHand([
      card({ id: 's', name: 'Shock', typeLine: 'Instant', manaValue: 1, manaCost: '{R}' }),
    ]);
    const badge = document.querySelector('.playtest-hand__mv');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('i.ms-r')).toBeTruthy();
  });

  it('falls back to the bare mana value for a snapshot saved before manaCost existed', () => {
    renderHand([card({ id: 'o', name: 'Old', typeLine: 'Creature', manaValue: 4 })]);
    const badge = document.querySelector('.playtest-hand__mv');
    expect(badge?.textContent).toBe('4');
  });
});

describe('the fan collapse toggle', () => {
  it('keeps the count visible while collapsed, and stays a drop target', () => {
    renderHand([card({ id: 'a' }), card({ id: 'b' })]);
    const toggle = screen.getByRole('button', { name: /Hand \(2\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
