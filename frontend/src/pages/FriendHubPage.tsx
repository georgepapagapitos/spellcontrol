import './FriendHubPage.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Box, FolderOpen, Layers, ListChecks } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { formatMoney } from '../lib/format-money';
import { getFriendShares, type FriendShareRow } from '../lib/share-client';
import { formatIdentity } from '../lib/display-name';
import { fetchH2H, type H2HResponse } from '../lib/game-results-client';
import { fetchFriendCollection, type FriendCard } from '../lib/cube/pool';
import { fetchFriendWants, type FriendWant } from '../lib/friends-client';
import {
  buildTradeRadar,
  buildWantRadar,
  type TradeRadarMatch,
  type WantMatch,
} from '../lib/trade-radar';
import { groupOwnedForTrade } from '../lib/trade-picker';
import { useAllocations, computeSurplusByName } from '../lib/allocations';
import { listTrades, type TradeOffer } from '../lib/trades-client';
import { TradeComposer } from '../components/trade/TradeComposer';
import { TradeOfferList } from '../components/trade/TradeOfferList';
import { isTrackingList } from '../lib/lists';
import { useCardThumb } from '../lib/card-thumbs';
import {
  filterFriendCollection,
  friendCardToPublic,
  sortFriendCollection,
  type FriendSortKey,
} from '../lib/friend-collection-filter';
import { getCardTags, useCardTagsReady } from '../lib/card-tags';
import { friendPayloadCaps } from '../lib/friend-search';
import { H2HSummary } from '../components/play/H2HSummary';
import { Tabs, type TabItem } from '../components/Tabs';
import { SearchPill } from '../components/SearchPill';
import { SortMenu, type SortMenuOption } from '../components/SortMenu';
import { useSharedFilters } from '../components/share/use-shared-filters';
import { SharedEmptyState } from '../components/share/SharedEmptyState';
import type { ShareKind } from '../lib/shared-types';

import { userMessage } from '@/lib/user-error';
/** How many collection cards render before "Show more" — the friend's real
 *  collection can be ~11.5k unique oracle cards; filtering runs over the
 *  full set regardless of this cap (see filterFriendCollection). */
const COLLECTION_PAGE_SIZE = 60;

// Popularity is EDHREC rank, where 1 is the most-played card — so "ascending"
// reads most-popular-first (see SortMenuOption.dirLabels).
const COLLECTION_SORT_OPTIONS: SortMenuOption<FriendSortKey>[] = [
  { value: 'popularity', label: 'Popularity', dirLabels: ['Most played', 'Least played'] },
  { value: 'name', label: 'Name', dirLabels: ['A → Z', 'Z → A'] },
  { value: 'cmc', label: 'Mana value', dirLabels: ['Low → high', 'High → low'] },
  { value: 'rarity', label: 'Rarity', dirLabels: ['Common first', 'Mythic first'] },
];

type HubTab = 'overview' | 'collection' | 'trades';

/** Display order + presentation for each shareable kind. */
const KIND_META: Record<ShareKind, { label: string; plural: string; Icon: typeof Layers }> = {
  deck: { label: 'Deck', plural: 'Decks', Icon: Layers },
  collection: { label: 'Collection', plural: 'Collections', Icon: BookOpen },
  cube: { label: 'Cube', plural: 'Cubes', Icon: Box },
  binder: { label: 'Binder', plural: 'Binders', Icon: FolderOpen },
  list: { label: 'List', plural: 'Lists', Icon: ListChecks },
  feedback: { label: 'Deck feedback', plural: 'Deck feedback', Icon: Layers },
  // Not in KIND_ORDER (see below) — same reasoning as 'feedback': this hub
  // browses a friend's owned resources, and a game recap isn't one.
  'game-result': { label: 'Game recap', plural: 'Game recaps', Icon: Layers },
};
const KIND_ORDER: ShareKind[] = ['deck', 'collection', 'cube', 'binder', 'list'];

function HubSkeleton() {
  return (
    <div className="friends-skeleton" role="status" aria-label="Loading" aria-busy="true">
      <span className="friends-skeleton-bar is-row" />
      <span className="friends-skeleton-bar is-row" />
      <span className="friends-skeleton-bar is-row" />
    </div>
  );
}

export function FriendHubPage() {
  const { friendId } = useParams<{ friendId: string }>();
  const status = useAuth((s) => s.status);

  const [ownerUsername, setOwnerUsername] = useState<string | null>(null);
  const [ownerDisplayName, setOwnerDisplayName] = useState<string | null>(null);
  const [shares, setShares] = useState<FriendShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry so the shares effect re-runs.
  const [sharesReloadKey, setSharesReloadKey] = useState(0);
  const [h2h, setH2h] = useState<H2HResponse | null>(null);
  const [h2hLoading, setH2hLoading] = useState(true);
  const [tab, setTab] = useState<HubTab>('overview');

  // Trade radar: cross-reference the viewer's own want lists against this
  // friend's collection — the same oracle-level fetch the cube collab pool
  // uses, so it rides the existing sharing model (no new privacy surface).
  const lists = useCollectionStore((s) => s.lists);
  // Tracking lists catalogue cards the viewer owns — never wants.
  const wantsAnything = lists.some((l) => !isTrackingList(l) && l.entries.length > 0);

  // ONE fetch of the friend's (already oracle-deduped, price/quantity-free)
  // collection feeds both the trade radar above and the Collection browser
  // below — fetched unconditionally (not gated on wantsAnything) since the
  // browser needs it regardless of whether the viewer has any want lists.
  const [collectionAttempt, setCollectionAttempt] = useState(0);
  // Keyed result: a stale key (friend switch / retry) reads as loading again,
  // so the effect never needs a synchronous reset-setState.
  const [collectionResult, setCollectionResult] = useState<{
    key: string;
    cards: FriendCard[] | null;
    error: boolean;
  } | null>(null);
  const collectionKey = `${friendId ?? ''}:${collectionAttempt}`;

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    const key = `${friendId}:${collectionAttempt}`;
    fetchFriendCollection(friendId)
      .then((res) => {
        if (!cancelled) setCollectionResult({ key, cards: res.cards, error: false });
      })
      .catch(() => {
        if (!cancelled) setCollectionResult({ key, cards: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status, collectionAttempt]);

  const collectionCurrent =
    collectionResult && collectionResult.key === collectionKey ? collectionResult : null;
  const collectionError = collectionCurrent?.error ?? false;
  const friendCards = collectionCurrent?.cards ?? null;
  const retryCollection = () => setCollectionAttempt((n) => n + 1);
  // Trade radar's own copy below still says "radar" — alias so that section
  // reads unchanged even though it now shares the Collection browser's fetch.
  const radarError = collectionError;

  const radar: TradeRadarMatch[] | null = useMemo(
    () => (friendCards ? buildTradeRadar(lists, friendCards) : null),
    [lists, friendCards]
  );

  // ── The other direction: what THEY are looking for ──────────────────
  // The radar above answers "what do they have that I want". Without this
  // half, picking what to offer is a guess. Ambient on friendship like the
  // collection fetch, and one notch thinner: a want arrives as {name,
  // oracleId} with no quantity, target price or list name — see the /wants
  // route. Its own fetch (not folded into the collection one) so a friend
  // with no want lists still gets a working Collection tab.
  const [wantsAttempt, setWantsAttempt] = useState(0);
  const [wantsResult, setWantsResult] = useState<{
    key: string;
    wants: FriendWant[] | null;
    error: boolean;
  } | null>(null);
  const wantsKey = `${friendId ?? ''}:${wantsAttempt}`;

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    const key = `${friendId}:${wantsAttempt}`;
    fetchFriendWants(friendId)
      .then((res) => {
        if (!cancelled) setWantsResult({ key, wants: res.wants, error: false });
      })
      .catch(() => {
        if (!cancelled) setWantsResult({ key, wants: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status, wantsAttempt]);

  const wantsCurrent = wantsResult && wantsResult.key === wantsKey ? wantsResult : null;
  const wantsError = wantsCurrent?.error ?? false;
  const theyWant = wantsCurrent?.wants ?? null;
  const retryWants = () => setWantsAttempt((n) => n + 1);

  // Which of the viewer's own cards are actually free to hand over — the
  // collection's "tradeable surplus" definition, the same one the composer's
  // Spare-copies filter narrows by. Grouping through `groupOwnedForTrade`
  // keeps the tradeability rules (proxies excluded, printings stacked under
  // one oracle identity) in one place.
  const myCards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  const ownedLines = useMemo(() => groupOwnedForTrade(myCards), [myCards]);
  const surplusByName = useMemo(
    () => computeSurplusByName(myCards, allocations),
    [myCards, allocations]
  );

  const wantRadar: WantMatch[] | null = useMemo(
    () => (theyWant ? buildWantRadar(theyWant, ownedLines, surplusByName) : null),
    [theyWant, ownedLines, surplusByName]
  );
  const spareMatches = wantRadar?.filter((m) => m.spare > 0).length ?? 0;
  // Mirrors `wantsAnything` on the radar above: a friend with no want lists at
  // all has a permanently dead section, so it doesn't render. Loading and
  // error both still show — the section can't know yet.
  const showWantRadar = wantsError || theyWant === null || theyWant.length > 0;

  // ── Trades with this friend ─────────────────────────────────────────
  // The radar answers "who has what I want"; this is the verb at the end of
  // it. Offers are server-authoritative (two parties, no last-write-wins), so
  // every transition re-fetches rather than patching local state.
  const [offers, setOffers] = useState<TradeOffer[] | null>(null);
  const [offersError, setOffersError] = useState(false);
  const [tradeAttempt, setTradeAttempt] = useState(0);
  const [composing, setComposing] = useState<{ want?: { oracleId: string; name: string } } | null>(
    null
  );
  const refreshTrades = () => setTradeAttempt((n) => n + 1);

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    listTrades({ withUserId: friendId })
      .then(({ offers: rows }) => {
        if (cancelled) return;
        setOffers(rows);
        setOffersError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOffers([]);
        setOffersError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status, tradeAttempt]);

  const openTrades = (offers ?? []).filter((o) => o.status === 'proposed');
  // Only offers awaiting THIS viewer count toward the tab badge — an offer
  // they sent is waiting on the other person, not on them.
  const awaitingMe = openTrades.filter((o) => !o.mine).length;

  // ── Collection browser: search + the shared filter dialog + sort ────
  // Same three controls as the authed collection and the public share views
  // (SearchPill with the filter door in its trailing slot, SortMenu). The
  // friend payload is card facts only, so the dialog mounts with the
  // `card-facts` facet set and hides every row it couldn't answer.
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionSort, setCollectionSort] = useState<FriendSortKey>('popularity');
  const [collectionDir, setCollectionDir] = useState<'asc' | 'desc'>('asc');
  const [collectionVisible, setCollectionVisible] = useState(COLLECTION_PAGE_SIZE);
  const friendPublicCards = useMemo(
    () => (friendCards ?? []).map(friendCardToPublic),
    [friendCards]
  );
  // Rules text and legality ride the payload only since the endpoint started
  // sending them; probe what this payload actually has so the dialog and the
  // `o:` / `f:` search agree on what can be answered.
  const friendCaps = useMemo(() => friendPayloadCaps(friendCards ?? []), [friendCards]);
  const {
    filterNode: collectionFilterNode,
    matches: collectionMatches,
    activeCount: collectionFilterCount,
    clear: clearCollectionFilters,
  } = useSharedFilters(friendPublicCards, {
    withPrice: false,
    facets: 'card-facts',
    hasOracleText: friendCaps.oracleText,
    hasLegalities: friendCaps.legalities,
  });

  // `otag:` needs the tag snapshot; load it only when the query asks for one
  // (same gate as CardSearchPanel — the snapshot is a multi-MB artifact).
  const collectionWantsTags = /\b(otag|oracletag|function)[:=]/i.test(collectionQuery);
  const collectionTagsReady = useCardTagsReady(collectionWantsTags);

  const friendSearchResult = useMemo(
    () =>
      friendCards
        ? filterFriendCollection(friendCards, {
            query: collectionQuery,
            tagsFor: collectionTagsReady ? getCardTags : undefined,
            caps: friendCaps,
          })
        : { cards: [], ignored: [] },
    [friendCards, friendCaps, collectionQuery, collectionTagsReady]
  );
  // The search narrows by name/syntax; the dialog's facets narrow the rest,
  // matching against each card's public-card projection (by index, so the
  // conversion runs once per payload rather than once per keystroke).
  const filteredFriendCards = useMemo(() => {
    const publicByCard = new Map<FriendCard, (typeof friendPublicCards)[number]>();
    (friendCards ?? []).forEach((c, i) => publicByCard.set(c, friendPublicCards[i]));
    const kept = friendSearchResult.cards.filter((c) => {
      const pc = publicByCard.get(c);
      return pc ? collectionMatches(pc) : true;
    });
    return sortFriendCollection(kept, collectionSort, collectionDir);
  }, [
    friendCards,
    friendPublicCards,
    friendSearchResult,
    collectionMatches,
    collectionSort,
    collectionDir,
  ]);

  // A friend switch, a retry, a search, a filter, or a sort change all
  // invalidate the current "show more" depth — reset to the first page. The
  // filtered list's identity changes on exactly those events, so it is the
  // reset key. Adjusted during render (the React-documented pattern for
  // resetting state on a derived-value change) rather than in an effect,
  // which would cascade an extra render.
  const [lastFilteredList, setLastFilteredList] = useState(filteredFriendCards);
  if (filteredFriendCards !== lastFilteredList) {
    setLastFilteredList(filteredFriendCards);
    setCollectionVisible(COLLECTION_PAGE_SIZE);
  }

  const visibleFriendCards = filteredFriendCards.slice(0, collectionVisible);
  const hasMoreFriendCards = filteredFriendCards.length > collectionVisible;

  // Mirrors the collection's sort behavior: re-picking the active field
  // flips direction (SortMenu's Reverse action), a new field resets to asc.
  const toggleCollectionSort = (key: FriendSortKey) => {
    if (key === collectionSort) setCollectionDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setCollectionSort(key);
      setCollectionDir('asc');
    }
  };

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    getFriendShares(friendId)
      .then((res) => {
        if (cancelled) return;
        setOwnerUsername(res.ownerUsername);
        setOwnerDisplayName(res.ownerDisplayName);
        setShares(res.shares);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          userMessage(
            err,
            "Couldn't load what this friend shares. Check your connection and try again."
          )
        );
        setShares([]);
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status, sharesReloadKey]);

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    fetchH2H(friendId)
      .then((data) => {
        if (!cancelled) setH2h(data);
      })
      .catch(() => {
        // Silently degrade — the hub page works fine without the strip.
      })
      .finally(() => {
        if (!cancelled) setH2hLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status]);

  if (status === 'guest') {
    return (
      <div className="friend-hub">
        <BackLink />
        <div className="friends-signin-prompt">
          <p className="friends-signin-title">Sign in to view shared content</p>
          <p className="friends-signin-body">
            Sign in to see what your friends have shared with you.
          </p>
          <Link to="/auth" className="friends-signin-btn">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const loading = shares === null;
  const sharesList = shares ?? [];
  const identity = ownerUsername
    ? formatIdentity({ username: ownerUsername, displayName: ownerDisplayName })
    : null;
  // Today's exact `@username` phrasing, reused verbatim in two spots: as the
  // heading itself when no display name is set, or demoted to a secondary
  // line/prose reference once one is. Either way, a user with no display name
  // sees byte-identical output to today.
  const handle = ownerUsername ? `@${ownerUsername}` : null;
  const hasDisplayName = identity !== null && identity.secondary !== null;
  const heading = hasDisplayName ? identity!.primary : (handle ?? 'Shared with friends');
  const who = hasDisplayName ? identity!.primary : (handle ?? 'this friend');

  const hubTabs: TabItem<HubTab>[] = [
    { id: 'overview', label: 'Overview', controls: 'friend-hub-panel-overview' },
    { id: 'collection', label: 'Collection', controls: 'friend-hub-panel-collection' },
    {
      id: 'trades',
      label: awaitingMe > 0 ? `Trades (${awaitingMe})` : 'Trades',
      controls: 'friend-hub-panel-trades',
    },
  ];

  return (
    <div className={`friend-hub${tab === 'collection' ? ' friend-hub--wide' : ''}`}>
      <BackLink />
      <h1 className="friend-hub-heading">{heading}</h1>
      {hasDisplayName && <p className="friend-hub-handle">{handle}</p>}
      <p className="friend-hub-sub">Shared with friends</p>

      <Tabs
        ariaLabel="Friend hub views"
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={hubTabs}
        className="friend-hub-tabs"
      />

      <div
        role="tabpanel"
        id="friend-hub-panel-overview"
        aria-labelledby="sc-tab-overview"
        hidden={tab !== 'overview'}
      >
        {h2hLoading ? (
          <div
            className="friend-hub-h2h-skeleton"
            aria-label="Loading head-to-head record"
            aria-busy="true"
          />
        ) : (
          h2h &&
          h2h.summary.gamesPlayed > 0 && (
            <section className="friend-hub-section" aria-label="Head-to-head record">
              <h2 className="friend-hub-section-head">Head-to-head</h2>
              <div className="friend-hub-h2h-card">
                <H2HSummary data={h2h} />
              </div>
            </section>
          )
        )}

        {wantsAnything && (
          <section className="friend-hub-section" aria-label="Trade radar">
            <h2 className="friend-hub-section-head">Trade radar</h2>
            {radarError ? (
              <p className="friend-hub-radar-note" role="alert">
                Couldn’t check {who}’s collection against your want lists.{' '}
                <button
                  type="button"
                  className="btn-link friend-hub-radar-retry"
                  onClick={retryCollection}
                >
                  Try again
                </button>
              </p>
            ) : radar === null ? (
              <div
                className="friend-hub-radar-skeleton"
                aria-label="Checking your want lists"
                aria-busy="true"
              />
            ) : radar.length === 0 ? (
              <p className="friend-hub-radar-note" role="status">
                Nothing on your want lists is in {who}’s collection.
              </p>
            ) : (
              <>
                <p className="friend-hub-radar-lede">
                  {radar.length === 1
                    ? `1 card on your want list — ${who} has it`
                    : `${radar.length} cards on your want list — ${who} has these`}
                </p>
                <ul
                  className="friend-hub-radar-strip"
                  aria-label="Want-list cards this friend owns"
                >
                  {radar.map((m) => (
                    <RadarCardTile key={m.name} match={m} />
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn friend-hub-radar-propose"
                  onClick={() => setComposing({})}
                >
                  Propose a trade
                </button>
              </>
            )}
          </section>
        )}

        {showWantRadar && (
          <section className="friend-hub-section" aria-label="What this friend is looking for">
            <h2 className="friend-hub-section-head">They’re looking for</h2>
            {wantsError ? (
              <p className="friend-hub-radar-note" role="alert">
                Couldn’t check your collection against {who}’s want lists.{' '}
                <button
                  type="button"
                  className="btn-link friend-hub-radar-retry"
                  onClick={retryWants}
                >
                  Try again
                </button>
              </p>
            ) : wantRadar === null ? (
              <div
                className="friend-hub-radar-skeleton"
                aria-label={`Checking ${who}’s want lists`}
                aria-busy="true"
              />
            ) : wantRadar.length === 0 ? (
              <p className="friend-hub-radar-note" role="status">
                Nothing you own is on {who}’s want lists.
              </p>
            ) : (
              <>
                <p className="friend-hub-radar-lede">
                  {wantRadar.length === 1
                    ? `1 card you own is on ${who}’s want list`
                    : `${wantRadar.length} cards you own are on ${who}’s want list`}
                  {spareMatches > 0
                    ? ` — ${spareMatches} you can spare`
                    : ' — every copy is in a deck or cube'}
                </p>
                <ul
                  className="friend-hub-radar-strip"
                  aria-label={`Cards you own that ${who} wants`}
                >
                  {wantRadar.map((m) => (
                    <WantCardTile key={m.oracleId || m.name} match={m} />
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn friend-hub-radar-propose"
                  onClick={() => setComposing({})}
                >
                  Propose a trade
                </button>
              </>
            )}
          </section>
        )}

        {error && (
          <p className="friends-error" role="alert">
            <span>{error}</span>{' '}
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError(null);
                setShares(null);
                setSharesReloadKey((k) => k + 1);
              }}
            >
              Retry
            </button>
          </p>
        )}

        {loading ? (
          <HubSkeleton />
        ) : sharesList.length === 0 ? (
          <p className="friends-empty" role="status">
            {ownerUsername
              ? `${hasDisplayName ? identity!.primary : handle} hasn’t`
              : 'This person hasn’t'}{' '}
            shared anything with friends yet.
          </p>
        ) : (
          KIND_ORDER.map((kind) => {
            const rows = sharesList.filter((s) => s.kind === kind);
            if (rows.length === 0) return null;
            const { plural } = KIND_META[kind];
            return (
              <section key={kind} className="friend-hub-section" aria-label={plural}>
                <h2 className="friend-hub-section-head">{plural}</h2>
                <ul className="friend-hub-list">
                  {rows.map((s) => (
                    <HubRow key={s.token} share={s} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <div
        role="tabpanel"
        id="friend-hub-panel-collection"
        aria-labelledby="sc-tab-collection"
        hidden={tab !== 'collection'}
      >
        <p className="friend-hub-collection-contract">
          What {who} owns — never quantities or values.
        </p>

        {collectionError ? (
          <p className="friend-hub-radar-note" role="alert">
            Couldn’t load {who}’s collection.{' '}
            <button
              type="button"
              className="btn-link friend-hub-radar-retry"
              onClick={retryCollection}
            >
              Try again
            </button>
          </p>
        ) : friendCards === null ? (
          <div
            className="friend-hub-collection-skeleton"
            aria-label={`Loading ${who}’s collection`}
            aria-busy="true"
          />
        ) : (
          <>
            <div className="friend-hub-collection-controls">
              <SearchPill
                value={collectionQuery}
                onChange={setCollectionQuery}
                placeholder="Search by card name"
                ariaLabel={`Search ${who}’s collection by card name`}
                className="friend-hub-collection-search"
                trailing={collectionFilterNode}
              />
              <SortMenu<FriendSortKey>
                ariaLabel="Sort"
                value={collectionSort}
                dir={collectionDir}
                options={COLLECTION_SORT_OPTIONS}
                onChange={toggleCollectionSort}
              />
            </div>

            {friendSearchResult.ignored.length > 0 && (
              <p className="friend-hub-search-note" role="status">
                {friendSearchResult.ignored.join(', ')}{' '}
                {friendSearchResult.ignored.length === 1 ? 'isn’t' : 'aren’t'} searchable in this
                collection — its card data doesn’t carry what{' '}
                {friendSearchResult.ignored.length === 1 ? 'it' : 'they'} read. The rest of your
                search still applied.
              </p>
            )}

            {filteredFriendCards.length === 0 ? (
              <div role="status">
                <SharedEmptyState
                  empty={friendCards.length === 0}
                  emptyTagline={`${who} hasn’t added anything to their collection yet.`}
                  emptyHint="There's nothing to browse until they do."
                  filteredTagline="No cards match your search or filters."
                  onClearSearch={
                    collectionQuery || collectionFilterCount > 0
                      ? () => {
                          setCollectionQuery('');
                          clearCollectionFilters();
                        }
                      : undefined
                  }
                />
              </div>
            ) : (
              <>
                <ul
                  className="shared-card-grid shared-card-grid--small friend-hub-collection-grid"
                  aria-label={`${who}’s collection`}
                >
                  {visibleFriendCards.map((c) => (
                    <FriendCollectionTile key={c.oracleId} card={c} />
                  ))}
                </ul>
                {hasMoreFriendCards && (
                  <button
                    type="button"
                    className="btn friend-hub-collection-more"
                    onClick={() => setCollectionVisible((n) => n + COLLECTION_PAGE_SIZE)}
                  >
                    Show more ({filteredFriendCards.length - collectionVisible} left)
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="friend-hub-panel-trades"
        aria-labelledby="sc-tab-trades"
        hidden={tab !== 'trades'}
      >
        <div className="friend-hub-trades-head">
          <p className="friend-hub-collection-contract">
            Offers either way. Accepting settles both collections.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setComposing({})}>
            Propose a trade
          </button>
        </div>

        {offersError ? (
          <p className="friend-hub-radar-note" role="alert">
            Couldn’t load your trades with {who}.{' '}
            <button
              type="button"
              className="btn-link friend-hub-radar-retry"
              onClick={refreshTrades}
            >
              Try again
            </button>
          </p>
        ) : offers === null ? (
          <div
            className="friend-hub-collection-skeleton"
            aria-label={`Loading trades with ${who}`}
            aria-busy="true"
          />
        ) : (
          <TradeOfferList
            offers={offers}
            onChanged={refreshTrades}
            onCounter={(offer) =>
              // A counter is just a new offer the other way — prefill it with
              // the first card they asked for so the composer opens with the
              // conversation already in it.
              setComposing({
                want: offer.give[0]
                  ? { oracleId: offer.give[0].oracleId, name: offer.give[0].name }
                  : undefined,
              })
            }
          />
        )}
      </div>

      {composing && friendId && (
        <TradeComposer
          friendId={friendId}
          friendName={who}
          friendCards={friendCards}
          friendCardsLoading={friendCards === null && !collectionError}
          friendCardsError={collectionError}
          onRetryFriendCards={retryCollection}
          friendWants={theyWant}
          initialWant={composing.want}
          onClose={() => setComposing(null)}
          onSent={() => {
            setComposing(null);
            setTab('trades');
            refreshTrades();
          }}
        />
      )}
    </div>
  );
}

/** One want-list card the friend owns: thumbnail (CDN via useCardThumb, never
 *  the throttled Scryfall API), name, and which list wants it + target price.
 *  Exported for reuse by TonightTrades.tsx (w5-tonight-trades) — assumes a
 *  list-item context (`<li>`) it doesn't provide itself, so callers wrap it
 *  in their own `<ul>`. */
export function RadarCardTile({ match }: { match: TradeRadarMatch }) {
  const thumb = useCardThumb(match.name, 'small');
  const subParts = [
    match.listNames.length > 1
      ? `${match.listNames[0]} +${match.listNames.length - 1}`
      : match.listNames[0],
  ];
  // Target prices render in the currency they were ENTERED in (never converted
  // or relabeled to the viewer's display currency) — see ListEntry.currency.
  if (match.targetPrice !== undefined)
    subParts.push(
      `${formatMoney(match.targetPrice, { currency: match.currency ?? 'USD' })} target`
    );
  const sub = subParts.join(' · ');
  return (
    <li className="friend-hub-radar-card">
      {thumb ? (
        <img
          className="friend-hub-radar-thumb"
          src={thumb}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="friend-hub-radar-thumb is-placeholder" aria-hidden />
      )}
      <span className="friend-hub-radar-name" title={match.name}>
        {match.name}
        {match.quantity > 1 && <span className="friend-hub-radar-qty"> ×{match.quantity}</span>}
      </span>
      <span className="friend-hub-radar-sub" title={sub}>
        {sub}
      </span>
    </li>
  );
}

/**
 * One card the viewer owns that this friend is looking for.
 *
 * The sub-line is the whole point: "2 spare" means copies bound to no deck and
 * no cube, so offering it costs nothing — the same surplus definition the
 * composer's Spare-copies filter narrows by. Everything else is honest about
 * why it isn't free to give, rather than hiding the match.
 */
function WantCardTile({ match }: { match: WantMatch }) {
  const thumb = useCardThumb(match.name, 'small');
  const sub =
    match.spare > 0
      ? `${match.spare} spare`
      : match.owned === 1
        ? 'your only copy'
        : `${match.owned} copies, none spare`;
  return (
    <li className={`friend-hub-radar-card${match.spare > 0 ? ' is-spare' : ''}`}>
      {thumb ? (
        <img
          className="friend-hub-radar-thumb"
          src={thumb}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="friend-hub-radar-thumb is-placeholder" aria-hidden />
      )}
      <span className="friend-hub-radar-name" title={match.name}>
        {match.name}
      </span>
      <span className="friend-hub-radar-sub" title={sub}>
        {sub}
      </span>
    </li>
  );
}

/** One tile in the Collection browser grid — thumbnail (CDN via useCardThumb)
 *  + name only. No quantity, no price: FriendCard never carries either (see
 *  backend/src/routes/friends.ts), so there's nothing to accidentally render. */
function FriendCollectionTile({ card }: { card: FriendCard }) {
  const thumb = useCardThumb(card.name, 'small');
  return (
    <li className="friend-hub-collection-tile">
      {thumb ? (
        <img
          className="friend-hub-radar-thumb"
          src={thumb}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="friend-hub-radar-thumb is-placeholder" aria-hidden />
      )}
      <span className="friend-hub-radar-name" title={card.name}>
        {card.name}
      </span>
    </li>
  );
}

function HubRow({ share }: { share: FriendShareRow }) {
  const { label: kindLabel, Icon } = KIND_META[share.kind];
  return (
    <li className="friend-hub-row">
      <span className="friend-hub-row-icon" aria-hidden>
        <Icon width={18} height={18} />
      </span>
      <span className="friend-hub-row-name" title={share.label}>
        {share.label}
      </span>
      <Link
        to={`/s/${share.token}`}
        className="friend-hub-row-open"
        aria-label={`View ${share.label} (${kindLabel})`}
      >
        View
      </Link>
    </li>
  );
}

function BackLink() {
  return (
    <Link to="/friends" className="friend-hub-back">
      <ArrowLeft width={16} height={16} aria-hidden />
      Friends
    </Link>
  );
}
