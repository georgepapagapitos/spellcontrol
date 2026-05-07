import { useState } from 'react';
import { useCollectionStore } from '../store/collection';
import type { MaterializedBinder } from '../types';
import { BinderExportDialog } from './BinderExportDialog';
import { useConfirm } from '../lib/use-confirm';

interface Props {
  binders: MaterializedBinder[];
}

export function BinderTabs({ binders }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
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
              onClick={() => setActiveTab(b.def.id)}
              style={
                isActive
                  ? { background: b.def.color, borderColor: b.def.color }
                  : { borderLeftColor: b.def.color, borderLeftWidth: 3 }
              }
            >
              {b.def.name}
              <span className="tab-count">{b.totalCards.toLocaleString()}</span>
            </button>

            {isActive && (
              <div className="tab-actions" style={{ borderColor: b.def.color }}>
                <button
                  className="tab-action"
                  onClick={() => moveBinder(b.def.id, 'up')}
                  disabled={idx === 0}
                  title="Move up (higher priority)"
                >
                  ▲
                </button>
                <button
                  className="tab-action"
                  onClick={() => moveBinder(b.def.id, 'down')}
                  disabled={idx === sorted.length - 1}
                  title="Move down (lower priority)"
                >
                  ▼
                </button>
                <button
                  className="tab-action"
                  onClick={() => setEditingBinder(b.def.id)}
                  title="Edit binder"
                >
                  ✎
                </button>
                <button
                  className="tab-action danger"
                  onClick={() => handleDelete(b.def.id, b.def.name)}
                  title="Delete binder"
                >
                  ✕
                </button>
              </div>
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
