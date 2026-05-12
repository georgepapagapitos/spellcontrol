import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useEscapeKey } from '../lib/use-escape-key';
import type { MaterializedBinder } from '../types';

interface Props {
  binders: MaterializedBinder[];
}

/**
 * Mobile-only bottom action sheet for switching between binders. Opened
 * via the "Switch binder" button on the binder page. Listing rows
 * replicate the data on the desktop chip strip but with native mobile
 * ergonomics — full-width touch targets, scrim, body-scroll lock.
 */
export function BinderPickerSheet({ binders }: Props) {
  const open = useCollectionStore((s) => s.binderPickerOpen);
  const setOpen = useCollectionStore((s) => s.setBinderPickerOpen);
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);

  useLockBodyScroll(open);
  useEscapeKey(() => setOpen(false), open);

  if (!open) return null;

  const sorted = [...binders].sort((a, b) => a.def.position - b.def.position);

  return (
    <div className="binder-picker-root">
      <div className="binder-picker-backdrop" onClick={() => setOpen(false)} aria-hidden />
      <div
        className="binder-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Switch binder"
      >
        <div className="binder-picker-handle" aria-hidden />
        <div className="binder-picker-title">Binders</div>
        <ul className="binder-picker-list">
          {sorted.map((b) => {
            const isActive = b.def.id === activeTab;
            return (
              <li key={b.def.id}>
                <button
                  type="button"
                  className={`binder-picker-row ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab(b.def.id);
                    setOpen(false);
                  }}
                  aria-current={isActive ? 'true' : undefined}
                  style={{ ['--binder-color' as string]: b.def.color }}
                >
                  <span
                    className="binder-picker-row-dot"
                    aria-hidden
                    style={{ background: b.def.color }}
                  />
                  <span className="binder-picker-row-name">{b.def.name}</span>
                  <span className="binder-picker-row-count">
                    {b.totalCards.toLocaleString()} {b.totalCards === 1 ? 'card' : 'cards'}
                    {' · '}
                    {b.totalPages.toLocaleString()} {b.totalPages === 1 ? 'page' : 'pages'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="binder-picker-footer">
          <button
            type="button"
            className="btn binder-picker-edit"
            onClick={() => {
              setEditingBinder(activeTab);
              setOpen(false);
            }}
            disabled={!activeTab}
          >
            Edit current
          </button>
          <button
            type="button"
            className="btn btn-primary binder-picker-new"
            onClick={() => {
              setEditingBinder('new');
              setOpen(false);
            }}
          >
            + New binder
          </button>
        </div>
      </div>
    </div>
  );
}
