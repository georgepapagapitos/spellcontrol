// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DeckEditorCardPickerSheet } from './DeckEditorCardPickerSheet';

afterEach(cleanup);

describe('DeckEditorCardPickerSheet', () => {
  it('portals its root to document.body, outside the page that rendered it', () => {
    const { container } = render(
      <main className="deck-editor-page">
        <DeckEditorCardPickerSheet label="Add cards" className="deck-add-sheet" onClose={vi.fn()}>
          {() => <p>inside</p>}
        </DeckEditorCardPickerSheet>
      </main>
    );
    const dialog = screen.getByRole('dialog', { name: 'Add cards' });
    const root = dialog.parentElement as HTMLElement;
    expect(root.className).toBe('card-picker-root');
    expect(root.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
  });

  it('locks body scroll while open and closes from the backdrop', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <DeckEditorCardPickerSheet label="Add cards" className="deck-add-sheet" onClose={onClose}>
        {() => <p>inside</p>}
      </DeckEditorCardPickerSheet>
    );
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
