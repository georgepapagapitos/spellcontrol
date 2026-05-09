import { createContext } from 'react';
import type { EnrichedCard } from '../types';

/**
 * Provided by SectionList for each section. CardSlot calls `openCard` on
 * tap (touch devices only) so the section-scoped preview modal can open
 * with the card's siblings available for prev/next navigation. PageGrid
 * calls `openPages` when the page-number label is tapped, opening the
 * binder-pages flipbook starting at that page index.
 */
export interface CardPreviewCtx {
  openCard: (card: EnrichedCard) => void;
  openPages: (startPageIndex: number) => void;
  /**
   * True while a preview modal (single card or page flipbook) is open. Read
   * by CardSlot to suppress its hover tooltip — without this, mouseenter
   * events on slots underneath the modal still fire and the tooltip pops up
   * over the carousel.
   */
  isPreviewOpen: boolean;
  /**
   * When the binder is in "group printings" mode the materializer feeds
   * one card per unique (scryfallId × foil); the qty for each surviving
   * copy lives here keyed by copyId. Slots with qty > 1 paint a small
   * ×N badge in the corner — same affordance the collection grid uses.
   */
  qtyByCopyId?: Map<string, number>;
}

export const CardPreviewContext = createContext<CardPreviewCtx | null>(null);
