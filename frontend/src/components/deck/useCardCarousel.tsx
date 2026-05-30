import { useCallback, useState } from 'react';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { EnrichedCard } from '@/types';
import { CardPreview } from '@/components/CardPreview';

/** A card to show in the carousel: its name (resolved via Scryfall on open) and
 *  a short context label rendered under the art (e.g. "In 12% of decks"). */
export interface CarouselEntry {
  name: string;
  label: string;
}

export interface CardCarousel {
  /** Resolve `entries` to cards and open the preview at `tappedName`. */
  open: (entries: CarouselEntry[], tappedName: string) => Promise<void>;
  /** The CardPreview element to drop into the tree (null while closed). */
  preview: JSX.Element | null;
}

/**
 * Shared "tap a card reference → open the CardPreview carousel" behavior for the
 * deck-analysis panels. Cards are fetched from Scryfall on demand and converted
 * to EnrichedCard; any that fail to resolve are skipped so the carousel never
 * shows a broken slot. One source of truth for the pattern that used to be
 * copy-pasted into each panel (mirrors GapAnalysisPanel.openCarousel).
 */
export function useCardCarousel(binderName: string): CardCarousel {
  const [cards, setCards] = useState<EnrichedCard[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const open = useCallback(async (entries: CarouselEntry[], tappedName: string) => {
    const resolved: EnrichedCard[] = [];
    const resolvedLabels: string[] = [];
    for (const entry of entries) {
      try {
        const scry = await getCardByName(entry.name);
        if (!scry) continue;
        resolved.push(scryfallToEnrichedCard(scry));
        resolvedLabels.push(entry.label);
      } catch {
        /* skip — leaves the slot out of the carousel */
      }
    }
    if (resolved.length === 0) return;
    const idx = resolved.findIndex((c) => c.name.toLowerCase() === tappedName.toLowerCase());
    setCards(resolved);
    setLabels(resolvedLabels);
    setIndex(idx >= 0 ? idx : 0);
  }, []);

  const preview =
    cards && cards.length > 0 ? (
      <CardPreview
        cards={cards}
        index={index}
        binderName={binderName}
        sectionLabels={labels}
        pageNumbers={cards.map(() => 0)}
        totalPages={1}
        onIndexChange={setIndex}
        onClose={() => setCards(null)}
      />
    ) : null;

  return { open, preview };
}
