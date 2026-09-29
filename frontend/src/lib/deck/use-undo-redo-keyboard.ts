import { useEffect } from 'react';

/**
 * Pure decision logic for the undo/redo keyboard contract, factored out of the
 * hook so it can be unit-tested without a DOM.
 *
 * Mapping (mirrors the deck editor's original inline handler):
 * - Requires a primary modifier (`metaKey` or `ctrlKey`); without one → `null`.
 * - Cmd/Ctrl+Z (no shift) → `'undo'`.
 * - Cmd/Ctrl+Shift+Z → `'redo'`.
 * - Ctrl+Y (without meta) → `'redo'` (the classic Windows redo). Cmd+Y is NOT
 *   redo — `y` requires `ctrlKey && !metaKey`.
 * - Anything else → `null`.
 */
export function classifyUndoRedoKey(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>
): 'undo' | 'redo' | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  const key = e.key.toLowerCase();
  const isUndo = key === 'z' && !e.shiftKey;
  const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey);
  if (isUndo) return 'undo';
  if (isRedo) return 'redo';
  return null;
}

/**
 * True when the event target is a text-entry surface (INPUT / TEXTAREA /
 * contentEditable). Used to skip the shortcut so native text-editing undo keeps
 * working while a field is focused.
 */
export function isTextEntryTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

interface UndoRedoKeyboardOptions {
  /** When `false`, the listener is not installed. Defaults to `true`. */
  enabled?: boolean;
  /** Invoked on an undo chord. Return `true` if it actually handled the action. */
  onUndo: () => boolean;
  /** Invoked on a redo chord. Return `true` if it actually handled the action. */
  onRedo: () => boolean;
}

/**
 * Installs a global (window) keydown listener implementing the standard
 * undo/redo keyboard contract: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Ctrl+Y
 * redo. Skips while a text field is focused so native text-editing undo still
 * works.
 *
 * `onUndo`/`onRedo` return whether they actually handled the action; the hook
 * calls `e.preventDefault()` only when handled, so an exhausted history leaves
 * the browser's default behavior intact.
 *
 * The listener is removed on unmount and re-installed when any option changes.
 */
export function useUndoRedoKeyboard({ enabled = true, onUndo, onRedo }: UndoRedoKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = classifyUndoRedoKey(e);
      if (!action) return;
      if (isTextEntryTarget(e.target)) return;
      const handled = action === 'redo' ? onRedo() : onUndo();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onUndo, onRedo]);
}
