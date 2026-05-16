import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import { fetchPrintings } from '../lib/api';
import { ManaCost } from './ManaCost';
import { useCollectionStore } from '../store/collection';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';

interface Props {
  /** Seed query — the collection search term that returned no results. */
  initialQuery: string;
}

const RESULT_LIMIT = 40;
const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched',
};

function priceForFinish(card: ScryfallCard, finish: Finish): number {
  const p = card.prices;
  if (!p) return 0;
  const raw = finish === 'foil' ? p.usd_foil : finish === 'etched' ? p.usd_etched : p.usd;
  return raw ? Number(raw) || 0 : 0;
}

function fmtPrice(n: number): string {
  return n > 0 ? `$${n.toFixed(2)}` : '—';
}

function cardFinishes(card: ScryfallCard): Finish[] {
  const all = (card.finishes ?? ['nonfoil']).filter(
    (f): f is Finish => f === 'nonfoil' || f === 'foil' || f === 'etched'
  );
  return all.length > 0 ? all : ['nonfoil'];
}

/**
 * Inline live Scryfall search shown in the collection's no-results state.
 * Quick-add uses the printing Scryfall returns (nonfoil) — same as the
 * top-level Add card button. The per-row "Printings" disclosure lazily
 * loads every printing so a specific set + finish can be chosen without
 * leaving the page. All network goes through the shared rate-limited,
 * cached Scryfall client.
 */
export function InlineCardSearch({ initialQuery }: Props) {
  const addCard = useCollectionStore((s) => s.addCard);
  const collection = useCollectionStore((s) => s.cards);

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // How many copies the user added this session, keyed by scryfall id, so
  // the row can confirm the action without re-deriving from the collection.
  const [addedCounts, setAddedCounts] = useState<Record<string, number>>({});
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setResults([]);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      await new Promise<void>((resolve) => {
        debounceRef.current = window.setTimeout(resolve, 300);
      });
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await searchCards(q, [], { skipFormatFilter: true });
        if (!cancelled) {
          setResults(resp.data.slice(0, RESULT_LIMIT));
          setActiveIndex(0);
          setExpandedId(null);
        }
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
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const ownedCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of collection) {
      const k = c.name.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [collection]);

  const confirm = (id: string) =>
    setAddedCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));

  const quickAdd = async (card: ScryfallCard) => {
    await addCard(card);
    confirm(card.id);
  };

  const addPrinting = async (card: ScryfallCard, finish: Finish) => {
    await addCard(card, finish);
    confirm(card.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const card = results[Math.min(activeIndex, results.length - 1)];
      if (card) void quickAdd(card);
    }
  };

  const q = query.trim();

  return (
    <div className="inline-card-search">
      <input
        ref={inputRef}
        type="search"
        className="inline-card-search-input"
        placeholder="Search Scryfall by card name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Search Scryfall to add a card"
      />

      {q.length < 2 && <p className="inline-card-search-status">Type at least two characters.</p>}
      {q.length >= 2 && loading && <p className="inline-card-search-status">Searching Scryfall…</p>}
      {error && <p className="inline-card-search-status inline-card-search-error">{error}</p>}
      {q.length >= 2 && !loading && !error && results.length === 0 && (
        <p className="inline-card-search-status">No cards on Scryfall match “{q}”.</p>
      )}

      {results.length > 0 && (
        <ul className="inline-card-search-list" role="listbox" aria-label="Scryfall results">
          {results.map((c, i) => {
            const owned = ownedCounts.get(c.name.toLowerCase()) ?? 0;
            const added = addedCounts[c.id] ?? 0;
            const active = i === activeIndex;
            const expanded = expandedId === c.id;
            const finishes = cardFinishes(c);
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={active}
                className={`inline-card-search-item${active ? ' is-active' : ''}`}
              >
                <div className="inline-card-search-row" onMouseEnter={() => setActiveIndex(i)}>
                  <button
                    type="button"
                    className="inline-card-search-add"
                    aria-label={`Add ${c.name}`}
                    onClick={() => void quickAdd(c)}
                  >
                    {added > 0 ? (
                      <Check width={12} height={12} strokeWidth={2.5} aria-hidden />
                    ) : (
                      <Plus width={12} height={12} strokeWidth={2.5} aria-hidden />
                    )}
                  </button>
                  <span className="inline-card-search-name">{c.name}</span>
                  {c.mana_cost && (
                    <ManaCost cost={c.mana_cost} className="inline-card-search-mana" />
                  )}
                  <span className="inline-card-search-meta">
                    {added > 0 && <span className="inline-card-search-added">added ×{added}</span>}
                    {owned > 0 && (
                      <span className="inline-card-search-owned">in collection ×{owned}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className={`inline-card-search-printings-toggle${expanded ? ' is-open' : ''}`}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                  >
                    {expanded ? (
                      <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
                    ) : (
                      <ChevronRight width={12} height={12} strokeWidth={2} aria-hidden />
                    )}
                    {finishes.length > 1 ? 'Printing & finish' : 'Printing'}
                  </button>
                </div>
                {expanded && (
                  <PrintingPicker
                    cardName={c.name}
                    fallback={c}
                    onAdd={(printing, finish) => void addPrinting(printing, finish)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PrintingPicker({
  cardName,
  fallback,
  onAdd,
}: {
  cardName: string;
  fallback: ScryfallCard;
  onAdd: (printing: ScryfallCard, finish: Finish) => void;
}) {
  const [printings, setPrintings] = useState<ScryfallCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(fallback.id);
  const [finish, setFinish] = useState<Finish>('nonfoil');

  // cardName is fixed for this picker's lifetime (a different row mounts a
  // fresh picker), so the initial loading/error state is correct and we
  // never need to reset synchronously inside the effect.
  useEffect(() => {
    let cancelled = false;
    fetchPrintings(cardName)
      .then((ps) => {
        if (cancelled) return;
        const list = ps.length > 0 ? ps : [fallback];
        setPrintings(list);
        setSelectedId(list.some((p) => p.id === fallback.id) ? fallback.id : list[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load printings');
        setPrintings([fallback]);
        setSelectedId(fallback.id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardName, fallback]);

  const selected = printings?.find((p) => p.id === selectedId) ?? null;
  const finishes = useMemo<Finish[]>(
    () => (selected ? cardFinishes(selected) : ['nonfoil']),
    [selected]
  );
  // The user's explicit pick may not exist on a newly selected printing —
  // fall back to its first finish without an effect (no flicker, no
  // set-state-in-effect).
  const effectiveFinish: Finish = finishes.includes(finish) ? finish : finishes[0];

  return (
    <div className="inline-card-search-printings">
      {loading && <p className="inline-card-search-status">Loading printings…</p>}
      {error && <p className="inline-card-search-status inline-card-search-error">{error}</p>}
      {printings && (
        <>
          <ul className="inline-card-search-printing-list" role="listbox" aria-label="Printings">
            {printings.map((p) => {
              const isSel = p.id === selectedId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    className={`inline-card-search-printing${isSel ? ' is-selected' : ''}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="inline-card-search-printing-set">
                      {p.set.toUpperCase()} #{p.collector_number}
                    </span>
                    <span className="inline-card-search-printing-set-name">{p.set_name}</span>
                    <span className="inline-card-search-printing-price">
                      {fmtPrice(priceForFinish(p, 'nonfoil') || priceForFinish(p, 'foil'))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && (
            <div className="inline-card-search-finish-bar">
              <div className="inline-card-search-finishes" role="group" aria-label="Finish">
                {finishes.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`inline-card-search-finish${
                      effectiveFinish === f ? ' is-active' : ''
                    }`}
                    aria-pressed={effectiveFinish === f}
                    onClick={() => setFinish(f)}
                  >
                    {FINISH_LABEL[f]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="inline-card-search-add-printing"
                onClick={() => onAdd(selected, effectiveFinish)}
              >
                Add {selected.set.toUpperCase()} #{selected.collector_number} ·{' '}
                {FINISH_LABEL[effectiveFinish]} ·{' '}
                {fmtPrice(priceForFinish(selected, effectiveFinish))}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
