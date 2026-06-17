import { type JSX, useCallback, useRef, useState } from 'react';
import { getCardByNameResilient, getOwnedPrinting } from '@/deck-builder/services/scryfall/client';
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

/** The best owned physical copy for a card NAME, preferring foil > etched >
 *  nonfoil so a name-only carousel entry resolves to the *exact printing the
 *  player has* (its scryfallId), not Scryfall's arbitrary default printing.
 *  Keyed by name because entries aren't resolved yet (no oracleId in hand).
 *  Returns undefined when the card isn't in the collection — suggestions and
 *  unowned cards then fall back to name resolution. */
function bestOwnedCopyByName(name: string): EnrichedCard | undefined {
  const owned = useCollectionStore.getState().cards;
  const lower = name.toLowerCase();
  const rank: Record<Finish, number> = { foil: 3, etched: 2, nonfoil: 1 };
  let best: EnrichedCard | undefined;
  let bestRank = 0;
  for (const c of owned) {
    if (c.name.toLowerCase() !== lower || !c.scryfallId) continue;
    const r = rank[c.finish] ?? 1;
    if (r > bestRank) {
      best = c;
      bestRank = r;
      if (r === 3) break; // foil is best possible — stop early
    }
  }
  return best;
}

/** Resolve a name-only entry to a full Scryfall card, preferring the player's
 *  owned printing (so the carousel shows the card they actually have) and
 *  falling back to the default printing for unowned cards / suggestions. */
async function resolveForCarousel(name: string): Promise<ScryfallCard | null> {
  const ownedCopy = bestOwnedCopyByName(name);
  if (ownedCopy?.scryfallId) {
    const exact = await getOwnedPrinting(ownedCopy.scryfallId, name).catch(() => null);
    if (exact) return exact;
  }
  return getCardByNameResilient(name);
}

/** A fully-resolved Scryfall card → EnrichedCard, with the owned foil/etched
 *  shimmer applied. classifyFoil (in CardPreview) keys off finish + promoTypes;
 *  passing the owned finish to scryfallToEnrichedCard sets both `finish` and the
 *  derived `foil` flag the foil overlay reads. */
function enrichScry(scry: ScryfallCard): EnrichedCard {
  const base = scryfallToEnrichedCard(scry);
  const finish = ownedShimmerFinish(base);
  return finish === 'nonfoil' ? base : scryfallToEnrichedCard(scry, finish);
}

/** A minimal EnrichedCard for a name-only entry — present and swipeable
 *  immediately, but with NO art yet (a bare img against the rate-limited API
 *  host would 429 a whole lane on open). Its CDN art + richer data (price/role/
 *  foil/back-face) stream in via {@link useCardCarousel}'s windowed enrichment,
 *  which resolves through the cached/offline resolver — so the visible window
 *  fills near-instantly without ever bursting the API. */
function placeholderCard(name: string, key: string): EnrichedCard {
  return {
    copyId: key,
    name,
    setCode: '',
    setName: '',
    collectorNumber: '',
    rarity: '',
    scryfallId: '',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'nonfoil',
    foil: false,
  };
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
  /** Open the preview at `tappedName`, with every entry immediately swipeable. */
  open: (entries: CarouselEntry[], tappedName: string) => void;
  /** The CardPreview element to drop into the tree (null while closed). */
  preview: JSX.Element | null;
}

/** How many cards on each side of the focused card to eagerly enrich. Small so
 *  swiping stays ahead of the (rate-limited) JSON API without fetching the lane. */
const ENRICH_RADIUS = 2;

/**
 * Shared "tap a card reference → open the CardPreview carousel" behavior for the
 * deck-analysis panels.
 *
 * Opens **instantly**: every entry becomes a slide up front — entries that carry
 * a `card` are fully enriched synchronously; name-only entries open as art-less
 * placeholders. CDN art + richer data (price, role, foil, DFC back-face) then
 * stream in lazily for a small window around whatever card you're viewing,
 * resolved through the cached/offline resolver — so the visible window fills
 * near-instantly and we never burst the rate-limited API with a whole lane of
 * image requests. One source of truth for the pattern that used to be
 * copy-pasted into each deck-analysis panel.
 */
export function useCardCarousel(binderName: string): CardCarousel {
  const [cards, setCards] = useState<EnrichedCard[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  // Bumped on every open() and on close so a still-in-flight enrichment can't
  // write into a carousel the user already closed or re-opened.
  const openSeq = useRef(0);
  const entriesRef = useRef<CarouselEntry[]>([]);
  // Indices already enriched (or claimed in-flight) — so we never double-fetch.
  const enrichedRef = useRef<Set<number>>(new Set());

  // Enrich a small window around `center` for cards that opened as name-only
  // placeholders: swaps in price/role/foil/oracle + DFC back-face. Bounded to
  // what's in view so a 180-card lane never floods the rate-limited JSON API.
  const enrichAround = useCallback(async (center: number) => {
    const seq = openSeq.current;
    const entries = entriesRef.current;
    const targets: number[] = [];
    for (let d = 0; d <= ENRICH_RADIUS; d++) {
      for (const i of d === 0 ? [center] : [center + d, center - d]) {
        if (i >= 0 && i < entries.length && !enrichedRef.current.has(i)) targets.push(i);
      }
    }
    for (const i of targets) {
      enrichedRef.current.add(i); // claim up front so re-entry doesn't double-fetch
      const scry = await resolveForCarousel(entries[i].name);
      if (seq !== openSeq.current) return; // carousel closed / re-opened meanwhile
      if (!scry) {
        enrichedRef.current.delete(i); // allow a later retry; placeholder stays usable
        continue;
      }
      const enriched = enrichScry(scry);
      setCards((prev) => (prev ? prev.map((c, j) => (j === i ? enriched : c)) : prev));
    }
  }, []);

  const open = useCallback(
    (entries: CarouselEntry[], tappedName: string) => {
      if (entries.length === 0) return;
      openSeq.current++;
      entriesRef.current = entries;
      const enriched = new Set<number>();
      const slides = entries.map((e, i) => {
        if (e.card) {
          enriched.add(i); // already in hand — no fetch needed
          return enrichScry(e.card);
        }
        return placeholderCard(e.name, `carousel:${i}:${e.name}`);
      });
      enrichedRef.current = enriched;
      const tappedIdx = Math.max(
        0,
        entries.findIndex((e) => e.name.toLowerCase() === tappedName.toLowerCase())
      );
      // Open with every slot present (art streams from the CDN per-card, each
      // with its own skeleton) so the carousel is swipeable immediately.
      setCards(slides);
      setLabels(entries.map((e) => e.label));
      setIndex(tappedIdx);
      void enrichAround(tappedIdx);
    },
    [enrichAround]
  );

  const handleIndexChange = useCallback(
    (i: number) => {
      setIndex(i);
      void enrichAround(i); // pull richer data for the newly-focused window
    },
    [enrichAround]
  );

  const close = useCallback(() => {
    openSeq.current++; // stop in-flight enrichment from touching a closed carousel
    setCards(null);
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
        onIndexChange={handleIndexChange}
        onClose={close}
      />
    ) : null;

  return { open, preview };
}
