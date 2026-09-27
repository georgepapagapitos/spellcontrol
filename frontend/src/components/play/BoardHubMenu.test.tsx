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

function dock(onSelect: (id: string) => void) {
  return [
    { id: 'x', label: 'Away', icon: <span aria-hidden>X</span>, onSelect: () => onSelect('x') },
  ];
}

function renderRing(
  onClose = vi.fn(),
  onSelect = vi.fn(),
  openedByKeyboard?: boolean,
  withDock = false
) {
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
        dock={withDock ? dock(onSelect) : undefined}
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
        .filter(([el]) => (el as HTMLElement).classList.contains('board-hub-key'));
      expect(petalCalls).toHaveLength(3);
      for (const [, opts] of petalCalls) expect(opts).toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });

  describe('the dock', () => {
    it('is part of the same menu, after the keys', () => {
      renderRing(vi.fn(), vi.fn(), true, true);
      const ring = screen.getByRole('menu', { name: 'Board menu' });
      expect(
        [...ring.querySelectorAll('[role="menuitem"]')].map(
          (el) => el.querySelector('[class$="-label"]')?.textContent
        )
      ).toEqual(['Alpha', 'Beta', 'Away']);
      expect(ring.querySelector('.board-hub-dock [role="menuitem"]')?.textContent).toContain(
        'Away'
      );
    });

    it('is reached by arrowing past the last key, and End jumps to it', () => {
      renderRing(vi.fn(), vi.fn(), true, true);
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      expect(screen.getByRole('menuitem', { name: 'Away' })).toBe(document.activeElement);
      fireEvent.keyDown(document, { key: 'Home' });
      fireEvent.keyDown(document, { key: 'End' });
      expect(screen.getByRole('menuitem', { name: 'Away' })).toBe(document.activeElement);
    });

    it('selects and closes like a key', () => {
      const { onClose, onSelect } = renderRing(vi.fn(), vi.fn(), true, true);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Away' }));
      expect(onSelect).toHaveBeenCalledWith('x');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('fills only the key marked primary', () => {
    const hubRef = createRef<HTMLButtonElement>();
    render(
      <div>
        <button ref={hubRef} type="button">
          Hub
        </button>
        <BoardHubMenu
          hubRef={hubRef}
          onClose={vi.fn()}
          petals={[
            { id: 'r', label: 'Rematch', icon: null, onSelect: vi.fn(), primary: true },
            { id: 'd', label: 'Dice', icon: null, onSelect: vi.fn() },
          ]}
        />
      </div>
    );
    expect(screen.getByRole('menuitem', { name: 'Rematch' }).classList.contains('is-primary')).toBe(
      true
    );
    expect(screen.getByRole('menuitem', { name: 'Dice' }).classList.contains('is-primary')).toBe(
      false
    );
  });

  // F12a: opening the ring by pointer must not draw a focus ring on the
  // first key, even though focus still moves there; a keyboard open must.
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
