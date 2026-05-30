import { useCallback, useState } from 'react';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { EnrichedCard } from '@/types';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardPreview } from '@/components/CardPreview';

/** A card to show in the carousel: its name plus a short context label rendered
 *  under the art (e.g. "In 12% of decks"). Pass `card` when the full Scryfall
 *  object is already in hand (e.g. deck cards) to skip the per-name fetch. */
export interface CarouselEntry {
  name: string;
  label: string;
  card?: ScryfallCard;
}

/** A unique card with how many copies are in the deck — the shape the deck-stat
 *  drill-downs (mana sources, type/curve/color breakdowns) pass to the carousel.
 *  `card` carries the already-loaded Scryfall object so the carousel renders
 *  instantly instead of re-querying Scryfall by name. */
export interface CardTally {
  name: string;
  count: number;
  card?: ScryfallCard;
}

/** Build carousel entries from a name→copy-count tally, labeling each card with
 *  its copy count so duplicates (basics, etc.) collapse to one swipeable entry. */
export function tallyToEntries(tally: CardTally[]): CarouselEntry[] {
  return tally.map((t) => ({
    name: t.name,
    label: t.count > 1 ? `${t.count} copies` : '1 copy',
    card: t.card,
  }));
}

export interface CardCarousel {
  /** Resolve `entries` to cards and open the preview at `tappedName`. */
  open: (entries: CarouselEntry[], tappedName: string) => Promise<void>;
  /** The CardPreview element to drop into the tree (null while closed). */
  preview: JSX.Element | null;
}

/**
 * Shared "tap a card reference → open the CardPreview carousel" behavior for the
 * deck-analysis panels. Entries that carry a `card` render instantly; those with
 * only a name are fetched from Scryfall (in parallel) and converted to
 * EnrichedCard. Any that fail to resolve are skipped so the carousel never shows
 * a broken slot. One source of truth for the pattern that used to be copy-pasted
 * into each panel (mirrors GapAnalysisPanel.openCarousel).
 */
export function useCardCarousel(binderName: string): CardCarousel {
  const [cards, setCards] = useState<EnrichedCard[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  const open = useCallback(async (entries: CarouselEntry[], tappedName: string) => {
    // Resolve in parallel: provided `card`s need no network; name-only entries
    // each fetch once. Preserve entry order so the carousel matches the list.
    const results = await Promise.all(
      entries.map(async (entry) => {
        try {
          const scry = entry.card ?? (await getCardByName(entry.name));
          return scry ? { card: scryfallToEnrichedCard(scry), label: entry.label } : null;
        } catch {
          return null; // skip — leaves the slot out of the carousel
        }
      })
    );
    const resolved: EnrichedCard[] = [];
    const resolvedLabels: string[] = [];
    for (const r of results) {
      if (!r) continue;
      resolved.push(r.card);
      resolvedLabels.push(r.label);
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
