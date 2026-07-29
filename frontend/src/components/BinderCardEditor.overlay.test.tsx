// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../lib/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      removeCardFromBinder: () => {},
      restoreExcludedCard: () => {},
      setBinderManualOrder: () => {},
      seedManualOrder: () => {},
      binders: [],
    }),
}));

// The picker is a `useSheetExit` sheet of its own; this suite only cares that
// it mounts as a sibling layer, not what it renders.
vi.mock('./CardPickerSheet', () => ({
  CardPickerSheet: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Add cards">
      <button type="button" onClick={onClose}>
        Close picker
      </button>
    </div>
  ),
}));

import { BinderCardEditor } from './BinderCardEditor';
import type { EnrichedCard, MaterializedBinder } from '../types';

const card = (copyId: string, name: string) =>
  ({
    copyId,
    name,
    scryfallId: `s-${copyId}`,
    setCode: 'cmr',
    collectorNumber: '1',
    foil: false,
  }) as unknown as EnrichedCard;

const binder = {
  def: { id: 'b1', name: 'Staples', mode: 'rule' },
  sections: [{ cards: [card('c1', 'Sol Ring')] }],
} as unknown as MaterializedBinder;

const allCards = [card('c1', 'Sol Ring'), card('c2', 'Arcane Signet')];

let onClose = vi.fn(() => {});

beforeEach(() => {
  onClose = vi.fn(() => {});
});

const renderEditor = () =>
  render(<BinderCardEditor binder={binder} allCards={allCards} onClose={onClose} />);

const editorDialog = () => screen.getByRole('dialog', { name: /Edit cards/ });

/**
 * BinderCardEditor hand-rolled a `.modal-backdrop` + `.modal` pair with no
 * Escape, no focus trap and no Android back handling — `aria-modal="true"` was
 * a claim the markup didn't back up. It's on the shared `<Modal>` now; these
 * guard the swap rather than re-testing Modal's internals.
 */
describe('BinderCardEditor overlay contract', () => {
  it('renders through the shared Modal, keeping its dialog identity and skin', () => {
    renderEditor();
    const dialog = editorDialog();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The `modal` class carries the existing per-dialog styling.
    expect(dialog.classList.contains('modal')).toBe(true);
    expect(dialog.closest('.modal-backdrop')).toBeTruthy();
  });

  it('moves focus into the dialog on open', () => {
    renderEditor();
    expect(editorDialog().contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape — the hand-rolled version ignored it entirely', () => {
    renderEditor();
    const backdrop = editorDialog().closest('.modal-backdrop') as HTMLElement;

    fireEvent.keyDown(document, { key: 'Escape' });
    // Modal defers onClose until its 120ms exit animation finishes.
    expect(backdrop.classList.contains('is-closing')).toBe(true);

    fireEvent.animationEnd(backdrop, { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', () => {
    renderEditor();
    const dialog = editorDialog();
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled])')
    ).filter((el) => !el.closest('[hidden]'));
    expect(focusables.length).toBeGreaterThan(1);

    // From the last focusable, Tab wraps to the first instead of walking out
    // into the page behind the dialog.
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
  });

  it('mounts the card picker as a sibling layer, not inside the dialog', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: '+ Add cards' }));

    const picker = screen.getByRole('dialog', { name: 'Add cards' });
    // Nested inside the old backdrop, every click in the picker bubbled to the
    // backdrop's onClose and shut the editor.
    expect(editorDialog().contains(picker)).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close picker' }));
    expect(screen.queryByRole('dialog', { name: 'Add cards' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
