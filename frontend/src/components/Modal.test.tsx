// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stub matchMedia so the reduced-motion branch is deterministic. */
function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

describe('Modal focus management', () => {
  it('moves focus to the first focusable element on open', () => {
    render(
      <Modal onClose={() => {}} label="Test">
        <button type="button">first</button>
        <button type="button">second</button>
      </Modal>
    );
    expect(document.activeElement?.textContent).toBe('first');
  });

  it('leaves an autoFocus child alone instead of stealing focus to the first element', () => {
    render(
      <Modal onClose={() => {}} label="Test">
        <button type="button">cancel</button>
        <button type="button" autoFocus>
          confirm
        </button>
      </Modal>
    );
    expect(document.activeElement?.textContent).toBe('confirm');
  });

  it('falls back to focusing the panel itself when nothing inside is focusable', () => {
    render(
      <Modal onClose={() => {}} label="Test">
        <p>just text</p>
      </Modal>
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('wraps Tab from the last focusable to the first, and Shift+Tab from first to last', () => {
    render(
      <Modal onClose={() => {}} label="Test">
        <button type="button">first</button>
        <input aria-label="middle" />
        <button type="button">last</button>
      </Modal>
    );
    const first = screen.getByText('first');
    const last = screen.getByText('last');

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back into the dialog if it escaped (e.g. focus is on <body>)', () => {
    render(
      <Modal onClose={() => {}} label="Test">
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>
    );
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('first');
  });

  it('restores focus to the previously focused element on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          {open && (
            <Modal onClose={() => setOpen(false)} label="Test">
              <button type="button" onClick={() => setOpen(false)}>
                close
              </button>
            </Modal>
          )}
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).toBe('close');

    // Close via the dialog's own button — a direct parent-state unmount.
    fireEvent.click(screen.getByText('close'));
    expect(document.activeElement).toBe(opener);
  });
});

describe('Modal exit animation (delayed unmount)', () => {
  it('Escape defers onClose until the panel exit animation ends', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} label="Test">
        <button type="button">x</button>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    // Close has begun (exit class applied) but onClose is deferred.
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-backdrop.is-closing')).not.toBeNull();

    // The entrance keyframe (or any bubbling descendant animation) must not
    // complete the close — only the panel's exit does.
    fireEvent.animationEnd(screen.getByRole('dialog'), { animationName: 'modal-panel-in' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.animationEnd(screen.getByRole('dialog'), { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click also goes through the delayed exit, and double-triggering closes once', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal onClose={onClose} label="Test">
        <button type="button">x</button>
      </Modal>
    );
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;

    fireEvent.click(backdrop);
    fireEvent.keyDown(document, { key: 'Escape' }); // second trigger mid-exit
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.animationEnd(screen.getByRole('dialog'), { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicks on the panel do not start a close', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} label="Test">
        <button type="button">x</button>
      </Modal>
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-backdrop.is-closing')).toBeNull();
  });

  it('ignores Escape and backdrop click when dismissable is false', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal onClose={onClose} label="Test" dismissable={false}>
        <button type="button">x</button>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('.modal-backdrop') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes immediately under prefers-reduced-motion (no animationend to wait on)', () => {
    mockReducedMotion(true);
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} label="Test">
        <button type="button">x</button>
      </Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('stacked modals', () => {
  it('only the topmost modal answers Escape and traps Tab', () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <div>
        <Modal onClose={closeBottom} label="Bottom">
          <button type="button">bottom-btn</button>
        </Modal>
        <Modal onClose={closeTop} label="Top">
          <button type="button">top-btn</button>
        </Modal>
      </div>
    );

    // The bottom modal's trap must not yank focus away from the top one.
    expect(document.activeElement?.textContent).toBe('top-btn');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('top-btn');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeBottom).not.toHaveBeenCalled();
    fireEvent.animationEnd(screen.getByRole('dialog', { name: 'Top' }), {
      animationName: 'modal-panel-out',
    });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });
});
