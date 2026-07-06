import { useEffect, useRef, useState, type JSX } from 'react';
import { Search, X } from 'lucide-react';
import './BrewSlotPanel.css';
import '@/styles/deck-builder-skeleton.css';
import { DeckCardRow } from '@/components/deck/DeckCardRow';
import { fromBrewCandidate } from '@/lib/deck-change';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { useBrewStore } from '@/deck-builder/store/brew';
import type { BrewCandidate, BrewSlotDef } from '@/deck-builder/services/deckBuilder/brewSlots';

/** Resolve mana-cost pip strings for whatever's currently on screen — the
 * EDHREC-sourced candidate list doesn't carry `mana_cost`, only Scryfall
 * does. Cheap: `getCardsByNames` is cached/deduped, and this only ever
 * resolves the ~6-12 cards actually visible in a slot's hand. */
function useResolvedManaCosts(names: string[]): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  const key = names.join('|');
  useEffect(() => {
    let cancelled = false;
    // Resolves to an empty map for an empty name list — no special-casing needed.
    getCardsByNames(names).then((resolved) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const [name, card] of resolved) {
        if (card.mana_cost) next.set(name, card.mana_cost);
      }
      setMap(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the joined name list, not the array identity
  }, [key]);
  return map;
}

function SlotSkeleton(): JSX.Element {
  return (
    <ul className="brew-hand-skeleton" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="brew-hand-skeleton-row">
          <span className="deck-analysis-skeleton-bar brew-hand-skeleton-art" />
          <span className="brew-hand-skeleton-lines">
            <span className="deck-analysis-skeleton-bar is-headline" />
            <span className="deck-analysis-skeleton-bar is-short" />
          </span>
        </li>
      ))}
    </ul>
  );
}

interface MechanicSearchProps {
  query: string;
  loading: boolean;
  error: string | null;
  onSearch: (q: string) => void;
  onClear: () => void;
}

function MechanicSearch({
  query,
  loading,
  error,
  onSearch,
  onClear,
}: MechanicSearchProps): JSX.Element {
  const [value, setValue] = useState(query);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => onSearch(value), 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on value change only, onSearch is stable from the store
  }, [value]);

  return (
    <div className="brew-mechanic-search">
      <div className="brew-mechanic-search-input">
        <Search width={14} height={14} aria-hidden />
        <input
          type="text"
          inputMode="search"
          placeholder="Find a mechanic — e.g. “die roll”, “sacrifice”, otag:proliferate"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Search for cards by mechanic or Scryfall query"
        />
        {value && (
          <button
            type="button"
            className="brew-mechanic-search-clear"
            onClick={() => {
              setValue('');
              onClear();
            }}
            aria-label="Clear mechanic search"
          >
            <X width={14} height={14} aria-hidden />
          </button>
        )}
      </div>
      {loading && <p className="brew-mechanic-search-status">Searching…</p>}
      {error && <p className="brew-mechanic-search-status is-error">{error}</p>}
    </div>
  );
}

/** The core slot loop: purpose header, candidate hand (or a live mechanic
 * search replacing it), and the four slot actions. */
export function BrewSlotPanel(): JSX.Element {
  const slots = useBrewStore((s) => s.slots);
  const slotIndex = useBrewStore((s) => s.slotIndex);
  const slot: BrewSlotDef | undefined = slots[slotIndex];
  const accepted = useBrewStore((s) => s.accepted);
  const hand = useBrewStore((s) => s.hand);
  const searchQuery = useBrewStore((s) => s.searchQuery);
  const searchResults = useBrewStore((s) => s.searchResults);
  const searchLoading = useBrewStore((s) => s.searchLoading);
  const searchError = useBrewStore((s) => s.searchError);
  const loading = useBrewStore((s) => s.loading);
  const showMore = useBrewStore((s) => s.showMore);
  const accept = useBrewStore((s) => s.accept);
  const pass = useBrewStore((s) => s.pass);
  const fillRest = useBrewStore((s) => s.fillRest);
  const nextSlot = useBrewStore((s) => s.nextSlot);
  const prevSlot = useBrewStore((s) => s.prevSlot);
  const search = useBrewStore((s) => s.search);
  const clearSearch = useBrewStore((s) => s.clearSearch);
  const [showSearch, setShowSearch] = useState(false);

  const displayed: BrewCandidate[] = searchResults ?? hand;
  const manaCosts = useResolvedManaCosts(displayed.map((c) => c.name));

  if (!slot) return <p className="brew-slot-empty">Nothing left to brew — on to the manabase.</p>;

  const current = accepted[slot.key]?.length ?? 0;
  const met = slot.target > 0 && current >= slot.target;
  const isLastSlot = slotIndex === slots.length - 1;

  return (
    <section className="brew-slot" aria-labelledby="brew-slot-heading">
      <header className="brew-slot-header">
        <h2 id="brew-slot-heading">{slot.label}</h2>
        <p className="brew-slot-purpose">{slot.purpose}</p>
        <p className="brew-slot-progress">
          {current} of {slot.target} picked
          {met && <span className="brew-slot-progress-met"> — target met</span>}
        </p>
      </header>

      <div className="brew-slot-search-toggle">
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setShowSearch((v) => !v);
            if (showSearch) clearSearch();
          }}
        >
          {showSearch ? 'Back to suggestions' : 'Find a mechanic instead →'}
        </button>
      </div>

      {showSearch && (
        <MechanicSearch
          query={searchQuery}
          loading={searchLoading}
          error={searchError}
          onSearch={search}
          onClear={clearSearch}
        />
      )}

      {loading ? (
        <SlotSkeleton />
      ) : displayed.length === 0 ? (
        <div className="brew-hand-empty">
          {searchResults ? (
            <p>No cards matched that search in your color identity. Try another term.</p>
          ) : (
            <p>
              Nothing left that fits this slot from EDHREC's list.{' '}
              <button type="button" className="btn-link" onClick={() => setShowSearch(true)}>
                Search for something specific
              </button>
              , or move on.
            </p>
          )}
        </div>
      ) : (
        <ul className="brew-hand">
          {displayed.map((c) => (
            <DeckCardRow
              key={c.name}
              change={fromBrewCandidate(c, `brew:${slot.key}:${c.name}`, manaCosts.get(c.name))}
              onAct={() => accept(c)}
              secondaryAction={{
                label: 'Pass',
                ariaLabel: `Pass on ${c.name}`,
                onClick: () => pass(c.name),
              }}
            />
          ))}
        </ul>
      )}

      {!searchResults && (
        <div className="brew-slot-actions">
          <button type="button" className="btn" onClick={showMore} disabled={loading}>
            Show more
          </button>
          <button type="button" className="btn" onClick={fillRest} disabled={loading || met}>
            Fill the rest for me
          </button>
        </div>
      )}

      <div className="brew-slot-nav">
        <button type="button" className="btn" onClick={prevSlot} disabled={slotIndex === 0}>
          ← Back
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void nextSlot()}>
          {isLastSlot ? 'Continue to manabase →' : met ? 'Next slot →' : 'Skip this slot →'}
        </button>
      </div>
    </section>
  );
}
