import { Button } from '@/components/shared/Button';
import { classifyInclusion } from '@/lib/deck-analysis/inclusion-label';
import { hiddenGemReason } from '@/deck-builder/services/deckBuilder/hiddenGems';
import type { SuggestionRow } from '@/lib/coach/deck-suggestions';
import type { CarouselEntry } from './useCardCarousel';

/**
 * The way out of the suggestion list into a real search of the typed text (the
 * panel's one input, so the query carries over). `trailing` is the footer under
 * the rows; without it the buttons sit inside the zero-match message.
 */
export function SuggestionsHandoff({
  trailing,
  onSearchCollection,
  onSearchScryfall,
}: {
  trailing?: boolean;
  onSearchCollection: () => void;
  onSearchScryfall: () => void;
}) {
  const actions = (
    <div className="card-search-empty-actions" role="group" aria-label="Search further">
      <Button onClick={onSearchCollection}>Search your collection</Button>
      <Button onClick={onSearchScryfall}>Search all of Scryfall</Button>
    </div>
  );
  return trailing ? <div className="card-search-handoff">{actions}</div> : actions;
}

/** Context line under the art: why a card surfaced (EDHREC % / role, or the combo it completes). */
export function suggestionPreviewEntries(rows: SuggestionRow[]): CarouselEntry[] {
  return rows.map((row) => {
    if (row.kind === 'combo') {
      return {
        name: row.name,
        label: row.produces ? `Completes: ${row.produces}` : 'Completes a combo',
      };
    }
    if (row.kind === 'gem') {
      return {
        name: row.name,
        label: row.signals?.length ? hiddenGemReason({ signals: row.signals }) : 'Hidden gem',
      };
    }
    const info = classifyInclusion(row.inclusion);
    const pct = info.kind === 'pct' ? `In ${info.pct}% of decks` : 'Off-meta';
    return { name: row.name, label: row.roleLabel ? `${pct} · ${row.roleLabel}` : pct };
  });
}
