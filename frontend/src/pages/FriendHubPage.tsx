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
import { buildTradeRadar, type TradeRadarMatch } from '../lib/trade-radar';
import { listTrades, type TradeOffer } from '../lib/trades-client';
import { TradeComposer } from '../components/trade/TradeComposer';
import { TradeOfferList } from '../components/trade/TradeOfferList';
import { isTrackingList } from '../lib/lists';
import { useCardThumb } from '../lib/card-thumbs';
import { filterFriendCollection } from '../lib/friend-collection-filter';
import { H2HSummary } from '../components/play/H2HSummary';
import { Tabs, type TabItem } from '../components/Tabs';
import { SearchPill } from '../components/SearchPill';
import { ColorPip } from '../components/shared/ManaSymbol';
import { SharedEmptyState } from '../components/share/SharedEmptyState';
import type { ShareKind } from '../lib/shared-types';

/** How many collection cards render before "Show more" — the friend's real
 *  collection can be ~11.5k unique oracle cards; filtering runs over the
 *  full set regardless of this cap (see filterFriendCollection). */
const COLLECTION_PAGE_SIZE = 60;

const COLOR_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
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
    <div className="friends-skeleton" aria-label="Loading" aria-busy="true">
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
      .then((rows) => {
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

  // ── Collection browser filters ──────────────────────────────────────
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionColors, setCollectionColors] = useState<Set<string>>(new Set());
  const [collectionVisible, setCollectionVisible] = useState(COLLECTION_PAGE_SIZE);

  const filteredFriendCards = useMemo(
    () =>
      friendCards
        ? filterFriendCollection(friendCards, {
            query: collectionQuery,
            colors: collectionColors,
          })
        : [],
    [friendCards, collectionQuery, collectionColors]
  );

  // A friend switch, a retry, or a filter change all invalidate the current
  // "show more" depth — reset to the first page. Adjusted during render (the
  // React-documented pattern for resetting state on a prop/derived-value
  // change) rather than in an effect, which would cascade an extra render.
  const collectionResetKey = `${friendId ?? ''}:${collectionAttempt}:${collectionQuery}:${[...collectionColors].sort().join(',')}`;
  const [lastResetKey, setLastResetKey] = useState(collectionResetKey);
  if (collectionResetKey !== lastResetKey) {
    setLastResetKey(collectionResetKey);
    setCollectionVisible(COLLECTION_PAGE_SIZE);
  }

  const visibleFriendCards = filteredFriendCards.slice(0, collectionVisible);
  const hasMoreFriendCards = filteredFriendCards.length > collectionVisible;

  const toggleCollectionColor = (c: string) => {
    setCollectionColors((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
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
        setError(err instanceof Error ? err.message : 'Failed to load shared content.');
        setShares([]);
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status]);

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

        {error && (
          <p className="friends-error" role="alert">
            {error}
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
              />
              <div className="color-filter-row" role="group" aria-label="Filter by color">
                {COLOR_OPTIONS.map((c) => {
                  const active = collectionColors.has(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={`color-filter-btn${active ? ' is-active' : ''}`}
                      onClick={() => toggleCollectionColor(c.key)}
                      aria-label={c.label}
                      aria-pressed={active}
                      title={c.label}
                    >
                      <ColorPip color={c.key} pip="lg" />
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredFriendCards.length === 0 ? (
              <div role="status">
                <SharedEmptyState
                  empty={friendCards.length === 0}
                  emptyTagline={`${who} hasn’t added anything to their collection yet.`}
                  emptyHint="There's nothing to browse until they do."
                  filteredTagline="No cards match your search or filters."
                  onClearSearch={
                    collectionQuery || collectionColors.size > 0
                      ? () => {
                          setCollectionQuery('');
                          setCollectionColors(new Set());
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
