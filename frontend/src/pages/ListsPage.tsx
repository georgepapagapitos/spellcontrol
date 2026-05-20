import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useConfirm } from '../lib/use-confirm';
import { ListEntriesView } from '../components/ListEntriesView';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../store/auth';

export function ListsPage() {
  const lists = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const renameList = useCollectionStore((s) => s.renameList);
  const deleteList = useCollectionStore((s) => s.deleteList);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const user = useAuth((s) => s.user);
  const [shareList, setShareList] = useState<{ id: string; name: string } | null>(null);

  const sorted = useMemo(() => [...lists].sort((a, b) => a.order - b.order), [lists]);
  const activeList = useMemo(
    () => (routeId ? lists.find((l) => l.id === routeId) : undefined),
    [lists, routeId]
  );

  const handleCreate = () => {
    const name = window.prompt('New list name')?.trim();
    if (!name) return;
    const id = createList(name);
    navigate(`/collection/lists/${id}`);
  };

  const handleRename = (id: string, current: string) => {
    const next = window.prompt('Rename list', current);
    if (next != null && next.trim()) renameList(id, next);
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: `This list and all of its entries will be removed. This cannot be undone.`,
      confirmLabel: 'Delete list',
      danger: true,
    });
    if (ok) deleteList(id);
  };

  // Per-list view: the real entries view (add via Scryfall search, the
  // "you own N" badge, inline edits, edit-printing, move-to-collection).
  if (routeId) {
    if (!activeList) {
      return (
        <div className="binders-index-page">
          <div className="empty-state">
            <p className="empty-state-tagline">List not found.</p>
            <div className="empty-state-actions">
              <Link to="/collection/lists" className="btn btn-primary">
                Back to lists
              </Link>
            </div>
          </div>
          {confirmDialog}
        </div>
      );
    }
    return <ListEntriesView list={activeList} />;
  }

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">Lists</h1>
          <p className="binder-hero-meta">
            {lists.length.toLocaleString()} {lists.length === 1 ? 'list' : 'lists'}
          </p>
        </div>
        <div className="binders-index-actions">
          <button type="button" className="pill-btn pill-btn-primary" onClick={handleCreate}>
            <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>New list</span>
          </button>
        </div>
      </header>

      {lists.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No lists yet.</p>
          <p className="empty-state-hint">
            Create a list to track cards you don’t own yet — a wishlist, buylist, deck plan, or
            trade pile. Lists never affect your collection, binders, or decks.
          </p>
          <div className="empty-state-actions">
            <button type="button" className="btn btn-primary" onClick={handleCreate}>
              Create your first list
            </button>
          </div>
        </div>
      ) : (
        <ul className="binders-index-list is-list">
          {sorted.map((l) => (
            <li key={l.id} className="binders-index-card">
              <Link to={`/collection/lists/${l.id}`} className="binders-index-card-link">
                <div className="binders-index-card-body">
                  <div className="binders-index-card-name">{l.name}</div>
                  <div className="binders-index-card-meta">
                    <span className="binders-index-card-cards">
                      {l.entries.length.toLocaleString()}{' '}
                      {l.entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                </div>
              </Link>
              <div className="binders-index-actions">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => handleRename(l.id, l.name)}
                >
                  Rename
                </button>
                {user && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setShareList({ id: l.id, name: l.name })}
                  >
                    Share
                  </button>
                )}
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => void handleDelete(l.id, l.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmDialog}
      {shareList && (
        <ShareDialog
          kind="list"
          resourceId={shareList.id}
          resourceLabel={shareList.name}
          onClose={() => setShareList(null)}
        />
      )}
    </div>
  );
}
