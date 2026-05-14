import { X } from 'lucide-react';
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
  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

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
            <X width={20} height={20} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
        <div className="import-sheet-body">
          <UploadPanel />
        </div>
      </div>
    </div>
  );
}
