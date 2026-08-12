import { CardPreview, type CardPreviewAction } from '../CardPreview';
import type { EnrichedCard } from '../../types';

/** An open trade-side preview: the resolved slides and which one is showing. */
export interface TradePreviewState {
  cards: EnrichedCard[];
  index: number;
}

/**
 * The card-preview carousel, as every trade surface opens it.
 *
 * This exists so the `source="search"` contract lives in ONE place. Trades are
 * not owned rows: the ask side isn't owned at all, and the give side is about
 * to stop being — so there is no binder, no page and no section to report, and
 * `search` is the `CardPreviewSource` that says exactly that (same call as
 * `InlineCardSearch`). Note this is deliberately NOT `useCardCarousel`, which
 * hardcodes `source="suggestion"` + `showRole` for the deck-analysis
 * drill-downs; routing trades through it would silently relabel every slide
 * with a deck role it doesn't have.
 *
 * `getActions` is keyed by SLIDE index. Callers that resolved their slides
 * through `resolveTradePreview` must map back through its `indexOf` rather
 * than by position — a card that resolved nowhere is dropped, and a positional
 * assumption would then point every later action at its neighbour.
 */
export function TradePreviewCarousel({
  state,
  onIndexChange,
  onClose,
  getActions,
}: {
  state: TradePreviewState;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  getActions?: (index: number) => CardPreviewAction[];
}) {
  return (
    <CardPreview
      source="search"
      cards={state.cards}
      index={state.index}
      binderName=""
      sectionLabels={[]}
      pageNumbers={[]}
      totalPages={0}
      getActions={getActions}
      onIndexChange={onIndexChange}
      onClose={onClose}
    />
  );
}
