import { useCallback, useState } from 'react';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import { useCollectionStore } from '@/store/collection';
import type { EnrichedCard, Finish } from '@/types';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardPreview } from '@/components/CardPreview';

/**
 * Best owned "shimmer" finish for a card the player has in their collection.
 * Carousels have no ownership context of their own, so we look the resolved
 * card up against the collection store (by oracleId, falling back to name) and
 * surface a foil treatment only when the player actually owns a foil/etched
 * copy. Preference order foil > etched > nonfoil so a single owned foil wins.
 * Returns 'nonfoil' when unowned or owned only non-foil — no regression.
 */
function ownedShimmerFinish(card: EnrichedCard): Finish {
  const owned = useCollectionStore.getState().cards;
  const oracleId = card.oracleId;
  const name = card.name.toLowerCase();
  let best: Finish = 'nonfoil';
  for (const c of owned) {
    const matches = oracleId ? c.oracleId === oracleId : c.name.toLowerCase() === name;
    if (!matches) continue;
    if (c.finish === 'foil') return 'foil'; // best possible — stop early
    if (c.finish === 'etched') best = 'etched';
  }
  return best;
}

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
 * into each deck-analysis panel.
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
          if (!scry) return null;
          // Shimmer the card in the carousel only when the player owns a
          // foil/etched copy. classifyFoil (in CardPreview) keys off finish +
          // promoTypes; passing the owned finish to scryfallToEnrichedCard sets
          // both `finish` and the derived `foil` flag the foil overlay reads.
          const base = scryfallToEnrichedCard(scry);
          const finish = ownedShimmerFinish(base);
          return {
            card: finish === 'nonfoil' ? base : scryfallToEnrichedCard(scry, finish),
            label: entry.label,
          };
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
        // Every useCardCarousel consumer is a deck-analysis drill-down (mana
        // curve, types, colors, bracket, engine/optimize/substitution
        // suggestions, saltiest). They all want the same collapsed essentials:
        // why the card surfaced (the carousel `label` → context line) + role +
        // price. `showRole` lights up the role line the 'suggestion' policy keeps.
        source="suggestion"
        showRole
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
