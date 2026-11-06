// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet, type SheetHandle } from './Sheet';

// Reduced motion: every close is immediate, so the tests don't wait out an
// exit animation happy-dom never plays.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
afterEach(() => vi.restoreAllMocks());

const root = () => document.querySelector('.card-picker-root') as HTMLElement;

describe('Sheet', () => {
  it('is a modal dialog named by its title, portaled to <body>', () => {
    const { container } = render(
      <Sheet onClose={() => {}} title="Add card" description="Pinned here">
        <p>body</p>
      </Sheet>
    );
    const dialog = screen.getByRole('dialog', { name: 'Add card' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(container.contains(dialog)).toBe(false);
    expect(screen.getByText('Pinned here').className).toBe('card-picker-description');
  });

  it('puts the toolbar inside the header, so it takes the header inset', () => {
    render(
      <Sheet onClose={() => {}} title="Add card" toolbar={<input aria-label="Search" />}>
        <p>body</p>
      </Sheet>
    );
    expect(screen.getByLabelText('Search').closest('.card-picker-header')).not.toBeNull();
  });

  it('closes on a backdrop tap, Escape, the close button and the footer close', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet
        onClose={onClose}
        title="Tokens"
        closeButton
        footer={(close) => <button onClick={close}>Done</button>}
      >
        <p>body</p>
      </Sheet>
    );
    fireEvent.click(root());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1); // the first close wins; the hook is single-shot
    unmount();

    for (const name of ['Close', 'Done']) {
      const each = vi.fn();
      const r = render(
        <Sheet
          onClose={each}
          title="Tokens"
          closeButton
          footer={(close) => <button onClick={close}>Done</button>}
        >
          <p>body</p>
        </Sheet>
      );
      fireEvent.click(screen.getByRole('button', { name }));
      expect(each).toHaveBeenCalledTimes(1);
      r.unmount();
    }
  });

  it('a non-dismissable sheet has no handle and ignores the backdrop and Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet onClose={onClose} title="The horde reveals" dismissable={false}>
        <p>body</p>
      </Sheet>
    );
    expect(document.querySelector('.card-picker-handle')).toBeNull();
    fireEvent.click(root());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes through its ref, for an auto-close the JSX does not raise', () => {
    const onClose = vi.fn();
    const ref = createRef<SheetHandle>();
    render(
      <Sheet ref={ref} onClose={onClose} title="Add to binder">
        <p>body</p>
      </Sheet>
    );
    ref.current?.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders in place when asked, for the play table', () => {
    const { container } = render(
      <Sheet inPlace onClose={() => {}} title="Roll">
        <p>body</p>
      </Sheet>
    );
    expect(container.querySelector('.card-picker-root')).not.toBeNull();
  });
});
