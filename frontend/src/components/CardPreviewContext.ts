import { createContext } from 'react';
import type { EnrichedCard } from '../types';

/**
 * Provided by SectionList for each section. CardSlot calls `openCard` on
 * tap (touch devices only) so the section-scoped preview modal can open
 * with the card's siblings available for prev/next navigation.
 */
export interface CardPreviewCtx {
  openCard: (card: EnrichedCard) => void;
}

export const CardPreviewContext = createContext<CardPreviewCtx | null>(null);
