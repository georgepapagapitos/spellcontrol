import { useMemo, useState } from 'react';
import { useCollectionStore } from '@/store/collection';
import { Sheet } from '@/components/overlays/Sheet';
import { normalizeForSearch } from '@/lib/search/normalize-search';
import type { EnrichedCard } from '@/types/index';
import { FoilBadge } from '@/components/shared/FoilBadge';
import { SearchPill } from '@/components/search/SearchPill';
import { nameMatchesNormalized, printedName } from '@spellcontrol/binder-routing';
import { CardName } from '@/components/shared/CardName';
import { Button } from '@/components/shared/Button';

interface Props {
  binderId: string;
  allCards: EnrichedCard[];
  currentBoundSet: Set<string>;
  onClose: () => void;
}

export function CardPickerSheet({ binderId, allCards, currentBoundSet, onClose }: Props) {
  const [query, setQuery] = useState('');
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  // Track locally which cards were just added this session for instant "Added" feedback.
  const [addedThisSession, setAddedThisSession] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nq = normalizeForSearch(query);
    const results = q
      ? allCards.filter(
          (c) =>
            nameMatchesNormalized(c, nq) ||
            c.setCode.toLowerCase().includes(q) ||
            c.collectorNumber.toLowerCase().includes(q)
        )
      : allCards;

    // Sort: not-yet-bound cards alphabetically first; already-bound at the bottom.
    return [...results].sort((a, b) => {
      const aIn = currentBoundSet.has(a.copyId) ? 1 : 0;
      const bIn = currentBoundSet.has(b.copyId) ? 1 : 0;
      if (aIn !== bIn) return aIn - bIn;
      return printedName(a).localeCompare(printedName(b));
    });
  }, [allCards, query, currentBoundSet]);

  const handleAdd = (copyId: string) => {
    pinCardToBinder(binderId, copyId);
    setAddedThisSession((prev) => {
      const next = new Set(prev);
      next.add(copyId);
      return next;
    });
  };

  return (
    <Sheet
      onClose={onClose}
      label="Add cards to binder"
      title="Add cards"
      toolbar={
        <SearchPill
          value={query}
          onChange={setQuery}
          placeholder="Search by name, set, or number…"
          ariaLabel="Search collection"
          autoFocus
        />
      }
      footer={(close) => (
        <>
          <Button variant="primary" onClick={() => close()}>
            Done
          </Button>
        </>
      )}
    >
      <ul className="card-picker-list" role="list">
        {filtered.map((card) => {
          const isAdded = currentBoundSet.has(card.copyId) || addedThisSession.has(card.copyId);
          return (
            <li key={card.copyId} className="card-picker-row">
              <span className={`card-picker-rarity rarity-${card.rarity}`} aria-hidden />
              <span className="card-picker-name">
                <CardName card={card} />
              </span>
              <span className="card-picker-meta">
                {card.setCode.toUpperCase()} #{card.collectorNumber}
                {card.foil ? <FoilBadge card={card} /> : null}
              </span>
              {isAdded ? (
                <span className="card-picker-added" aria-label="Already added" role="img">
                  Added
                </span>
              ) : (
                <Button
                  onClick={() => handleAdd(card.copyId)}
                  aria-label={`Add ${card.name} to binder`}
                  className="card-picker-add"
                >
                  Add
                </Button>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="card-picker-empty">No cards match &ldquo;{query}&rdquo;</li>
        )}
      </ul>
    </Sheet>
  );
}
