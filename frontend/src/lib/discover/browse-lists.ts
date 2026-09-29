import type { ScryfallCard } from '@/deck-builder/types';
import { searchCards, searchCardsLive } from '@/deck-builder/services/scryfall/client';
import {
  fetchEdhrecTop,
  isEdhrecTopType,
  normalizeColors,
  type EdhrecTopKind,
  type EdhrecTopPeriod,
  type EdhrecTopType,
} from './edhrec-top';

/**
 * The browse lists on the Search landing and their full pages
 * (`/search/top/:list`). The popularity lists are EDHREC's, read from our
 * backend's daily snapshot (lib/discover/edhrec-top.ts); the lists that are facts
 * about the cards themselves come from Scryfall, which we already rely on
 * for every card: Game Changers, the Commander ban list and new commanders.
 */

export type BrowseListId =
  'commanders' | 'new-commanders' | 'cards' | 'game-changers' | 'salt' | 'banned';

export interface BrowseListDef {
  id: BrowseListId;
  /** The full page's title. */
  title: string;
  /** The rail's title on the Search landing. */
  railTitle: string;
  /** The rail's one short meta beside its title, hidden on a phone. */
  railMeta?: string;
  source: 'edhrec' | 'scryfall';
  /** Needs the network even when the offline card data is on the device. */
  needsNetwork: boolean;
  /** Each entry is a commander, so its preview offers "Build a deck". */
  commanders: boolean;
  /** Which filters the full page offers. */
  filters: { period: boolean; colors: boolean; type: boolean };
  /** A list Scryfall pages through rather than one EDHREC page of 100. */
  paged: boolean;
}

const NO_FILTERS = { period: false, colors: false, type: false };

/** In the order the Search landing shows them. */
export const BROWSE_LISTS: readonly BrowseListDef[] = [
  {
    id: 'commanders',
    title: 'Top commanders',
    railTitle: 'Top commanders',
    railMeta: 'This week',
    source: 'edhrec',
    needsNetwork: true,
    commanders: true,
    filters: { period: true, colors: true, type: false },
    paged: false,
  },
  {
    id: 'new-commanders',
    title: 'New commanders',
    railTitle: 'New commanders',
    source: 'scryfall',
    needsNetwork: true,
    commanders: true,
    filters: NO_FILTERS,
    paged: true,
  },
  {
    id: 'cards',
    title: 'Top cards',
    railTitle: 'Top cards',
    railMeta: 'This week',
    source: 'edhrec',
    needsNetwork: true,
    commanders: false,
    filters: { period: true, colors: true, type: true },
    paged: false,
  },
  {
    id: 'game-changers',
    title: 'Game Changers',
    railTitle: 'Game Changers',
    source: 'scryfall',
    needsNetwork: false,
    commanders: false,
    filters: NO_FILTERS,
    paged: false,
  },
  {
    id: 'salt',
    title: 'Saltiest cards',
    railTitle: 'Saltiest cards',
    source: 'edhrec',
    needsNetwork: true,
    commanders: false,
    filters: NO_FILTERS,
    paged: false,
  },
  {
    id: 'banned',
    title: 'Banned in Commander',
    railTitle: 'Banned in Commander',
    source: 'scryfall',
    needsNetwork: false,
    commanders: false,
    filters: NO_FILTERS,
    paged: false,
  },
];

export function browseListDef(id: string | undefined): BrowseListDef | undefined {
  return BROWSE_LISTS.find((l) => l.id === id);
}

export interface BrowseFilters {
  /** The window the viewer picked; see {@link effectivePeriod}. */
  period: EdhrecTopPeriod;
  /** WUBRG letters, `C`, or '' for every colour. */
  colors: string;
  type: EdhrecTopType | '';
  /** Only cards in the viewer's collection. */
  ownedOnly: boolean;
}

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  period: 'week',
  colors: '',
  type: '',
  ownedOnly: false,
};

const PERIODS: readonly EdhrecTopPeriod[] = ['week', 'month', 'year'];

/** Filters read from a list page's URL, dropping anything the list doesn't
 *  offer so a hand-edited link can't ask for a list that doesn't exist. */
export function parseBrowseFilters(params: URLSearchParams, def: BrowseListDef): BrowseFilters {
  const period = params.get('period');
  const type = params.get('type');
  return {
    period:
      def.filters.period && PERIODS.includes(period as EdhrecTopPeriod)
        ? (period as EdhrecTopPeriod)
        : 'week',
    colors: def.filters.colors ? normalizeColors(params.get('colors')) : '',
    type: def.filters.type && isEdhrecTopType(type) ? type : '',
    ownedOnly: params.get('show') === 'owned',
  };
}

/** The URL query for a list page's filters; defaults are left out. */
export function browseFiltersToParams(filters: BrowseFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.period !== 'week') out.period = filters.period;
  if (filters.colors) out.colors = filters.colors;
  if (filters.type) out.type = filters.type;
  if (filters.ownedOnly) out.show = 'owned';
  return out;
}

/** EDHREC's colour and type lists only cover the past 2 years, so either
 *  filter locks the window to it. */
export function periodLocked(filters: BrowseFilters): boolean {
  return filters.colors !== '' || filters.type !== '';
}

export function effectivePeriod(filters: BrowseFilters): EdhrecTopPeriod {
  return periodLocked(filters) ? 'year' : filters.period;
}

export interface BrowseItem {
  name: string;
  /** The full card when the list came from Scryfall; EDHREC lists are names. */
  card?: ScryfallCard;
  numDecks?: number;
  potentialDecks?: number | null;
  salt?: number | null;
  releasedAt?: string;
}

/** Where an EDHREC list came from and how old it is, for the attribution. */
export interface EdhrecProvenance {
  fetchedAt: number;
  stale: boolean;
  sourceUrl: string;
}

export interface BrowsePage {
  items: BrowseItem[];
  /** More pages behind this one (paged lists only). */
  hasMore: boolean;
  edhrec?: EdhrecProvenance;
}

const EDHREC_KIND: Partial<Record<BrowseListId, EdhrecTopKind>> = {
  commanders: 'commanders',
  cards: 'cards',
  salt: 'salt',
};

/** Today as Scryfall's `date<=` wants it, in the viewer's own calendar, so a
 *  set spoiled ahead of its release date stays out of "new". */
function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** One page of a list. EDHREC lists are a single page of up to 100. */
export async function loadBrowseList(
  id: BrowseListId,
  filters: BrowseFilters = DEFAULT_BROWSE_FILTERS,
  page = 1
): Promise<BrowsePage> {
  const kind = EDHREC_KIND[id];
  if (kind) {
    const list = await fetchEdhrecTop({
      kind,
      period: effectivePeriod(filters),
      colors: filters.colors,
      type: filters.type || undefined,
    });
    // A partner pair ("Kraum // Tymna") is two commanders, not one card: it
    // has no single card to show or build around.
    const entries =
      kind === 'commanders' ? list.entries.filter((e) => !e.name.includes(' // ')) : list.entries;
    return {
      items: entries.map((e) => ({
        name: e.name,
        numDecks: e.numDecks,
        potentialDecks: e.potentialDecks,
        salt: e.salt,
      })),
      hasMore: false,
      edhrec: { fetchedAt: list.fetchedAt, stale: list.stale, sourceUrl: list.sourceUrl },
    };
  }
  if (id === 'new-commanders') {
    // First printings only, so a reprinted commander isn't "new"; newest first.
    const res = await searchCardsLive(`is:commander not:reprint date<=${today()}`, [], {
      order: 'released',
      page,
    });
    return {
      items: res.data.map((card) => ({ name: card.name, card, releasedAt: card.released_at })),
      hasMore: res.has_more,
    };
  }
  const res =
    id === 'game-changers'
      ? await searchCards('is:gamechanger', [], { order: 'edhrec' })
      : // A banned card isn't legal, so the usual f:commander filter would hide
        // every one of them.
        await searchCards('banned:commander', [], { order: 'edhrec', skipFormatFilter: true });
  return { items: res.data.map((card) => ({ name: card.name, card })), hasMore: false };
}

/** Lower-cased names the viewer owns, each card under its full name and its
 *  front face, since EDHREC names a double-faced card by its front. */
export function ownedNameSet(cards: readonly { name: string }[]): Set<string> {
  const out = new Set<string>();
  for (const c of cards) {
    const lower = c.name.toLowerCase();
    out.add(lower);
    out.add(lower.split(' // ')[0]);
  }
  return out;
}

export function isOwnedName(owned: ReadonlySet<string>, name: string): boolean {
  const lower = name.toLowerCase();
  return owned.has(lower) || owned.has(lower.split(' // ')[0]);
}
