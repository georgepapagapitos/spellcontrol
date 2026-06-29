// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckPickerSheet } from './DeckPickerSheet';

/** Force the desktop (≥1024px) breakpoint for one test. happy-dom's default
 *  matchMedia returns matches=false, which is the mobile path. */
function mockDesktop(isDesktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        // Reduced-motion stays false; the 1024px query reflects isDesktop.
        matches: q.includes('1024') ? isDesktop : false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  );
}

describe('DeckPickerSheet — symmetric exit (E70)', () => {
  afterEach(() => vi.restoreAllMocks());

  function renderSheet(onClose = vi.fn()) {
    render(
      <DeckPickerSheet className="deck-add-sheet" ariaLabel="Add cards" onClose={onClose}>
        {(close) => (
          <button type="button" onClick={close}>
            Done
          </button>
        )}
      </DeckPickerSheet>
    );
    return onClose;
  }

  it('renders the shared card-picker chrome with the variant class', () => {
    renderSheet();
    const sheet = document.querySelector('.card-picker-sheet');
    expect(sheet).toBeTruthy();
    expect(sheet?.classList.contains('deck-add-sheet')).toBe(true);
    expect(sheet?.getAttribute('aria-label')).toBe('Add cards');
    // Drag handle present (dismissable sheet).
    expect(document.querySelector('.card-picker-handle')).toBeTruthy();
  });

  it('on mobile, backdrop tap plays the exit, then unmount fires onClose', () => {
    mockDesktop(false);
    const onClose = renderSheet();
    fireEvent.click(document.querySelector('.card-picker-root') as HTMLElement);
    // Slides out first — onClose held until the exit animation ends.
    const sheet = document.querySelector('.card-picker-sheet') as HTMLElement;
    expect(sheet.classList.contains('is-closing')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(sheet, { animationName: 'binder-sheet-slide-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the inner control (close render-prop) also routes through the exit', () => {
    mockDesktop(false);
    const onClose = renderSheet();
    fireEvent.click(screen.getByText('Done'));
    const sheet = document.querySelector('.card-picker-sheet') as HTMLElement;
    expect(sheet.classList.contains('is-closing')).toBe(true);
    fireEvent.animationEnd(sheet, { animationName: 'binder-sheet-slide-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on desktop (≥1024px) it closes instantly — no exit animation to await', () => {
    mockDesktop(true);
    const onClose = renderSheet();
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.card-picker-sheet')?.classList.contains('is-closing')).toBe(
      false
    );
  });
});
