import { AlignJustify, List as ListIconLucide, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { useCollectionStore } from '../store/collection';
import { useConfirm } from '../lib/use-confirm';
import { useStoredSort } from '../lib/use-stored-sort';
import { useStoredView } from '../lib/use-stored-view';
import { useDebouncedValue } from '../lib/use-debounced-value';
import { SelectMenu, type SelectOption } from '../components/SelectMenu';
import { SortDirArrow } from '../components/SortDirArrow';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchPill } from '../components/SearchPill';
import { OverflowMenu } from '../components/OverflowMenu';
import { ListEntriesView } from '../components/ListEntriesView';
import { ShareDialog } from '../components/ShareDialog';
import { NameInputDialog } from '../components/NameInputDialog';

type ListSortField = 'order' | 'name' | 'entries';
type SortDir = 'asc' | 'desc';
// Lists have no per-item color, so the binder/deck "grid" tile (a colored
// banner you skim to tell items apart) would render as identical accent
// banners. Only the two density-distinct row layouts are meaningful here.
type ListsViewMode = 'list' | 'compact';

const SORT_OPTIONS: SelectOption<ListSortField>[] = [
  { value: 'order', label: 'Order' },
  { value: 'name', label: 'Name' },
  { value: 'entries', label: 'Entry count' },
];

const SORT_DEFAULT_DIR: Record<ListSortField, SortDir> = {
  order: 'asc',
  name: 'asc',
  entries: 'desc',
};

export function ListsPage() {
  const lists = useCollectionStore((s) => s.lists);
  const createList = useCollectionStore((s) => s.createList);
  const renameList = useCollectionStore((s) => s.renameList);
  const deleteList = useCollectionStore((s) => s.deleteList);
  const deleteAllLists = useCollectionStore((s) => s.deleteAllLists);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const [shareList, setShareList] = useState<{ id: string; name: string } | null>(null);
  // Drives the create/rename name dialogs. `rename` carries the target list.
  const [nameDialog, setNameDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; id: string; current: string } | null
  >(null);

  const { sortField, sortDir, toggleSort } = useStoredSort<ListSortField>(
    'lists-index-sort',
    SORT_DEFAULT_DIR,
    'order'
  );
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const [view, setView] = useStoredView<ListsViewMode>(
    'mtg-lists-view-mode',
    ['list', 'compact'],
    'list'
  );

  const sorted = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = q ? lists.filter((l) => l.name.toLowerCase().includes(q)) : lists;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'order':
          cmp = a.order - b.order;
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'entries':
          cmp = a.entries.length - b.entries.length;
          break;
      }
      if (cmp === 0) cmp = a.order - b.order;
      return cmp * dirMul;
    });
  }, [lists, sortField, sortDir, debouncedSearch]);

  const activeList = useMemo(
    () => (routeId ? lists.find((l) => l.id === routeId) : undefined),
    [lists, routeId]
  );

  // Warm the card cache for every list's entries while the index is shown, so
  // opening a list resolves its cards (name → card data) from cache instead of
  // a cold network round-trip. getCardsByNames dedups + caches per card, so
  // this is idempotent and cheap to re-run.
  // ponytail: prefetches all lists up front; lists are small wishlists so this
  // is fine — switch to visible-only / on-hover prefetch if a user keeps huge lists.
  const prefetchKey = useMemo(
    () => lists.flatMap((l) => l.entries.map((e) => e.name)).join('|'),
    [lists]
  );
  useEffect(() => {
    if (routeId || !prefetchKey) return;
    const names = [...new Set(prefetchKey.split('|').filter(Boolean))];
    if (names.length) void getCardsByNames(names).catch(() => {});
  }, [routeId, prefetchKey]);

  const handleCreate = () => setNameDialog({ mode: 'create' });

  const handleRename = (id: string, current: string) =>
    setNameDialog({ mode: 'rename', id, current });

  const submitName = (name: string) => {
    if (!nameDialog) return;
    if (nameDialog.mode === 'create') {
      const id = createList(name);
      navigate(`/collection/lists/${id}`);
    } else {
      renameList(nameDialog.id, name);
    }
    setNameDialog(null);
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

  const handleDeleteAll = async () => {
    const ok = await confirm({
      title: `Delete all ${lists.length} lists?`,
      body: `Every list and all of its entries will be removed. This cannot be undone.`,
      confirmLabel: 'Delete all lists',
      danger: true,
    });
    if (ok) deleteAllLists();
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

      {lists.length > 0 && (
        <div className="binders-index-search-row">
          <SearchPill
            value={search}
            onChange={setSearch}
            placeholder="Search lists"
            ariaLabel="Search lists"
          />
        </div>
      )}

      {lists.length > 0 && (
        <div className="binders-index-sort-bar">
          {lists.length > 1 && (
            <SelectMenu
              value={sortField}
              options={SORT_OPTIONS}
              onChange={toggleSort}
              ariaLabel="Sort lists by"
              closeOnSelect={false}
              leadingIcon={<SortDirArrow dir={sortDir} />}
              renderItemPrefix={(_opt, active) => (active ? <SortDirArrow dir={sortDir} /> : null)}
            />
          )}
          <ViewModeToggle<ListsViewMode>
            ariaLabel="Lists view mode"
            className="binders-index-viewmode"
            value={view}
            onChange={setView}
            options={[
              {
                value: 'list',
                label: 'List view',
                icon: <ListIconLucide width={14} height={14} strokeWidth={2} aria-hidden />,
              },
              {
                value: 'compact',
                label: 'Compact list (text only)',
                icon: <AlignJustify width={14} height={14} strokeWidth={2} aria-hidden />,
              },
            ]}
          />
        </div>
      )}

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
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No lists match “{search.trim()}”.</p>
        </div>
      ) : (
        <ul className={`binders-index-list is-${view}`}>
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
              <OverflowMenu
                className="binders-index-card-menu"
                triggerClassName="binders-index-card-menu-btn"
                ariaLabel={`Actions for ${l.name}`}
                items={[
                  { label: 'Rename', icon: Pencil, onClick: () => handleRename(l.id, l.name) },
                  {
                    label: 'Share',
                    icon: Share2,
                    onClick: () => setShareList({ id: l.id, name: l.name }),
                  },
                  {
                    label: 'Delete',
                    icon: Trash2,
                    danger: true,
                    onClick: () => void handleDelete(l.id, l.name),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      {lists.length > 1 && (
        <div className="binders-index-danger">
          <button
            type="button"
            className="btn-link binders-index-danger-btn"
            onClick={() => void handleDeleteAll()}
          >
            Delete all lists
          </button>
        </div>
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
      {nameDialog && (
        <NameInputDialog
          title={nameDialog.mode === 'create' ? 'New list' : 'Rename list'}
          label="List name"
          placeholder="e.g. Wishlist, Trade pile"
          initialValue={nameDialog.mode === 'rename' ? nameDialog.current : ''}
          confirmLabel={nameDialog.mode === 'create' ? 'Create list' : 'Rename'}
          onSubmit={submitName}
          onCancel={() => setNameDialog(null)}
        />
      )}
    </div>
  );
}
