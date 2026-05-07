import { useCollectionStore } from '../store/collection';
import type { MaterializedBinder } from '../types';

interface Props {
  binders: MaterializedBinder[];
}

export function BinderTabs({ binders }: Props) {
  const activeTab = useCollectionStore((s) => s.activeTab);
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  const moveBinder = useCollectionStore((s) => s.moveBinder);
  const deleteBinder = useCollectionStore((s) => s.deleteBinder);

  const handleDelete = (id: string, name: string) => {
    if (
      !confirm(
        `Delete the binder "${name}"? Its cards will be re-routed through your other binders. Anything that does not match a remaining binder will only show up in the Collection view.`
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
    </div>
  );
}
