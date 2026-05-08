import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { searchCards, getCardByName } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from '../ManaCost';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import type { EnrichedCard } from '../../types';

export interface AddCardChoice {
  card: ScryfallCard;
  /** scryfallId of the collection copy claimed for this slot, or null if none. */
  allocatedScryfallId: string | null;
}

interface Props {
  deckId: string;
  commanderColorIdentity: string[];
  /** Names already in this deck — surfaced as "in deck" badges and used to pre-claim collection copies. */
  existingCardNames: Set<string>;
  onAdd: (choice: AddCardChoice) => void;
}

type Mode = 'collection' | 'scryfall';

export function CardSearchPanel({
  deckId,
  commanderColorIdentity,
  existingCardNames,
  onAdd,
}: Props) {
  const [mode, setMode] = useState<Mode>('collection');
  const [query, setQuery] = useState('');

  return (
    <div className="card-search-panel">
      <div className="card-search-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'collection'}
          className={`card-search-tab${mode === 'collection' ? ' active' : ''}`}
          onClick={() => setMode('collection')}
        >
          My collection
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'scryfall'}
          className={`card-search-tab${mode === 'scryfall' ? ' active' : ''}`}
          onClick={() => setMode('scryfall')}
        >
          Scryfall
        </button>
      </div>

      <input
        type="search"
        className="card-search-input"
        placeholder={mode === 'collection' ? 'Search your collection…' : 'Search all of Scryfall…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {mode === 'collection' ? (
        <CollectionResults
          deckId={deckId}
          colorIdentity={commanderColorIdentity}
          existingCardNames={existingCardNames}
          query={query}
          onAdd={onAdd}
        />
      ) : (
        <ScryfallResults
          deckId={deckId}
          colorIdentity={commanderColorIdentity}
          existingCardNames={existingCardNames}
          query={query}
          onAdd={onAdd}
        />
      )}
    </div>
  );
}

// ── Collection results ───────────────────────────────────────────────────
function CollectionResults({
  deckId,
  colorIdentity,
  existingCardNames,
  query,
  onAdd,
}: {
  deckId: string;
  colorIdentity: string[];
  existingCardNames: Set<string>;
  query: string;
  onAdd: (choice: AddCardChoice) => void;
}) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seenNames = new Set<string>();
    const out: EnrichedCard[] = [];
    for (const c of collection) {
      // Color identity must be a subset of the commander's identity.
      const ci = c.colorIdentity ?? [];
      if (!ci.every((k) => colorIdentity.includes(k))) continue;
      // Commander legality (when known).
      const legality = c.legalities?.commander;
      if (legality && legality !== 'legal' && legality !== 'restricted') continue;
      // Name match.
      if (q && !c.name.toLowerCase().includes(q)) continue;
      // Group by name — only the first occurrence is shown; we record the
      // count so the row can show "owned: 3".
      if (seenNames.has(c.name)) continue;
      seenNames.add(c.name);
      out.push(c);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 200);
  }, [collection, colorIdentity, query]);

  if (collection.length === 0) {
    return (
      <p className="card-search-empty">
        Your collection is empty. Import cards on the Collection page first.
      </p>
    );
  }
  if (filtered.length === 0) {
    return <p className="card-search-empty">No matches in your collection.</p>;
  }

  return (
    <ul className="card-search-results">
      {filtered.map((c) => {
        const ownedCount = collection.filter((x) => x.name === c.name).length;
        const inDeck = existingCardNames.has(c.name);
        return (
          <li key={c.scryfallId} className="card-search-row">
            <button
              type="button"
              className="card-search-add"
              aria-label={`Add ${c.name}`}
              onClick={async () => {
                const full = await getCardByName(c.name).catch(() => null);
                if (!full) return;
                const claim = pickCollectionCopy(c.name, collection, allocations);
                onAdd({ card: full, allocatedScryfallId: claim?.scryfallId ?? null });
              }}
            >
              +
            </button>
            <span className="card-search-name">{c.name}</span>
            {c.manaCost && <ManaCost cost={c.manaCost} className="card-search-mana" />}
            <span className="card-search-meta">
              owned: {ownedCount}
              {inDeck ? ' · in deck' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );

  // Suppress unused-import lint for deckId — we keep it in the API for symmetry
  // with ScryfallResults and to support future per-deck behavior (e.g. recent
  // adds). React-style noop.
  void deckId;
}

// ── Scryfall results ─────────────────────────────────────────────────────
function ScryfallResults({
  deckId,
  colorIdentity,
  existingCardNames,
  query,
  onAdd,
}: {
  deckId: string;
  colorIdentity: string[];
  existingCardNames: Set<string>;
  query: string;
  onAdd: (choice: AddCardChoice) => void;
}) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);
  const ownedNames = useMemo(() => new Set(collection.map((c) => c.name)), [collection]);

  useEffect(() => {
    setError(null);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        // searchCards adds the color-identity + commander-legality filters
        // for us — we just pass the user-typed text.
        const resp = await searchCards(q, colorIdentity);
        setResults(resp.data.slice(0, 60));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query, colorIdentity]);

  if (query.trim().length < 2) {
    return <p className="card-search-empty">Type at least two characters to search Scryfall.</p>;
  }
  if (loading) {
    return <p className="card-search-empty">Searching…</p>;
  }
  if (error) {
    return <p className="card-search-empty card-search-error">{error}</p>;
  }
  if (results.length === 0) {
    return <p className="card-search-empty">No matches.</p>;
  }

  return (
    <ul className="card-search-results">
      {results.map((c) => {
        const inDeck = existingCardNames.has(c.name);
        const owned = ownedNames.has(c.name);
        return (
          <li key={c.id} className="card-search-row">
            <button
              type="button"
              className="card-search-add"
              aria-label={`Add ${c.name}`}
              onClick={() => {
                const claim = owned ? pickCollectionCopy(c.name, collection, allocations) : null;
                onAdd({ card: c, allocatedScryfallId: claim?.scryfallId ?? null });
              }}
            >
              +
            </button>
            <span className="card-search-name">{c.name}</span>
            {c.mana_cost && <ManaCost cost={c.mana_cost} className="card-search-mana" />}
            <span className="card-search-meta">
              {owned ? 'owned' : 'not owned'}
              {inDeck ? ' · in deck' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );

  void deckId;
}
