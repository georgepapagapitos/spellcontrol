// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { PlaytestCard } from '@/lib/playtest';
import { ZonePile } from './ZonePile';

/**
 * The command zone holds whatever is put there — nothing stops you dragging
 * ten lands in, and nothing should: this is a table, not a rules engine. But
 * the corner row drew one card per card in the zone, so five cards made a
 * 576px-wide tile that shoved the whole pile row across the felt (measured
 * in a real browser, 2026-09-22). The row shows the two most recent, the
 * count tells the truth, and the viewer is where the rest live.
 */
function card(id: string): PlaytestCard {
  return { id, name: `Card ${id}` };
}

function renderCommand(cards: PlaytestCard[]) {
  return render(
    <DndContext>
      <ZonePile
        zone="command"
        label="Command"
        cards={cards}
        click={{ label: 'View the command zone', onClick: vi.fn() }}
        onMenu={vi.fn()}
      />
    </DndContext>
  );
}

describe('ZonePile — the command zone', () => {
  it('draws a commander and a partner side by side', () => {
    renderCommand([card('a'), card('b')]);
    expect(document.querySelectorAll('.playtest-pile__commander')).toHaveLength(2);
  });

  it('draws no more than two however many are in the zone, and counts them all', () => {
    renderCommand(['a', 'b', 'c', 'd', 'e'].map(card));
    expect(document.querySelectorAll('.playtest-pile__commander')).toHaveLength(2);
    expect(screen.getByText('(5)')).toBeTruthy();
  });

  it('shows the two MOST RECENT, so a card just dropped in is one of them', () => {
    renderCommand(['a', 'b', 'c', 'd'].map(card));
    const names = [...document.querySelectorAll('.playtest-pile__commander')].map((el) =>
      el.getAttribute('aria-label')
    );
    expect(names).toEqual(['Cast Card c', 'Cast Card d']);
  });
});

/**
 * A pile carries no button of its own for its menu. The kebab it used to
 * wear was chrome a real table does not have — a tile is a stack of cards,
 * and the actions on a stack of cards belong to the gesture that asks for
 * them. Removing it is only safe while all three routes survive, and each
 * one is somebody's only route: right-click for a mouse, the Context Menu
 * key (which fires the same `contextmenu` event) for a keyboard, and the
 * press-and-hold for a finger.
 */
describe('ZonePile — reaching the menu without a kebab', () => {
  function renderLibrary(onMenu: (x: number, y: number) => void, onClick = vi.fn()) {
    render(
      <DndContext>
        <ZonePile
          zone="library"
          label="Library"
          cards={[card('a'), card('b')]}
          click={{ label: 'Draw a card', onClick }}
          onMenu={onMenu}
        />
      </DndContext>
    );
    return document.querySelector('.playtest-pile') as HTMLElement;
  }

  it('wears no menu button', () => {
    renderLibrary(vi.fn());
    expect(document.querySelector('.playtest-pile__kebab')).toBeNull();
    expect(screen.queryByRole('button', { name: /actions/i })).toBeNull();
  });

  it('opens on right-click, at the pointer', () => {
    const onMenu = vi.fn();
    const pile = renderLibrary(onMenu);
    fireEvent.contextMenu(pile, { clientX: 120, clientY: 340 });
    expect(onMenu).toHaveBeenCalledWith(120, 340);
  });

  it('opens on a press-and-hold, and that hold does not also draw', () => {
    vi.useFakeTimers();
    try {
      const onMenu = vi.fn();
      const onClick = vi.fn();
      const pile = renderLibrary(onMenu, onClick);
      fireEvent.touchStart(pile, { touches: [{ clientX: 40, clientY: 60 }] });
      vi.advanceTimersByTime(600);
      expect(onMenu).toHaveBeenCalledWith(40, 60);
      // The release that follows must not draw a card behind the menu.
      fireEvent.touchEnd(pile);
      screen.getByRole('button', { name: /Draw a card/ }).click();
      expect(onClick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a short tap still draws', () => {
    const onClick = vi.fn();
    const pile = renderLibrary(vi.fn(), onClick);
    fireEvent.touchStart(pile, { touches: [{ clientX: 40, clientY: 60 }] });
    fireEvent.touchEnd(pile);
    screen.getByRole('button', { name: /Draw a card/ }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
