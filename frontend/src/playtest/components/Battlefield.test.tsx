// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { BattlefieldCard } from '@/lib/playtest';
import { Battlefield } from './Battlefield';

const EMPTY_SET: ReadonlySet<string> = new Set();

const CARD: BattlefieldCard = {
  card: { id: 'c1', name: 'Vengeful Dead' },
  tapped: false,
  counters: {},
  stickers: [],
  x: 0.5,
  y: 0.5,
  faceDown: false,
};

/**
 * What a real browser dispatches for a mouse click or a touch tap: a
 * `pointerdown`, then the `click` the browser synthesizes on release. A
 * bare `fireEvent.click` skips the pointerdown and would pass even when
 * dnd-kit's `PointerSensor` swallows the real thing — see
 * `Battlefield.cardsDraggable`'s doc comment for the mechanism (no
 * `activationConstraint` on this `<DndContext>` means a pointerdown
 * "activates" the drag immediately and installs a capturing `document`
 * click listener that calls `stopPropagation()`).
 */
function realPointerActivate(el: Element, pointerType: 'mouse' | 'touch') {
  fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, button: 0, pointerType });
  fireEvent.pointerUp(el, { pointerId: 1, isPrimary: true, button: 0, pointerType });
  fireEvent.click(el);
}

function renderBattlefield(cardsDraggable: boolean, onCardClick = vi.fn()) {
  render(
    <DndContext>
      <Battlefield
        cards={[CARD]}
        selectedIds={EMPTY_SET}
        stackIds={EMPTY_SET}
        cardsDraggable={cardsDraggable}
        onBackgroundClick={() => {}}
        onCardClick={onCardClick}
        onCardContextMenu={() => {}}
      />
    </DndContext>
  );
  return onCardClick;
}

describe('Battlefield cardsDraggable', () => {
  it('a real mouse pointerdown+click reaches onCardClick when cards are not draggable', () => {
    const onCardClick = renderBattlefield(false);
    realPointerActivate(screen.getByRole('button', { name: /Vengeful Dead/ }), 'mouse');
    expect(onCardClick).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('a real touch pointerdown+click reaches onCardClick when cards are not draggable', () => {
    const onCardClick = renderBattlefield(false);
    realPointerActivate(screen.getByRole('button', { name: /Vengeful Dead/ }), 'touch');
    expect(onCardClick).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('a draggable card with no activationConstraint swallows the click (the bug this prop exists to avoid)', () => {
    const onCardClick = renderBattlefield(true);
    realPointerActivate(screen.getByRole('button', { name: /Vengeful Dead/ }), 'mouse');
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('never marks a non-draggable card aria-disabled — it is still fully clickable', () => {
    renderBattlefield(false);
    const el = screen.getByRole('button', { name: /Vengeful Dead/ });
    expect(el.getAttribute('aria-disabled')).toBe('false');
  });
});
