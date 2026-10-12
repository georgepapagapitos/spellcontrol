import { useCallback, useMemo } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { collectDeckTags } from '@/lib/deck/deck-tags';
import {
  buildRows,
  findClaimedBy,
  groupByType,
  groupByCategory,
  groupByTag,
  applyFilterSort,
  type CurrencyCode,
  type SortMode,
  type DeckGroupBy,
  type Row,
  type CrossDeckCtx,
  type TypedGroup,
} from './deck-display-rows';
import { withViewerOwnership } from './viewer-ownership';
import { buildCrossDeckCtx, buildCommanderRows } from './deck-display-derive';
import type { DeckDisplayCard, DeckDisplayProps } from './deck-display-types';

interface Args {
  cards: DeckDisplayCard[];
  sideboard: DeckDisplayCard[];
  considering: DeckDisplayCard[];
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null | undefined;
  commanderAllocatedCopyId: string | null | undefined;
  partnerCommanderAllocatedCopyId: string | null | undefined;
  collectionByCopyId: Map<string, EnrichedCard> | undefined;
  ownershipFor: DeckDisplayProps['ownershipFor'];
  deckId: string | undefined;
  currency: CurrencyCode;
  /** Ticks when prices land, so rows re-price (E422). */
  pricesVersion: number;
  groupBy: DeckGroupBy;
  categoryTargets: DeckDisplayProps['categoryTargets'];
  /** The bundled tagger data has loaded: category buckets settle once on it. */
  taggerReady: boolean;
  search: string;
  sort: SortMode;
  sortDir: 'asc' | 'desc';
}

/**
 * The deck's rows, grouped by the active lens and then filtered + sorted, for
 * the mainboard (with the commander rows leading), the sideboard and
 * Considering. Also the cross-deck context that tells "you don't own this"
 * from "you own it, but another deck has the copy claimed".
 */
export function useDeckRows({
  cards,
  sideboard,
  considering,
  commander,
  partnerCommander,
  commanderAllocatedCopyId,
  partnerCommanderAllocatedCopyId,
  collectionByCopyId,
  ownershipFor,
  deckId,
  currency,
  pricesVersion,
  groupBy,
  categoryTargets,
  taggerReady,
  search,
  sort,
  sortDir,
}: Args) {
  // The current deck's own allocations are excluded, so a slot in *this* deck
  // doesn't count as "claimed elsewhere" against itself.
  const allDecks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const crossDeck: CrossDeckCtx = useMemo(
    () => buildCrossDeckCtx(collectionByCopyId, allDecks, savedCubes, deckId),
    [collectionByCopyId, allDecks, savedCubes, deckId]
  );
  const claimedByForName = useCallback(
    (cardName: string) => findClaimedBy(cardName, crossDeck),
    [crossDeck]
  );

  // A deck shown without the viewer's collection (someone else's shared deck)
  // has no allocations, so ownership comes from the viewer's name-level lens.
  const viewerOwned = useMemo(
    () =>
      !collectionByCopyId && ownershipFor
        ? (name: string) => ownershipFor(name) === 'owned'
        : undefined,
    [collectionByCopyId, ownershipFor]
  );
  const rowsFor = useCallback(
    (zone: DeckDisplayCard[]) => {
      void pricesVersion; // re-price rows when the price cache changes
      const rows = buildRows(zone, currency, collectionByCopyId, crossDeck);
      return viewerOwned ? withViewerOwnership(rows, viewerOwned) : rows;
    },
    [currency, collectionByCopyId, crossDeck, viewerOwned, pricesVersion]
  );

  // Commander rows are synthetic so they always render first; their slot
  // ids are blank because remove is not allowed on the commander.
  const commanderRows: Row[] = useMemo(() => {
    void pricesVersion;
    const rows = buildCommanderRows({
      commander,
      partnerCommander,
      commanderAllocatedCopyId,
      partnerCommanderAllocatedCopyId,
      collectionByCopyId,
      crossDeck,
      claimedByForName,
      currency,
    });
    return viewerOwned ? withViewerOwnership(rows, viewerOwned) : rows;
  }, [
    commander,
    partnerCommander,
    commanderAllocatedCopyId,
    partnerCommanderAllocatedCopyId,
    collectionByCopyId,
    crossDeck,
    claimedByForName,
    currency,
    viewerOwned,
    pricesVersion,
  ]);

  // Non-commander rows grouped by the active groupBy lens. STABILITY: the
  // dep array deliberately excludes anything derived from
  // useCommanderBracketAnalysis (roleTargets/bracketEstimation/planScore/…) —
  // category buckets settle ONCE when taggerReady flips true and must never
  // re-shuffle from a background/derived write (product hard rule). Pre-
  // taggerReady, untagged cards fall to 'synergy'; that's fine, it's the same
  // one-time settle as the role-filter bar's counts.
  const groups = useMemo(() => {
    const rows = rowsFor(cards);
    if (groupBy === 'tag') return groupByTag(rows, commanderRows);
    return groupBy === 'category'
      ? groupByCategory(rows, categoryTargets, commanderRows)
      : groupByType(rows, commanderRows);
  }, [cards, commanderRows, rowsFor, groupBy, categoryTargets, taggerReady]);

  // Every distinct user tag across the WHOLE deck (all 3 zones, unfiltered
  // by search/groupBy) — the tag manager's "see all tags" list.
  const deckTags = useMemo(
    () => collectDeckTags({ cards, sideboard, considering }),
    [cards, sideboard, considering]
  );

  // The sideboard and Considering (E122) are each ONE section, whatever the
  // mainboard's lens: a pile of a handful of cards split by type would put a
  // header over every second card. `empty` is set only when the pile really
  // is empty; a search that filters it to nothing hides it like any other
  // section, instead of claiming there are no cards.
  const sideboardGroups = useMemo<TypedGroup[]>(
    () => [
      {
        title: 'Sideboard',
        icon: 'sideboard',
        rows: rowsFor(sideboard),
        empty: sideboard.length === 0 ? 'No sideboard cards yet' : undefined,
      },
    ],
    [sideboard, rowsFor]
  );
  const consideringGroups = useMemo<TypedGroup[]>(
    () => [
      {
        title: 'Considering',
        icon: 'considering',
        rows: rowsFor(considering),
        empty:
          considering.length === 0
            ? "Nothing parked here yet. Move a card here when you're unsure about it."
            : undefined,
      },
    ],
    [considering, rowsFor]
  );

  const visibleGroups = useMemo(
    () => applyFilterSort(groups, search, sort, sortDir),
    [groups, search, sort, sortDir]
  );
  const visibleSideboardGroups = useMemo(
    () => applyFilterSort(sideboardGroups, search, sort, sortDir),
    [sideboardGroups, search, sort, sortDir]
  );
  const visibleConsideringGroups = useMemo(
    () => applyFilterSort(consideringGroups, search, sort, sortDir),
    [consideringGroups, search, sort, sortDir]
  );

  // No card in the deck (main, sideboard, or considering) matches the current
  // query — the cue to surface the "search Scryfall to add it" trigger.
  const noDeckMatches =
    !visibleGroups.some((g) => g.rows.length > 0) &&
    !visibleSideboardGroups.some((g) => g.rows.length > 0) &&
    !visibleConsideringGroups.some((g) => g.rows.length > 0);

  return {
    crossDeck,
    deckTags,
    visibleGroups,
    visibleSideboardGroups,
    visibleConsideringGroups,
    noDeckMatches,
  };
}
