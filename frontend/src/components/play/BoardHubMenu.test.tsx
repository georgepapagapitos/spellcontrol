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

function renderRing(onClose = vi.fn(), onSelect = vi.fn()) {
  const hubRef = createRef<HTMLButtonElement>();
  const utils = render(
    <div>
      <button ref={hubRef} type="button">
        Hub
      </button>
      <BoardHubMenu hubRef={hubRef} onClose={onClose} petals={petals(onSelect)} />
    </div>
  );
  return { ...utils, onClose, onSelect, hub: screen.getByRole('button', { name: 'Hub' }) };
}

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
});
