import { useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish, ListDef } from '@/types/index';
import { SearchPill } from '@/components/search/SearchPill';
import { InlineCardSearch } from '@/components/search/InlineCardSearch';
import { useCollectionStore } from '@/store/collection';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';
import { useResultsKeys } from '@/lib/search/use-results-keys';
import { Sheet } from '@/components/overlays/Sheet';
import { Button } from '@/components/shared/Button';

interface Props {
  list: ListDef;
  /** Seed the search input (e.g. carried over from the list filter). */
  initialQuery?: string;
  onClose: () => void;
}

/**
 * Bottom-sheet "Add card" flow for a list. Owns its own search input and reuses the collection's
 * {@link InlineCardSearch} results panel, retargeted (via `onAdd`) to add a
 * list entry instead of a collection card.
 */
export function ListAddCardSheet({ list, initialQuery = '', onClose }: Props) {
  const addListEntry = useCollectionStore((s) => s.addListEntry);
  const [query, setQuery] = useState(initialQuery);
  const { resultsRef, onActiveChange, onKeyDown: resultsKeyDown } = useResultsKeys();

  const addToList = (card: ScryfallCard, finish?: Finish) =>
    addListEntry(list.id, scryfallToEnrichedCard(card, finish ?? 'nonfoil'), 1);

  return (
    <Sheet
      onClose={onClose}
      className="add-card-sheet"
      title={`Add card to ${list.name}`}
      description="Adding here never touches your collection."
      toolbar={
        <SearchPill
          value={query}
          onChange={setQuery}
          placeholder="Search Scryfall to add a card…"
          ariaLabel="Search Scryfall to add a card"
          autoFocus
          inputProps={{ onKeyDown: resultsKeyDown }}
        />
      }
      footer={(close) => <Button onClick={close}>Done</Button>}
    >
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
    </Sheet>
  );
}
