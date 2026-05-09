import { useEffect } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { UploadPanel } from './UploadPanel';

/**
 * Bottom-sheet wrapper around UploadPanel for returning users on the
 * Collection page. The trigger is the "+" icon in the OVERVIEW row.
 * On the empty-state page (no cards yet), UploadPanel renders inline as
 * the page hero instead — that's a different surface, not this sheet.
 */
export function ImportSheet() {
  const open = useCollectionStore((s) => s.importSheetOpen);
  const setOpen = useCollectionStore((s) => s.setImportSheetOpen);
  // Auto-close when the user finishes an import (cards count change is a
  // strong "they did the thing" signal). useEffect below.
  const cardsCount = useCollectionStore((s) => s.cards.length);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Close the sheet when the collection grows (a successful import).
  // The dependency is the count, not `open`, so we don't close on every
  // re-render of an open sheet.
  useEffect(() => {
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsCount]);

  if (!open) return null;

  return (
    <div className="import-sheet-root">
      <div className="import-sheet-backdrop" onClick={() => setOpen(false)} aria-hidden />
      <div className="import-sheet" role="dialog" aria-modal="true" aria-label="Import collection">
        <div className="import-sheet-header">
          <div className="import-sheet-handle" aria-hidden />
          <button
            type="button"
            className="import-sheet-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="import-sheet-body">
          <UploadPanel />
        </div>
      </div>
    </div>
  );
}
