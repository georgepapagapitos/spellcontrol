import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { searchCards, getCardByName } from '@/deck-builder/services/scryfall/client';
import { ManaCost } from '../ManaCost';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../../lib/allocations';
import type { EnrichedCard } from '../../types';

export interface AddCardChoice {
  card: ScryfallCard;
  /** copyId of the collection copy claimed for this slot, or null if none. */
  allocatedCopyId: string | null;
}

export interface CardSearchPanelHandle {
  focusInput(): void;
}

interface Props {
  deckId: string;
  commanderColorIdentity: string[];
  /**
   * Quantity of each card name already in this deck. Drives the "in deck × N"
   * hint and lets the panel hint that a duplicate add is intentional (e.g. for
   * basic lands).
   */
  existingCardCounts: Map<string, number>;
  onAdd: (choice: AddCardChoice) => void;
  /** Called when the user dismisses the panel via Escape. */
  onClose?: () => void;
}

type Mode = 'collection' | 'scryfall';

export const CardSearchPanel = forwardRef<CardSearchPanelHandle, Props>(function CardSearchPanel(
  { deckId, commanderColorIdentity, existingCardCounts, onAdd, onClose },
  ref
) {
  const [mode, setMode] = useState<Mode>('collection');
  const [query, setQuery] = useState('');
  const [announce, setAnnounce] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // The two result lists publish their currently-visible cards here so the
  // panel-level "Enter to add the first result" handler is independent of
  // which tab is active.
  const visibleResultsRef = useRef<ScryfallCard[]>([]);
  const addCurrentRef = useRef<((index: number) => Promise<void> | void) | null>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  // Auto-focus on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Resetting the active row when query/tab changes keeps "Enter adds the
  // top result" predictable.
  const [prevQueryMode, setPrevQueryMode] = useState({ query, mode });
  if (prevQueryMode.query !== query || prevQueryMode.mode !== mode) {
    setPrevQueryMode({ query, mode });
    setActiveIndex(0);
  }

  const handleAnnounce = (msg: string) => {
    // Cycle the live region by emptying first; some screen readers ignore
    // re-announcements of the same string.
    setAnnounce('');
    window.setTimeout(() => setAnnounce(msg), 30);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const max = visibleResultsRef.current.length;
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
      } else {
        onClose?.();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      if (max === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(max - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      if (max === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      if (max === 0) return;
      e.preventDefault();
      const idx = Math.min(activeIndex, max - 1);
      addCurrentRef.current?.(idx);
    }
  };

  return (
    <div className="card-search-panel">
      <div className="card-search-tabs" role="tablist" aria-label="Card source">
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
        ref={inputRef}
        type="search"
        className="card-search-input"
        placeholder={mode === 'collection' ? 'Search your collection…' : 'Search all of Scryfall…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={mode === 'collection' ? 'Search your collection' : 'Search Scryfall'}
        aria-controls="card-search-results"
        aria-activedescendant={visibleCount > 0 ? `card-search-result-${activeIndex}` : undefined}
      />
      <p className="card-search-hint" aria-hidden>
        ↑ ↓ to navigate · Enter to add · Esc to close
      </p>

      {mode === 'collection' ? (
        <CollectionResults
          deckId={deckId}
          colorIdentity={commanderColorIdentity}
          existingCardCounts={existingCardCounts}
          query={query}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          onAdd={onAdd}
          onAnnounce={handleAnnounce}
          publishVisible={(cards, addAt) => {
            visibleResultsRef.current = cards;
            addCurrentRef.current = addAt;
            setVisibleCount(cards.length);
          }}
        />
      ) : (
        <ScryfallResults
          deckId={deckId}
          colorIdentity={commanderColorIdentity}
          existingCardCounts={existingCardCounts}
          query={query}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          onAdd={onAdd}
          onAnnounce={handleAnnounce}
          publishVisible={(cards, addAt) => {
            visibleResultsRef.current = cards;
            addCurrentRef.current = addAt;
            setVisibleCount(cards.length);
          }}
        />
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
});

interface ResultsProps {
  deckId: string;
  colorIdentity: string[];
  existingCardCounts: Map<string, number>;
  query: string;
  activeIndex: number;
  onActiveChange: (i: number) => void;
  onAdd: (choice: AddCardChoice) => void;
  onAnnounce: (msg: string) => void;
  publishVisible: (cards: ScryfallCard[], addAt: (index: number) => Promise<void> | void) => void;
}

// ── Collection results ───────────────────────────────────────────────────
function CollectionResults({
  deckId,
  colorIdentity,
  existingCardCounts,
  query,
  activeIndex,
  onActiveChange,
  onAdd,
  onAnnounce,
  publishVisible,
}: ResultsProps) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seenNames = new Set<string>();
    const out: EnrichedCard[] = [];
    for (const c of collection) {
      const ci = c.colorIdentity ?? [];
      if (!ci.every((k) => colorIdentity.includes(k))) continue;
      const legality = c.legalities?.commander;
      if (legality && legality !== 'legal' && legality !== 'restricted') continue;
      if (q && !c.name.toLowerCase().includes(q)) continue;
      if (seenNames.has(c.name)) continue;
      seenNames.add(c.name);
      out.push(c);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out.slice(0, 200);
  }, [collection, colorIdentity, query]);

  const addAtIndex = async (index: number) => {
    const c = filtered[index];
    if (!c) return;
    const full = await getCardByName(c.name).catch(() => null);
    if (!full) return;
    const claim = pickCollectionCopy(c.name, collection, allocations, c.scryfallId);
    onAdd({ card: full, allocatedCopyId: claim?.copyId ?? null });
    onAnnounce(`Added ${c.name}`);
  };

  // Publish visible results so the parent's Enter handler can add the
  // currently-active row. We can't drive the parent input from here directly,
  // so we hand it a closure.
  useEffect(() => {
    // Convert EnrichedCards to a thin ScryfallCard-ish list; we only need the
    // length / order on the parent side.
    publishVisible(
      filtered.map((c) => ({ name: c.name }) as unknown as ScryfallCard),
      addAtIndex
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

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
    <ul className="card-search-results" id="card-search-results" role="listbox">
      {filtered.map((c, i) => {
        const ownedCount = collection.filter((x) => x.name === c.name).length;
        const inDeck = existingCardCounts.get(c.name) ?? 0;
        const active = i === activeIndex;
        return (
          <li
            key={c.scryfallId}
            id={`card-search-result-${i}`}
            role="option"
            aria-selected={active}
            className={`card-search-row${active ? ' active' : ''}`}
            onMouseEnter={() => onActiveChange(i)}
          >
            <button
              type="button"
              className="card-search-add"
              aria-label={inDeck > 0 ? `Add another ${c.name}` : `Add ${c.name}`}
              onClick={() => addAtIndex(i)}
            >
              +
            </button>
            <span className="card-search-name">{c.name}</span>
            {c.manaCost && <ManaCost cost={c.manaCost} className="card-search-mana" />}
            <span className="card-search-meta">
              owned {ownedCount}
              {inDeck > 0 && (
                <>
                  {' · '}
                  <span className="card-search-indeck">in deck × {inDeck}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );

  void deckId;
}

// ── Scryfall results ─────────────────────────────────────────────────────
function ScryfallResults({
  deckId,
  colorIdentity,
  existingCardCounts,
  query,
  activeIndex,
  onActiveChange,
  onAdd,
  onAnnounce,
  publishVisible,
}: ResultsProps) {
  const collection = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  const allocations = useMemo(() => buildAllocationMap(decks), [decks]);
  const ownedNames = useMemo(() => new Set(collection.map((c) => c.name)), [collection]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setError(null);
          setResults([]);
        }
        return;
      }
      if (debounce.current) window.clearTimeout(debounce.current);
      await new Promise<void>((resolve) => {
        debounce.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await searchCards(q, colorIdentity);
        if (!cancelled) setResults(resp.data.slice(0, 60));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query, colorIdentity]);

  const addAtIndex = (index: number) => {
    const c = results[index];
    if (!c) return;
    const owned = ownedNames.has(c.name);
    const claim = owned ? pickCollectionCopy(c.name, collection, allocations, c.id) : null;
    onAdd({ card: c, allocatedCopyId: claim?.copyId ?? null });
    onAnnounce(`Added ${c.name}`);
  };

  useEffect(() => {
    publishVisible(results, addAtIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

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
    <ul className="card-search-results" id="card-search-results" role="listbox">
      {results.map((c, i) => {
        const inDeck = existingCardCounts.get(c.name) ?? 0;
        const owned = ownedNames.has(c.name);
        const active = i === activeIndex;
        return (
          <li
            key={c.id}
            id={`card-search-result-${i}`}
            role="option"
            aria-selected={active}
            className={`card-search-row${active ? ' active' : ''}`}
            onMouseEnter={() => onActiveChange(i)}
          >
            <button
              type="button"
              className="card-search-add"
              aria-label={inDeck > 0 ? `Add another ${c.name}` : `Add ${c.name}`}
              onClick={() => addAtIndex(i)}
            >
              +
            </button>
            <span className="card-search-name">{c.name}</span>
            {c.mana_cost && <ManaCost cost={c.mana_cost} className="card-search-mana" />}
            <span className="card-search-meta">
              {owned ? 'owned' : 'not owned'}
              {inDeck > 0 && (
                <>
                  {' · '}
                  <span className="card-search-indeck">in deck × {inDeck}</span>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );

  void deckId;
}
