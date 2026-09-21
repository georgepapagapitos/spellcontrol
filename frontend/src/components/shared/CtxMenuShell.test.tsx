// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CtxMenuShell } from './CtxMenuShell';

// The shell had no direct test while it lived in playtest/ — it was covered
// only through the three menus that use it. It now backs the deck view too,
// so its own contract (Escape, backdrop, clamping, focus-in) is tested here.

function items(n = 2) {
  return Array.from({ length: n }, (_, i) => (
    <button key={i} type="button">{`Item ${i + 1}`}</button>
  ));
}

describe('CtxMenuShell', () => {
  beforeEach(() => {
    // jsdom/happy-dom report a 0x0 viewport; give the clamp something real.
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  it('renders the floating variant as a named menu', () => {
    const { getByRole } = render(
      <CtxMenuShell x={10} y={10} title="Brago" variant="floating" onClose={vi.fn()}>
        {items()}
      </CtxMenuShell>
    );
    expect(getByRole('menu', { name: 'Brago' })).toBeTruthy();
  });

  it('renders the sheet variant as a labelled modal dialog with a visible title', () => {
    const { getByRole, getByText } = render(
      <CtxMenuShell x={0} y={0} title="Brago" variant="sheet" onClose={vi.fn()}>
        {items()}
      </CtxMenuShell>
    );
    const dialog = getByRole('dialog', { name: 'Brago' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(getByText('Brago')).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <CtxMenuShell x={10} y={10} title="Brago" variant="floating" onClose={onClose}>
        {items()}
      </CtxMenuShell>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked, not the menu body', () => {
    const onClose = vi.fn();
    const { container, getByRole } = render(
      <CtxMenuShell x={10} y={10} title="Brago" variant="floating" onClose={onClose}>
        {items()}
      </CtxMenuShell>
    );
    fireEvent.click(getByRole('menu'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.ctx-menu__backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the first control, so a keyboard open is operable', () => {
    const { getByText } = render(
      <CtxMenuShell x={10} y={10} title="Brago" variant="floating" onClose={vi.fn()}>
        {items(3)}
      </CtxMenuShell>
    );
    expect(document.activeElement).toBe(getByText('Item 1'));
  });

  it('skips a disabled control when placing initial focus', () => {
    const { getByText } = render(
      <CtxMenuShell x={10} y={10} title="Brago" variant="floating" onClose={vi.fn()}>
        <button type="button" disabled>
          Nope
        </button>
        <button type="button">Yes</button>
      </CtxMenuShell>
    );
    expect(document.activeElement).toBe(getByText('Yes'));
  });

  it('re-focuses the new page when contentKey changes', () => {
    const { rerender, getByText } = render(
      <CtxMenuShell
        x={10}
        y={10}
        title="Brago"
        variant="floating"
        contentKey="root"
        onClose={vi.fn()}
      >
        <button type="button">Root item</button>
      </CtxMenuShell>
    );
    expect(document.activeElement).toBe(getByText('Root item'));

    rerender(
      <CtxMenuShell
        x={10}
        y={10}
        title="Brago"
        variant="floating"
        contentKey="stack"
        onClose={vi.fn()}
      >
        <button type="button">Stack item</button>
      </CtxMenuShell>
    );
    expect(document.activeElement).toBe(getByText('Stack item'));
  });

  it('clamps the floating panel into the viewport instead of overflowing it', () => {
    const { getByRole } = render(
      <CtxMenuShell x={99999} y={99999} title="Brago" variant="floating" onClose={vi.fn()}>
        {items()}
      </CtxMenuShell>
    );
    const menu = getByRole('menu') as HTMLElement;
    // Whatever the measured size, a click near the bottom-right corner must
    // not place the panel off-screen.
    expect(parseFloat(menu.style.left)).toBeLessThan(window.innerWidth);
    expect(parseFloat(menu.style.top)).toBeLessThan(window.innerHeight);
    expect(menu.style.visibility).toBe('visible');
  });
});
