// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
