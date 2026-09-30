import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish, ListDef } from '@/types/index';
import { SearchPill } from '@/components/search/SearchPill';
import { InlineCardSearch } from '@/components/search/InlineCardSearch';
import { useCollectionStore } from '@/store/collection';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useResultsKeys } from '@/lib/search/use-results-keys';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { Button } from '@/components/shared/Button';

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
  const { resultsRef, onActiveChange, onKeyDown: resultsKeyDown } = useResultsKeys();

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onClose,
    'binder-sheet-slide-out',
    { instantAt: '(min-width: 1024px)' }
  );

  const addToList = (card: ScryfallCard, finish?: Finish) =>
    addListEntry(list.id, scryfallToEnrichedCard(card, finish ?? 'nonfoil'), 1);

  const title = `Add card to ${list.name}`;

  return createPortal(
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) beginClose();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet add-card-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">{title}</h2>
          <p className="add-card-sheet-hint">Adding here never touches your collection.</p>
          <SearchPill
            value={query}
            onChange={setQuery}
            placeholder="Search Scryfall to add a card…"
            ariaLabel="Search Scryfall to add a card"
            autoFocus
            inputProps={{ onKeyDown: resultsKeyDown }}
          />
        </div>

        <div className="add-card-sheet-body">
          {query.trim().length >= 2 ? (
            <InlineCardSearch
              ref={resultsRef}
              query={query.trim()}
              onAdd={addToList}
              onActiveChange={onActiveChange}
            />
          ) : (
            <p className="card-picker-empty">Type at least two characters to search.</p>
          )}
        </div>

        <div className="card-picker-footer">
          <Button onClick={() => beginClose()}>Done</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
