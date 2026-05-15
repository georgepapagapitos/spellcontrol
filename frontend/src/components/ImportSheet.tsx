import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { UploadPanel } from './UploadPanel';

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
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import collection"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Import cards</h2>
          <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
            <X width={20} height={20} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <UploadPanel />
        </div>
      </div>
    </div>
  );
}
