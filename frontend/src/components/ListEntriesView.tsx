import { Check, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ListDef, ListEntry } from '../types';
import { useCollectionStore } from '../store/collection';
import { ownedCountForEntry } from '../lib/lists';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { CardEditDialog, type PrintingSelection } from './CardEditDialog';

interface Props {
  list: ListDef;
}

const RESULT_LIMIT = 40;
const SEARCH_PAGE = 8;

function cardThumb(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

/**
 * Per-list detail view: a Scryfall search-and-add affordance (reusing the
 * shared rate-limited client, same call as InlineCardSearch) plus the list's
 * entries. Each entry is a printing reference the user does NOT own — rows
 * carry a passive "you own N" badge from the real collection, inline
 * quantity / note / target-price editors, an Edit-printing dialog, a
 * move-to-collection action, and a remove action. Deliberately does not
 * reuse CardListTable (entries are ListEntry, not EnrichedCard + copyId).
 */
export function ListEntriesView({ list }: Props) {
  const cards = useCollectionStore((s) => s.cards);
  const addListEntry = useCollectionStore((s) => s.addListEntry);
  const updateListEntry = useCollectionStore((s) => s.updateListEntry);
  const removeListEntry = useCollectionStore((s) => s.removeListEntry);
  const moveListEntryToCollection = useCollectionStore((s) => s.moveListEntryToCollection);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [visible, setVisible] = useState(SEARCH_PAGE);
  const [addedIds, setAddedIds] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<ListEntry | null>(null);
  const debounceRef = useRef<number | null>(null);

  const q = query.trim();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (q.length < 2) {
        if (!cancelled) {
          setResults([]);
          setSearchError(null);
          setSearching(false);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setSearching(true);
      setSearchError(null);
      try {
        const resp = await searchCards(q, [], { skipFormatFilter: true });
        if (!cancelled) {
          setResults(resp.data.slice(0, RESULT_LIMIT));
          setVisible(SEARCH_PAGE);
        }
      } catch (e) {
        if (!cancelled) {
          setSearchError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  const handleAdd = async (card: ScryfallCard) => {
    // Default to the latest printing Scryfall returns, nonfoil — same
    // quick-add behaviour as the collection's InlineCardSearch. The picked
    // printing can be changed afterward via "Edit printing".
    const enriched = scryfallToEnrichedCard(card, 'nonfoil');
    await addListEntry(list.id, enriched, 1);
    setAddedIds((prev) => ({ ...prev, [card.id]: (prev[card.id] ?? 0) + 1 }));
  };

  const entries = list.entries;

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    [entries]
  );

  const handleEditConfirm = (sel: PrintingSelection) => {
    if (!editing) return;
    void updateListEntry(list.id, editing.id, {
      scryfallId: sel.card.id,
      setCode: (sel.card.set || '').toUpperCase(),
      collectorNumber: sel.card.collector_number || '',
      finish: sel.finish,
    });
    setEditing(null);
  };

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">{list.name}</h1>
          <p className="binder-hero-meta">
            {list.kind ? `${list.kind} · ` : ''}
            {entries.length.toLocaleString()} {entries.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        <div className="binders-index-actions">
          <Link to="/lists" className="pill-btn">
            <span>Back to lists</span>
          </Link>
        </div>
      </header>

      <div className="list-add-search">
        <div className="list-add-search-field">
          <Search width={15} height={15} strokeWidth={1.8} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Scryfall to add a card…"
            aria-label="Search Scryfall to add a card"
          />
        </div>
        {q.length >= 2 && searching && (
          <p className="inline-card-search-status">Searching Scryfall…</p>
        )}
        {searchError && (
          <p className="inline-card-search-status inline-card-search-error">{searchError}</p>
        )}
        {q.length >= 2 && !searching && !searchError && results.length === 0 && (
          <p className="inline-card-search-status">No cards on Scryfall match “{q}”.</p>
        )}
        {results.length > 0 && (
          <ul className="inline-card-search-list" role="listbox" aria-label="Scryfall results">
            {results.slice(0, visible).map((c) => {
              const added = addedIds[c.id] ?? 0;
              return (
                <li key={c.id} className="inline-card-search-item">
                  <div className="inline-card-search-row">
                    <button
                      type="button"
                      className="inline-card-search-add"
                      aria-label={`Add ${c.name} to ${list.name}`}
                      onClick={() => void handleAdd(c)}
                    >
                      {added > 0 ? (
                        <Check width={12} height={12} strokeWidth={2.5} aria-hidden />
                      ) : (
                        <Plus width={12} height={12} strokeWidth={2.5} aria-hidden />
                      )}
                    </button>
                    {cardThumb(c) ? (
                      <img
                        src={cardThumb(c)}
                        alt=""
                        loading="lazy"
                        className="inline-card-search-thumb"
                      />
                    ) : (
                      <span
                        className="inline-card-search-thumb inline-card-search-thumb--ph"
                        aria-hidden
                      />
                    )}
                    <span className="inline-card-search-name">{c.name}</span>
                    <span className="inline-card-search-meta">
                      {added > 0 && (
                        <span className="inline-card-search-added">added ×{added}</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {results.length > visible && (
          <button
            type="button"
            className="inline-card-search-more"
            onClick={() => setVisible((v) => v + SEARCH_PAGE)}
          >
            Show {Math.min(SEARCH_PAGE, results.length - visible)} more · {results.length - visible}{' '}
            not shown
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No cards in this list yet.</p>
          <p className="empty-state-hint">
            Use the search above to add cards you don’t own yet. Lists never affect your collection,
            binders, or decks.
          </p>
        </div>
      ) : (
        <div className="collection-list" role="region" aria-label={`${list.name} entries`}>
          {sortedEntries.map((entry) => {
            const owned = ownedCountForEntry(entry, cards);
            return (
              <div key={entry.id} className="collection-list-row list-entry-row" role="row">
                {entry.scryfallId ? (
                  <img
                    src={`https://api.scryfall.com/cards/${entry.scryfallId}?format=image&version=small`}
                    alt=""
                    loading="lazy"
                    className="collection-list-thumb"
                  />
                ) : (
                  <div
                    className="collection-list-thumb collection-list-thumb-placeholder"
                    aria-hidden
                  />
                )}
                <div className="collection-list-main">
                  <div className="collection-list-name">
                    {entry.name}
                    {entry.finish !== 'nonfoil' && (
                      <span className="card-list-foil-tag">{entry.finish}</span>
                    )}
                    {owned > 0 && (
                      <span className="list-entry-owned" title={`You own ${owned} of this card`}>
                        own {owned}
                      </span>
                    )}
                  </div>
                  <div className="collection-list-meta">
                    <span className="card-list-set-code">{entry.setCode.toUpperCase()}</span>
                    <span className="card-list-cn">#{entry.collectorNumber}</span>
                  </div>
                  <div className="list-entry-controls">
                    <div className="list-entry-qty" role="group" aria-label="Quantity">
                      <button
                        type="button"
                        className="card-edit-qty-btn"
                        aria-label="Decrease quantity"
                        onClick={() =>
                          void updateListEntry(list.id, entry.id, {
                            quantity: Math.max(1, entry.quantity - 1),
                          })
                        }
                      >
                        −
                      </button>
                      <input
                        type="number"
                        className="card-edit-qty-input"
                        min={1}
                        max={99}
                        value={entry.quantity}
                        aria-label={`Quantity of ${entry.name}`}
                        onChange={(e) => {
                          const n = Math.floor(Number(e.target.value));
                          if (Number.isFinite(n)) {
                            void updateListEntry(list.id, entry.id, {
                              quantity: Math.max(1, Math.min(99, n)),
                            });
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="card-edit-qty-btn"
                        aria-label="Increase quantity"
                        onClick={() =>
                          void updateListEntry(list.id, entry.id, {
                            quantity: Math.min(99, entry.quantity + 1),
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                    <input
                      type="text"
                      className="list-entry-note"
                      placeholder="Note"
                      defaultValue={entry.note ?? ''}
                      aria-label={`Note for ${entry.name}`}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== (entry.note ?? '')) {
                          void updateListEntry(list.id, entry.id, { note: next });
                        }
                      }}
                    />
                    <label className="list-entry-target">
                      <span className="list-entry-target-label">Target $</span>
                      <input
                        type="number"
                        className="list-entry-target-input"
                        min={0}
                        step={0.01}
                        placeholder="—"
                        defaultValue={entry.targetPrice ?? ''}
                        aria-label={`Target price for ${entry.name}`}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const n = raw === '' ? 0 : Number(raw);
                          if (Number.isFinite(n) && n !== (entry.targetPrice ?? 0)) {
                            void updateListEntry(list.id, entry.id, {
                              targetPrice: Math.max(0, n),
                            });
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div className="collection-list-right list-entry-actions">
                  {entry.targetPrice != null && entry.targetPrice > 0 && (
                    <div className="collection-list-price">
                      target ${entry.targetPrice.toFixed(2)}
                    </div>
                  )}
                  <button type="button" className="btn-link" onClick={() => setEditing(entry)}>
                    Edit printing
                  </button>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => void moveListEntryToCollection(list.id, entry.id)}
                  >
                    Move to collection
                  </button>
                  <button
                    type="button"
                    className="btn-link btn-link-danger"
                    onClick={() => void removeListEntry(list.id, entry.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CardEditDialog
          cardName={editing.name}
          currentScryfallId={editing.scryfallId}
          currentFinish={editing.finish}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
