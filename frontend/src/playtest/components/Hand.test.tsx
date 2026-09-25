// @vitest-environment happy-dom
/**
 * The fan's cost badge and click rule. The spacing arithmetic behind the
 * fan lives in `lib/fan-layout.ts` and is tested beside it.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('the fan', () => {
  it('always shows its cards: the count and the menu live on the board, not here', () => {
    renderHand([card({ id: 'a' }), card({ id: 'b' })]);
    expect(screen.queryByRole('button', { name: /Hand/ })).toBeNull();
    expect(document.querySelectorAll('.playtest-hand__slot')).toHaveLength(2);
  });
});

/**
 * Nothing on a hand card plays it by itself (user ruling, 2026-09-23: "tapping
 * a card from hand should not play it to the field"). A mouse click does
 * nothing, as in EDHPlay: you drag it, press A, or use Move to ▸ Battlefield.
 * A keyboard has no drag, so Enter opens the card's menu instead, where
 * playing it is one more key. A finger previews the card when the board takes
 * previews, and otherwise gets the menu too.
 */
describe('a click on a hand card', () => {
  function mount() {
    const onCardMenu = vi.fn();
    render(
      <DndContext>
        <Hand cards={[card({ id: 'a', name: 'Shock' })]} fan onCardMenu={onCardMenu} />
      </DndContext>
    );
    const el = document.querySelector<HTMLElement>('[data-card-id="a"]')!;
    return { onCardMenu, el };
  }

  it('does nothing from a mouse', () => {
    const { onCardMenu, el } = mount();
    act(() => {
      el.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'mouse' }));
    });
    expect(onCardMenu).not.toHaveBeenCalled();
  });

  it('opens the card menu from a tap', () => {
    const { onCardMenu, el } = mount();
    act(() => {
      el.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'touch' }));
    });
    expect(onCardMenu).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number));
  });

  // User, 2026-09-25: a tap on a phone enlarges the card, as EDHPlay's phone
  // table does. The menu moves to the long-press.
  it('previews the card from a tap or a pen when the board takes previews', () => {
    const onCardMenu = vi.fn();
    const onCardPreview = vi.fn();
    render(
      <DndContext>
        <Hand
          cards={[card({ id: 'a', name: 'Shock' })]}
          fan
          onCardMenu={onCardMenu}
          onCardPreview={onCardPreview}
        />
      </DndContext>
    );
    const el = document.querySelector<HTMLElement>('[data-card-id="a"]')!;
    for (const pointerType of ['touch', 'pen']) {
      act(() => {
        el.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType }));
      });
    }
    expect(onCardPreview).toHaveBeenCalledTimes(2);
    expect(onCardPreview).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number));
    fireEvent.keyDown(el.closest('[tabindex]') ?? el, { key: 'Enter' });
    expect(onCardMenu).toHaveBeenCalledTimes(1);
  });

  it('opens the card menu from Enter', () => {
    const { onCardMenu, el } = mount();
    fireEvent.keyDown(el.closest('[tabindex]') ?? el, { key: 'Enter' });
    expect(onCardMenu).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number));
  });
});
