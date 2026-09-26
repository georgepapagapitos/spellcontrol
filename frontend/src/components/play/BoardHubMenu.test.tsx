// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BoardHubMenu } from './BoardHubMenu';

function petals(onSelect: (id: string) => void) {
  return [
    { id: 'a', label: 'Alpha', icon: <span aria-hidden>A</span>, onSelect: () => onSelect('a') },
    { id: 'b', label: 'Beta', icon: <span aria-hidden>B</span>, onSelect: () => onSelect('b') },
  ];
}

function renderRing(onClose = vi.fn(), onSelect = vi.fn(), openedByKeyboard?: boolean) {
  const hubRef = createRef<HTMLButtonElement>();
  const utils = render(
    <div>
      <button ref={hubRef} type="button">
        Hub
      </button>
      <BoardHubMenu
        hubRef={hubRef}
        onClose={onClose}
        petals={petals(onSelect)}
        openedByKeyboard={openedByKeyboard}
      />
    </div>
  );
  return { ...utils, onClose, onSelect, hub: screen.getByRole('button', { name: 'Hub' }) };
}

const RING_SELECTOR = '.board-hub-ring';
const RING_SUPPRESSED_CLASS = 'board-hub-ring-pointer-opened';

describe('BoardHubMenu', () => {
  it('renders every petal as a menuitem inside a menu', () => {
    renderRing();
    const ring = screen.getByRole('menu', { name: 'Board menu' });
    expect(ring.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });

  it('moves focus into the ring on open', () => {
    renderRing();
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBe(document.activeElement);
  });

  it('calls the petal and closes on click', () => {
    const { onClose, onSelect } = renderRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the hub', () => {
    const { onClose, hub } = renderRing();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(hub);
  });

  it('closes on an outside pointerdown', () => {
    const { onClose } = renderRing();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('roams the ring with Arrow keys', () => {
    renderRing();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toBe(document.activeElement);
  });

  it('never scrolls the board when focus moves into or around the ring', () => {
    // Landscape with the board kept still: a petal overhanging the board's
    // edge made the opening focus() scroll the (overflow: hidden) board, the
    // ring's scroll-dismiss read that as the hub moving, and a keyboard or
    // scripted open closed as it opened.
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      renderRing();
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      fireEvent.keyDown(document, { key: 'Home' });
      const petalCalls = focus.mock.contexts
        .map((el, i) => [el, focus.mock.calls[i][0]] as const)
        .filter(([el]) => (el as HTMLElement).classList.contains('board-hub-petal'));
      expect(petalCalls).toHaveLength(3);
      for (const [, opts] of petalCalls) expect(opts).toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });

  // F12a: opening the ring by pointer must not draw a focus ring on the
  // first petal, even though focus still moves there; a keyboard open must.
  describe('the initial-focus ring, keyed to how the open was triggered', () => {
    it('is not suppressed on a keyboard open (the default)', () => {
      renderRing(vi.fn(), vi.fn(), true);
      expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBe(document.activeElement);
      expect(document.querySelector(RING_SELECTOR)?.classList.contains(RING_SUPPRESSED_CLASS)).toBe(
        false
      );
    });

    it('is suppressed on a pointer open, though focus still moves to the first petal', () => {
      renderRing(vi.fn(), vi.fn(), false);
      expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBe(document.activeElement);
      expect(document.querySelector(RING_SELECTOR)?.classList.contains(RING_SUPPRESSED_CLASS)).toBe(
        true
      );
    });

    it('clears on the first real keydown, so subsequent keyboard nav still rings', () => {
      renderRing(vi.fn(), vi.fn(), false);
      expect(document.querySelector(RING_SELECTOR)?.classList.contains(RING_SUPPRESSED_CLASS)).toBe(
        true
      );
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      expect(document.querySelector(RING_SELECTOR)?.classList.contains(RING_SUPPRESSED_CLASS)).toBe(
        false
      );
    });
  });
});
