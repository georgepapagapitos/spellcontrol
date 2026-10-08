import { useMemo, useState } from 'react';
import { nameMatchesNormalized } from '@spellcontrol/binder-routing';
import { getCardTags, useCardTagsReady } from '@/lib/cards/card-tags';
import { publicCardToEnriched } from '@/lib/social/shared-filter';
import { publicCardsToFriendCards } from '@/lib/social/friend-collection-filter';
import { buildFriendSearch, friendPayloadCaps } from '@/lib/social/friend-search';
import {
  groupCards,
  sortGrouped,
  type GroupedCard,
  type SharedSortKey,
  type SortDir,
} from '@/lib/social/shared-grouping';
import { normalizeForSearch } from '@/lib/search/normalize-search';
import type { PublicCard } from '@/lib/social/shared-types';
import { useSharedFilters } from './use-shared-filters';

export type BrowserView = 'grid' | 'list' | 'compact';
export type BrowserChipId = 'wants' | 'spare' | 'free';

/** Rows rendered before "Show more" — the friend hub's own page size. */
export const BROWSER_PAGE_SIZE = 60;

const EMPTY: PublicCard[] = [];

/** A group plus whether ANY copy in it is spare (the representative copy is
 *  just the first one, so its own flag would under-report). */
export interface BrowserGroup extends GroupedCard {
  spare: boolean;
}

export interface BrowserChip {
  id: BrowserChipId;
  label: string;
  count: number;
  pressed: boolean;
}

interface Options {
  /** null until the data has arrived. */
  cards: PublicCard[] | null;
  /** Oracle ids the viewer wants; turns on the "On my wants" chip. */
  myWants?: ReadonlySet<string>;
  defaultSort?: SharedSortKey;
}

/**
 * All of CollectionBrowser's state and derivation, so the component is just
 * markup. Everything narrows PER COPY (search, facets, chips) and the survivors
 * are grouped into printing stacks afterwards, which keeps "Spare 3" and a
 * stack's ×qty telling the same story.
 */
export function useCollectionBrowser({ cards, myWants, defaultSort }: Options) {
  const list = cards ?? EMPTY;
  const hasData = cards !== null;

  const [query, setQuery] = useState('');
  const [sortChoice, setSortChoice] = useState<{ key: SharedSortKey; dir: SortDir } | null>(null);
  const [view, setView] = useState<BrowserView>('grid');
  const [pressed, setPressed] = useState<ReadonlySet<BrowserChipId>>(new Set());
  const [visible, setVisible] = useState(BROWSER_PAGE_SIZE);

  const { filterNode, matches, activeCount, clear: clearFacets } = useSharedFilters(list);

  // ── Sort ───────────────────────────────────────────────────────────────
  // Popularity needs EDHREC ranks, which only some payloads carry; offering it
  // over a list with none would sort nothing.
  const hasPopularity = useMemo(() => list.some((c) => c.edhrecRank !== undefined), [list]);
  const wanted = sortChoice ?? {
    key: defaultSort ?? (hasPopularity ? 'popularity' : 'name'),
    dir: 'asc' as SortDir,
  };
  const sort = wanted.key === 'popularity' && !hasPopularity ? 'name' : wanted.key;
  const dir = wanted.dir;
  // Re-picking the active field flips direction (SortMenu's Reverse calls this
  // too); a new field starts ascending.
  const toggleSort = (key: SharedSortKey) =>
    setSortChoice(
      key === sort ? { key, dir: dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );

  // ── Search (Scryfall syntax via the friend engine) ─────────────────────
  const friendCards = useMemo(() => publicCardsToFriendCards(list), [list]);
  const caps = useMemo(() => friendPayloadCaps(friendCards), [friendCards]);
  // `otag:` needs the tag snapshot; load it only when the query asks for one.
  const tagsReady = useCardTagsReady(/\b(otag|oracletag|function)[:=]/i.test(query));
  const search = useMemo(
    () => buildFriendSearch(query, tagsReady ? getCardTags : undefined, caps),
    [query, tagsReady, caps]
  );

  // ── Chips ──────────────────────────────────────────────────────────────
  const chipPredicates = useMemo(() => {
    const preds: Record<BrowserChipId, (c: PublicCard) => boolean> = {
      wants: (c) => !!myWants && !!c.oracleId && myWants.has(c.oracleId),
      spare: (c) => c.spare === true,
      free: (c) => c.inDeck !== true,
    };
    return preds;
  }, [myWants]);

  const chips = useMemo<BrowserChip[]>(() => {
    const out: BrowserChip[] = [];
    const add = (id: BrowserChipId, label: string) =>
      out.push({
        id,
        label,
        count: list.filter(chipPredicates[id]).length,
        pressed: pressed.has(id),
      });
    if (myWants) add('wants', 'On my wants');
    // Only a payload that carries the keys can answer these; a stranger's
    // does not, and a chip over a fact nobody sent would match nothing.
    if (list.some((c) => c.spare !== undefined)) add('spare', 'Spare');
    if (list.some((c) => c.inDeck !== undefined)) add('free', 'Not in a deck');
    return out;
  }, [list, myWants, pressed, chipPredicates]);

  const toggleChip = (id: BrowserChipId) =>
    setPressed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Narrow, group, sort ────────────────────────────────────────────────
  const filteredCopies = useMemo(() => {
    const plainName = search.kind === 'name' ? normalizeForSearch(query) : null;
    // A chip can only be pressed while its predicate is offered.
    const active = chips.filter((c) => c.pressed).map((c) => chipPredicates[c.id]);
    return list.filter((c, i) => {
      const textOk =
        plainName !== null ? nameMatchesNormalized(c, plainName) : search.match(friendCards[i]);
      return textOk && active.every((p) => p(c)) && matches(c);
    });
  }, [list, friendCards, search, query, chips, chipPredicates, matches]);

  const sorted = useMemo<BrowserGroup[]>(() => {
    const spareKeys = new Set<string>();
    const groups = groupCards(filteredCopies);
    for (const c of filteredCopies) if (c.spare) spareKeys.add(`${c.scryfallId}::${c.finish}`);
    return sortGrouped(groups, sort, dir).map((g) => ({ ...g, spare: spareKeys.has(g.key) }));
  }, [filteredCopies, sort, dir]);

  // Page depth resets whenever the result changes (adjusted during render, the
  // React-documented way, rather than in an effect that costs a second paint).
  const [lastSorted, setLastSorted] = useState(sorted);
  if (sorted !== lastSorted) {
    setLastSorted(sorted);
    setVisible(BROWSER_PAGE_SIZE);
  }

  const previewCards = useMemo(() => sorted.map((g) => publicCardToEnriched(g.card)), [sorted]);

  const previewLabels = useMemo(() => sorted.map(() => ''), [sorted]);
  const previewPages = useMemo(() => sorted.map(() => 0), [sorted]);

  const isFiltered = query.trim() !== '' || activeCount > 0 || chips.some((c) => c.pressed);
  const clearAll = () => {
    setQuery('');
    clearFacets();
    setPressed(new Set());
  };

  return {
    hasData,
    totalCards: list.length,
    totalValue: list.reduce((sum, c) => sum + c.purchasePrice, 0),
    matchedCopies: filteredCopies.length,
    query,
    setQuery,
    ignored: search.ignored,
    filterNode,
    activeFilterCount: activeCount,
    sort,
    dir,
    toggleSort,
    hasPopularity,
    view,
    setView,
    chips,
    toggleChip,
    isFiltered,
    clearAll,
    sorted,
    shown: sorted.slice(0, visible),
    hasMore: sorted.length > visible,
    remaining: Math.max(0, sorted.length - visible),
    showMore: () => setVisible((n) => n + BROWSER_PAGE_SIZE),
    previewCards,
    previewLabels,
    previewPages,
  };
}
