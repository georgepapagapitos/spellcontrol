import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useEscapeKey } from '../lib/use-escape-key';
import type { EnrichedCard } from '../types';

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
  const searchRef = useRef<HTMLInputElement>(null);

  useLockBodyScroll();
  useEscapeKey(onClose);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const results = q
      ? allCards.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.setCode.toLowerCase().includes(q) ||
            c.collectorNumber.toLowerCase().includes(q)
        )
      : allCards;

    // Sort: not-yet-bound cards alphabetically first; already-bound at the bottom.
    return [...results].sort((a, b) => {
      const aIn = currentBoundSet.has(a.copyId) ? 1 : 0;
      const bIn = currentBoundSet.has(b.copyId) ? 1 : 0;
      if (aIn !== bIn) return aIn - bIn;
      return a.name.localeCompare(b.name);
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
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add cards to binder"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Add cards</h2>
          <input
            ref={searchRef}
            type="search"
            className="card-picker-search"
            placeholder="Search by name, set, or number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search collection"
          />
        </div>
        <ul className="card-picker-list" role="list">
          {filtered.map((card) => {
            const isAdded = currentBoundSet.has(card.copyId) || addedThisSession.has(card.copyId);
            return (
              <li key={card.copyId} className="card-picker-row">
                <span className={`card-picker-rarity rarity-${card.rarity}`} aria-hidden />
                <span className="card-picker-name">{card.name}</span>
                <span className="card-picker-meta">
                  {card.setCode.toUpperCase()} #{card.collectorNumber}
                  {card.foil ? <span className="card-picker-foil"> foil</span> : null}
                </span>
                {isAdded ? (
                  <span className="card-picker-added" aria-label="Already added">
                    Added
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn card-picker-add"
                    onClick={() => handleAdd(card.copyId)}
                    aria-label={`Add ${card.name} to binder`}
                  >
                    Add
                  </button>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="card-picker-empty">No cards match &ldquo;{query}&rdquo;</li>
          )}
        </ul>
        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
