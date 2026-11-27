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

  it('puts actions in the heading row, before the close button, and hands them close', () => {
    const onClose = vi.fn();
    render(
      <Sheet
        onClose={onClose}
        title="Pull list"
        closeButton
        actions={(close) => <button onClick={close}>Start over</button>}
      >
        <p>body</p>
      </Sheet>
    );
    const action = screen.getByRole('button', { name: 'Start over' });
    const row = action.closest('.card-picker-heading');
    expect(row).not.toBeNull();
    const buttons = [...row!.querySelectorAll('button')].map(
      (b) => b.textContent?.trim() || b.getAttribute('aria-label')
    );
    expect(buttons).toEqual(['Start over', 'Close']);
    fireEvent.click(action);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no actions row when the slot is empty', () => {
    render(
      <Sheet onClose={() => {}} title="Pull list" actions={false}>
        <p>body</p>
      </Sheet>
    );
    expect(document.querySelector('.card-picker-actions')).toBeNull();
  });

  it('renders no actions row when the render function returns nothing', () => {
    for (const empty of [false, null, undefined, '']) {
      const r = render(
        <Sheet onClose={() => {}} title="Pull list" actions={() => empty}>
          <p>body</p>
        </Sheet>
      );
      expect(document.querySelector('.card-picker-actions'), String(empty)).toBeNull();
      r.unmount();
    }
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

// E1121: the browser Back button on a sheet that has to be answered. Back used
// to close every sheet and run its onClose, so on the Horde reveal (onClose is
// its confirm) Back confirmed the reveal, and on the Horde end sheet it left
// the game. A non-dismissable sheet now refuses Back the way Modal does: the
// sheet stays, the page stays, and the next Back is intercepted again.
describe('Sheet: browser Back', () => {
  // Two real pages behind the sheet: /before, then /origin where it opens.
  // `idx` is react-router's own entry index, which the Back integration reads.
  beforeEach(() => {
    window.history.replaceState({ idx: 0 }, '', '/before');
    window.history.pushState({ idx: 1 }, '', '/origin');
  });
  afterEach(() => window.history.replaceState(null, '', '/clean'));

  const marked = () => !!(window.history.state as Record<string, unknown> | null)?.__scOverlayBack;

  it('closes a dismissable sheet and keeps the page', () => {
    const onClose = vi.fn();
    render(
      <Sheet onClose={onClose} title="Tokens">
        <p>body</p>
      </Sheet>
    );
    window.history.back();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/origin');
  });

  it('refuses Back on a non-dismissable sheet: no onClose, the sheet and the page stay', () => {
    const onClose = vi.fn();
    render(
      <Sheet onClose={onClose} title="The horde reveals" dismissable={false}>
        <p>body</p>
      </Sheet>
    );
    window.history.back();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'The horde reveals' })).toBeTruthy();
    expect(window.location.pathname).toBe('/origin');
    // Re-marked, so a second Back is held the same way rather than leaving.
    expect(marked()).toBe(true);
    window.history.back();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/origin');
  });

  it('after refused Backs, the sheet’s own answer closes it and one Back then leaves the page', () => {
    const onClose = vi.fn();
    const ref = createRef<SheetHandle>();
    const { unmount } = render(
      <Sheet ref={ref} onClose={onClose} title="The horde reveals" dismissable={false}>
        <p>body</p>
      </Sheet>
    );
    window.history.back();
    window.history.back();
    ref.current?.close(); // the sheet's own Confirm
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    // No stray entry to press through: one Back leaves /origin for /before.
    window.history.back();
    expect(window.location.pathname).toBe('/before');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // A close already under way is not refused. When the sheet's own answer
  // ran `onClose` but the parent kept the sheet (a dropped or failed step),
  // holding Back too would leave nothing that gets the user off the page.
  it('does not hold the page once its own close has run and the parent kept it mounted', () => {
    const onClose = vi.fn();
    const ref = createRef<SheetHandle>();
    render(
      <Sheet ref={ref} onClose={onClose} title="The horde reveals" dismissable={false}>
        <p>body</p>
      </Sheet>
    );
    ref.current?.close(); // Confirm: onClose runs, but nothing unmounts the sheet
    expect(onClose).toHaveBeenCalledTimes(1);
    window.history.back(); // consumes the sheet's own entry
    window.history.back(); // and this one leaves
    expect(window.location.pathname).toBe('/before');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('follows dismissable as it changes while open (RecheckLandsSheet mid-apply)', () => {
    const onClose = vi.fn();
    const sheet = (dismissable: boolean) => (
      <Sheet onClose={onClose} title="Re-check lands" dismissable={dismissable}>
        <p>body</p>
      </Sheet>
    );
    const { rerender } = render(sheet(true));
    rerender(sheet(false)); // Apply pressed: the sheet must be answered now
    window.history.back();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/origin');

    rerender(sheet(true)); // the apply failed and the sheet is dismissable again
    window.history.back();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/origin');
  });
});
