import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import type { MaterializedBinder } from '../types';
import { BinderExportDialog } from './BinderExportDialog';
import { useConfirm } from '../lib/use-confirm';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';

interface Props {
  binders: MaterializedBinder[];
}

export function BinderTabs({ binders }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const navigate = useNavigate();
  const moveBinder = useCollectionStore((s) => s.moveBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const [exportOpen, setExportOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: `Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`,
      confirmLabel: 'Delete binder',
      danger: true,
    });
    if (ok) deleteBinder(id);
  };

  const handleDeleteAll = async () => {
    const ok = await confirm({
      title: `Delete all ${binders.length} binders?`,
      body: `Every binder definition will be removed. Your cards stay where they are — they'll fall back to the Uncategorized view until you build new binders. This cannot be undone.`,
      confirmLabel: 'Delete all binders',
      danger: true,
    });
    if (ok) deleteAllBinders();
  };

  // Sort by position so reorder arrows produce a consistent display
  const sorted = [...binders].sort((a, b) => a.def.position - b.def.position);

  return (
    <div className="tab-row binder-tab-row">
      {sorted.map((b, idx) => {
        const isActive = activeTab === b.def.id;
        return (
          <div key={b.def.id} className={`binder-tab-group ${isActive ? 'active' : ''}`}>
            <button
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(b.def.id);
                navigate(`/binders/${b.def.id}`);
              }}
              style={
                isActive
                  ? {
                      background: b.def.color,
                      borderColor: b.def.color,
                      // Mobile underline-tab style picks this up via CSS var.
                      ['--binder-color' as string]: b.def.color,
                    }
                  : {
                      borderLeftColor: b.def.color,
                      borderLeftWidth: 3,
                      ['--binder-color' as string]: b.def.color,
                    }
              }
            >
              <span className="tab-color-dot" aria-hidden style={{ background: b.def.color }} />
              <span className="tab-label">{b.def.name}</span>
              {b.def.mode === 'manual' && (
                <span className="tab-mode-badge" aria-label="Manual mode">
                  Manual
                </span>
              )}
              <span className="tab-count">{b.totalCards.toLocaleString()}</span>
            </button>

            {isActive && (
              <BinderOverflowMenu
                color={b.def.color}
                canMoveUp={idx > 0}
                canMoveDown={idx < sorted.length - 1}
                onMoveUp={() => moveBinder(b.def.id, 'up')}
                onMoveDown={() => moveBinder(b.def.id, 'down')}
                onEdit={() => setEditingBinder(b.def.id)}
                onDelete={() => handleDelete(b.def.id, b.def.name)}
              />
            )}
          </div>
        );
      })}

      <button
        className="tab tab-new"
        onClick={() => setEditingBinder('new')}
        title="Create a new binder"
      >
        + New binder
      </button>

      <button
        type="button"
        className="tab tab-export"
        onClick={() => setExportOpen(true)}
        disabled={binders.length === 0}
        title="Export this binder, all binders, or the full collection"
      >
        <DownloadIcon />
        <span>Export</span>
      </button>

      {binders.length > 1 && (
        <button
          type="button"
          className="tab tab-delete-all"
          onClick={handleDeleteAll}
          title="Delete every binder (cards are unaffected — they fall back to Uncategorized)"
        >
          <TrashIcon />
          <span>Delete all</span>
        </button>
      )}

      {exportOpen && (
        <BinderExportDialog
          binders={binders}
          activeId={activeTab}
          onClose={() => setExportOpen(false)}
        />
      )}

      {confirmDialog}
    </div>
  );
}

function BinderOverflowMenu({
  color,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  color: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // When the sheet is open on mobile it should claim the screen — locking
  // body scroll prevents the page underneath from scrolling on a swipe.
  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="binder-overflow" ref={ref}>
      <button
        type="button"
        className="binder-overflow-btn"
        style={{ borderColor: color }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Binder actions"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <>
          {/* On mobile this backdrop converts the panel into a bottom
              sheet. On desktop it's invisible and the panel renders as
              a normal dropdown attached to the trigger. */}
          <div className="binder-overflow-backdrop" onClick={() => setOpen(false)} aria-hidden />
          <div className="binder-overflow-panel" role="menu">
            <div className="binder-overflow-handle" aria-hidden />
            <button
              type="button"
              role="menuitem"
              className="binder-overflow-item"
              disabled={!canMoveUp}
              onClick={() => {
                setOpen(false);
                onMoveUp();
              }}
            >
              <ChevronUpIcon />
              <span>Move up</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="binder-overflow-item"
              disabled={!canMoveDown}
              onClick={() => {
                setOpen(false);
                onMoveDown();
              }}
            >
              <ChevronDownIcon />
              <span>Move down</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="binder-overflow-item"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              <PencilIcon />
              <span>Edit binder</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="binder-overflow-item binder-overflow-item--danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <CloseIcon />
              <span>Delete binder</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 10l4.5-4.5L12.5 10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 6l4.5 4.5L12.5 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11.3 2.7l2 2L5 13H3v-2l8.3-8.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 8.5a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 3v8M8 11l-3-3M8 11l3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
