import { useCollectionStore } from '../store/collection';
import type { MaterializedBinder, UnbinnedBucket } from '../types';

interface Props {
  binders: MaterializedBinder[];
  unbinned: UnbinnedBucket;
}

export function BinderTabs({ binders, unbinned }: Props) {
  const { activeTab, setActiveTab, setEditingBinder, moveBinder, deleteBinder } =
    useCollectionStore();

  const handleDelete = (id: string, name: string) => {
    if (
      !confirm(
        `Delete the binder "${name}"? Its cards will be re-routed through your other binders (or fall into bulk if nothing else matches).`
      )
    )
      return;
    deleteBinder(id);
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
              <span className="tab-count">
                {b.totalCards} · {b.totalPages}pp
              </span>
            </button>

            {isActive && (
              <div className="tab-actions">
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
        className={`tab ${activeTab === 'unbinned' ? 'active' : ''}`}
        onClick={() => setActiveTab('unbinned')}
      >
        Bulk (unbinned)
        <span className="tab-count">
          {unbinned.totalCards} · {unbinned.totalPages}pp
        </span>
      </button>

      <button
        className="tab tab-new"
        onClick={() => setEditingBinder('new')}
        title="Create a new binder"
      >
        + New binder
      </button>
    </div>
  );
}
