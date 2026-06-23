import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ListDef } from '../types';
import { ListDetailView } from './ListDetailView';
import { ListAddCardSheet } from './ListAddCardSheet';

interface Props {
  list: ListDef;
}

/**
 * Per-list detail page. The card table (`ListDetailView`) reuses the
 * collection's filter dialog, sort, view toggle, rows, preview — and its
 * inline "Search Scryfall to add" affordance (the list search doubles as the
 * add query). An explicit "Add card" button opens that same search-and-add
 * flow in a sheet, so adding works even on an empty list.
 */
export function ListEntriesView({ list }: Props) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">{list.name}</h1>
          <p className="binder-hero-meta">
            {list.entries.length.toLocaleString()} {list.entries.length === 1 ? 'card' : 'cards'}
          </p>
        </div>
        <div className="binders-index-actions">
          <Link to="/collection/lists" className="pill-btn">
            <span>Back to lists</span>
          </Link>
          <button
            type="button"
            className="pill-btn pill-btn-primary"
            onClick={() => setAddOpen(true)}
          >
            <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Add card</span>
          </button>
        </div>
      </header>

      <ListDetailView list={list} />

      {addOpen && <ListAddCardSheet list={list} onClose={() => setAddOpen(false)} />}
    </div>
  );
}
