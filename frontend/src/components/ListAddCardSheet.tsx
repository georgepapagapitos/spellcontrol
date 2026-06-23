import { useCallback, useEffect, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish, ListDef } from '../types';
import { SearchPill } from './SearchPill';
import { InlineCardSearch } from './InlineCardSearch';
import { useCollectionStore } from '../store/collection';
import { scryfallToEnrichedCard } from '../lib/scryfall-to-enriched';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';

interface Props {
  list: ListDef;
  /** Seed the search input (e.g. carried over from the list filter). */
  initialQuery?: string;
  onClose: () => void;
}

/**
 * Bottom-sheet "Add card" flow for a list. Mirrors {@link AddCardSheet}'s
 * shell but owns its own search input and reuses the collection's
 * {@link InlineCardSearch} results panel, retargeted (via `onAdd`) to add a
 * list entry instead of a collection card.
 */
export function ListAddCardSheet({ list, initialQuery = '', onClose }: Props) {
  useLockBodyScroll();
  const addListEntry = useCollectionStore((s) => s.addListEntry);
  const [query, setQuery] = useState(initialQuery);

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const addToList = (card: ScryfallCard, finish?: Finish) =>
    addListEntry(list.id, scryfallToEnrichedCard(card, finish ?? 'nonfoil'), 1);

  const title = `Add card to ${list.name}`;

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet add-card-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">{title}</h2>
          <p className="add-card-sheet-hint">
            Lists hold cards you don’t own yet — adding here never touches your collection.
          </p>
          <SearchPill
            value={query}
            onChange={setQuery}
            placeholder="Search Scryfall to add a card…"
            ariaLabel="Search Scryfall to add a card"
            autoFocus
          />
        </div>

        <div className="add-card-sheet-body">
          {query.trim().length >= 2 ? (
            <InlineCardSearch query={query.trim()} onAdd={addToList} />
          ) : (
            <p className="card-picker-empty">Type at least two characters to search.</p>
          )}
        </div>

        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => dismiss()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
