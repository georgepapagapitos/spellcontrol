import { Check, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import { useSearchCards } from '../lib/use-search-cards';
import type { ListDef } from '../types';
import { SearchPill } from './SearchPill';
import { useCollectionStore } from '../store/collection';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { ListDetailView } from './ListDetailView';

interface Props {
  list: ListDef;
}

const RESULT_LIMIT = 40;
const SEARCH_PAGE = 8;

function cardThumb(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

/**
 * Per-list detail page: a Scryfall search-and-add affordance (the only way
 * cards enter a list — they're printings the user doesn't own) above the
 * filterable/sortable card table (`ListDetailView`), which reuses the same
 * filter dialog, sort, view toggle, rows and preview as the collection.
 */
export function ListEntriesView({ list }: Props) {
  const addListEntry = useCollectionStore((s) => s.addListEntry);

  const [query, setQuery] = useState('');
  const q = query.trim();
  const [visible, setVisible] = useState(SEARCH_PAGE);
  const [addedIds, setAddedIds] = useState<Record<string, number>>({});

  const { results, loading: searching, error: searchError } = useSearchCards(query, RESULT_LIMIT);

  // Reset progressive-reveal window when new results arrive. Defer to a
  // microtask to avoid synchronous setState inside an effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    void Promise.resolve().then(() => setVisible(SEARCH_PAGE));
  }, [results]);

  const handleAdd = async (card: ScryfallCard) => {
    // Default to the latest printing Scryfall returns, nonfoil — same
    // quick-add behaviour as the collection's InlineCardSearch. The picked
    // printing can be changed afterward via the row's "Edit printing".
    const enriched = scryfallToEnrichedCard(card, 'nonfoil');
    await addListEntry(list.id, enriched, 1);
    setAddedIds((prev) => ({ ...prev, [card.id]: (prev[card.id] ?? 0) + 1 }));
  };

  const entries = list.entries;

  return (
    <div className="binders-index-page">
      <header className="binder-hero binders-index-hero">
        <div className="binders-index-hero-text">
          <h1 className="binder-hero-name">{list.name}</h1>
          <p className="binder-hero-meta">
            {entries.length.toLocaleString()} {entries.length === 1 ? 'card' : 'cards'}
          </p>
        </div>
        <div className="binders-index-actions">
          <Link to="/collection/lists" className="pill-btn">
            <span>Back to lists</span>
          </Link>
        </div>
      </header>

      <div className="list-add-search">
        <SearchPill
          value={query}
          onChange={setQuery}
          placeholder="Search Scryfall to add a card…"
          ariaLabel="Search Scryfall to add a card"
        />
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
        <ListDetailView list={list} />
      )}
    </div>
  );
}
