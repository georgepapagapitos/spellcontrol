import '@/styles/social-shared.css';
import './FriendHubPage.css';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSignInPath } from '@/lib/account/sign-in-path';
import { BackLink } from '@/components/app-shell/BackLink';
import { BookOpen, Box, FolderOpen, Layers, ListChecks } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { getFriendShares, type FriendShareRow } from '@/lib/social/share-client';
import { formatIdentity } from '@/lib/social/display-name';
import { fetchH2H, type H2HResponse } from '@/lib/play/game-results-client';
import {
  fetchFriendCollectionCopies,
  fetchFriendWants,
  type FriendWant,
} from '@/lib/social/friends-client';
import { publicCardsToFriendCards } from '@/lib/social/friend-collection-filter';
import {
  buildTradeRadar,
  buildWantRadar,
  type TradeRadarMatch,
  type WantMatch,
} from '@/lib/trade/trade-radar';
import { groupOwnedForTrade } from '@/lib/trade/trade-picker';
import { useAllocations, computeSurplusByName } from '@/lib/collection/allocations';
import { listTrades, subscribeTradesChanged, type TradeOffer } from '@/lib/trade/trades-client';
import { useCounterSeed } from '@/lib/trade/use-counter-seed';
import { TradeOfferList } from '../components/trade/TradeOfferList';
import { TradeWorkspace } from '../components/trade/TradeWorkspace';
import { RadarCardTile } from '../components/trade/RadarCardTile';
import { isTrackingList } from '@/lib/collection/lists';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { fetchFriendDecks, type FriendDeck } from '@/lib/social/friend-decks-client';
import { DeckLibrary, type LibraryDeck } from '../components/decks/DeckLibrary';
import { H2HSummary } from '../components/play/H2HSummary';
import { Tabs, type TabItem } from '@/components/overlays/Tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import type { PublicCard, ShareKind } from '@/lib/social/shared-types';

import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
import { Surface } from '@/components/shared/Surface';
import { SectionHeader } from '@/components/shared/SectionHeader';

const HUB_TABS = ['overview', 'decks', 'collection', 'trades'] as const;
type HubTab = (typeof HUB_TABS)[number];
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
  const signInHref = useSignInPath();

  const [ownerUsername, setOwnerUsername] = useState<string | null>(null);
  const [ownerDisplayName, setOwnerDisplayName] = useState<string | null>(null);
  const [shares, setShares] = useState<FriendShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry so the shares effect re-runs.
  const [sharesReloadKey, setSharesReloadKey] = useState(0);
  const [h2h, setH2h] = useState<H2HResponse | null>(null);
  const [h2hLoading, setH2hLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  // Arriving to counter an offer lands on the Collection tab, where the
  // counter's draft is built and reviewed. The tab lives in `?tab=` so a link
  // (Home's "answer this trade") and a reload land on the same view; Overview
  // is the bare URL.
  const counterId = searchParams.get('counter');
  const tabParam = searchParams.get('tab');
  const tab: HubTab = counterId
    ? 'collection'
    : (HUB_TABS.find((t) => t === tabParam) ?? 'overview');
  const setTab = (next: HubTab) => {
    const params = new URLSearchParams(searchParams);
    params.delete('counter');
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

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

  // Trade radar: cross-reference the viewer's own want lists against this
  // friend's collection — the same oracle-level fetch the cube collab pool
  // uses, so it rides the existing sharing model (no new privacy surface).
  const lists = useCollectionStore((s) => s.lists);
  // Tracking lists catalogue cards the viewer owns — never wants.
  const wantsAnything = lists.some((l) => !isTrackingList(l) && l.entries.length > 0);

  // ONE fetch of the friend's collection, copy by copy, feeds the trade radar
  // below and the Collection tab's workspace. It is fetched unconditionally
  // (not gated on wantsAnything): the workspace needs it whether or not the
  // viewer has want lists. The radar reads it through `publicCardsToFriendCards`
  // (oracle-level), so there is no second request for it.
  const [collectionAttempt, setCollectionAttempt] = useState(0);
  // Keyed result: a stale key (friend switch / retry) reads as loading again,
  // so the effect never needs a synchronous reset-setState.
  const [collectionResult, setCollectionResult] = useState<{
    key: string;
    cards: PublicCard[] | null;
    error: boolean;
    /** Set to Private by its owner (T136): the empty list is a choice. */
    isPrivate?: boolean;
  } | null>(null);
  const collectionKey = `${friendId ?? ''}:${collectionAttempt}`;

  // ── The friend's deck library ───────────────────────────────────────
  // Published + friends-rung, merged server-side. Keyed the same way the
  // collection fetch is, so a friend switch or a retry reads as loading
  // rather than briefly showing the previous friend's shelf.
  const [decksAttempt, setDecksAttempt] = useState(0);
  const [decksResult, setDecksResult] = useState<{
    key: string;
    decks: FriendDeck[] | null;
    error: boolean;
  } | null>(null);
  const decksKey = `${friendId ?? ''}:${decksAttempt}`;
  const friendDecks = decksResult?.key === decksKey ? decksResult.decks : null;
  const decksError = decksResult?.key === decksKey && decksResult.error;
  const retryDecks = () => setDecksAttempt((n) => n + 1);

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    const key = `${friendId}:${decksAttempt}`;
    fetchFriendDecks(friendId)
      .then((res) => {
        if (!cancelled) setDecksResult({ key, decks: res.decks, error: false });
      })
      .catch(() => {
        if (!cancelled) setDecksResult({ key, decks: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status, decksAttempt]);

  const libraryDecks: LibraryDeck[] = useMemo(
    () =>
      (friendDecks ?? []).map((d) => ({
        id: d.deckId,
        href: d.href,
        name: d.name,
        format: d.format,
        commanderName: d.commanderName,
        commanderImage: d.commanderImage,
        colorIdentity: d.colorIdentity,
        bracket: d.bracket,
        estimatedBracket: d.estimatedBracket,
        updatedAt: d.updatedAt,
        // No views/copies on this surface — those are publication stats, and
        // half these decks were never published.
        statsLine: null,
        // Says WHY you can see it: "anyone can" vs "they showed you".
        badge: d.visibility === 'friends' ? 'Friends only' : null,
      })),
    [friendDecks]
  );

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    const key = `${friendId}:${collectionAttempt}`;
    fetchFriendCollectionCopies(friendId)
      .then((res) => {
        if (!cancelled) {
          setCollectionResult({
            key,
            cards: res.cards,
            error: false,
            isPrivate: !!res.collectionPrivate,
          });
        }
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
  const friendCopies = collectionCurrent?.cards ?? null;
  const friendCards = useMemo(
    () => (friendCopies ? publicCardsToFriendCards(friendCopies) : null),
    [friendCopies]
  );
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
  // `hydrating` is not "I know what you own": on a device that has never
  // cached the account, the store is EMPTY until the first pull settles (42s
  // for a 12k-card account, measured in playtest batch 9). Both radar sections
  // read the store, so until then they may only say they are still checking —
  // never "Nothing you own is on their want lists", and never no section.
  const awaitingFirstPull = useAwaitingFirstPull();
  const collectionUnknown = awaitingFirstPull && myCards.length === 0 && lists.length === 0;
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
  const refreshTrades = () => setTradeAttempt((n) => n + 1);
  // A settlement applied by the app shell changes rows in this tab.
  useEffect(() => subscribeTradesChanged(() => setTradeAttempt((n) => n + 1)), []);

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

  // `/friends/:id?counter=<offerId>` — /trades' Counter lands here. A live
  // incoming offer seeds the saved draft (what they asked of the viewer on
  // "You give", what they offered on "You get") and the page moves on to the
  // Collection tab with the review open; the param is spent once it has.
  const counterOffer =
    counterId && offers
      ? offers.find((o) => o.id === counterId && o.status === 'proposed' && !o.mine)
      : undefined;
  function collectionParams(review: boolean) {
    const params = new URLSearchParams(searchParams);
    params.delete('counter');
    params.set('tab', 'collection');
    if (review) params.set('review', '1');
    return params;
  }
  useCounterSeed({
    friendId: friendId ?? '',
    friendName: who,
    offer: counterOffer,
    onSeeded: () => setSearchParams(collectionParams(true), { replace: true }),
  });
  // A counter for an offer that is gone (answered elsewhere) has nothing to
  // seed: land on the Collection tab without it rather than keep waiting.
  const counterGone = !!counterId && offers !== null && !counterOffer;
  useEffect(() => {
    if (!counterGone) return;
    // Functional, so a tab the viewer picked meanwhile is not overwritten.
    setSearchParams(
      (prev) => {
        if (!prev.has('counter')) return prev;
        const params = new URLSearchParams(prev);
        params.delete('counter');
        params.set('tab', 'collection');
        return params;
      },
      { replace: true }
    );
  }, [counterGone, setSearchParams]);

  const openTrades = (offers ?? []).filter((o) => o.status === 'proposed');
  // Only offers awaiting THIS viewer count toward the tab badge — an offer
  // they sent is waiting on the other person, not on them.
  const awaitingMe = openTrades.filter((o) => !o.mine).length;

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
      <div className="friend-hub social-page-shell">
        <BackLink to="/friends" label="Friends" />
        <div className="friends-signin-prompt">
          <p className="friends-signin-title">Sign in to view shared content</p>
          <Button variant="primary" to={signInHref}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  const loading = shares === null;
  const sharesList = shares ?? [];

  const hubTabs: TabItem<HubTab>[] = [
    { id: 'overview', label: 'Overview', controls: 'friend-hub-panel-overview' },
    { id: 'decks', label: 'Decks', controls: 'friend-hub-panel-decks' },
    { id: 'collection', label: 'Collection', controls: 'friend-hub-panel-collection' },
    {
      id: 'trades',
      label: awaitingMe > 0 ? `Trades (${awaitingMe})` : 'Trades',
      controls: 'friend-hub-panel-trades',
    },
  ];

  return (
    <div className="friend-hub social-page-shell friend-hub--wide">
      <BackLink to="/friends" label="Friends" />
      <PageHeader
        title={heading}
        meta={hasDisplayName ? `${handle} · Shared with friends` : 'Shared with friends'}
      />

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
            role="status"
            aria-busy="true"
          />
        ) : (
          h2h &&
          h2h.summary.gamesPlayed > 0 && (
            <section className="friend-hub-section" aria-label="Head-to-head record">
              <SectionHeader
                title="Head-to-head"
                titleClassName="friend-hub-section-head"
                variant="overline"
              />
              <Surface as="div" variant="framed" className="friend-hub-h2h-card">
                <H2HSummary data={h2h} />
              </Surface>
            </section>
          )
        )}

        {(wantsAnything || collectionUnknown) && (
          <section className="friend-hub-section" aria-label="Trade radar">
            <SectionHeader
              title="Trade radar"
              titleClassName="friend-hub-section-head"
              variant="overline"
            />
            {radarError ? (
              <p className="friend-hub-radar-note" role="alert">
                Couldn't check {who}'s collection against your want lists.{' '}
                <Button variant="link" onClick={retryCollection} className="friend-hub-radar-retry">
                  Retry
                </Button>
              </p>
            ) : collectionUnknown || radar === null ? (
              <div
                className="friend-hub-radar-skeleton"
                aria-label="Checking your want lists"
                role="img"
                aria-busy="true"
              />
            ) : radar.length === 0 ? (
              <p className="friend-hub-radar-note" role="status">
                Nothing on your want lists is in {who}'s collection.
              </p>
            ) : (
              <>
                <p className="friend-hub-radar-lede">
                  {radar.length === 1
                    ? `1 card on your want list. ${who} has it.`
                    : `${radar.length} cards on your want list. ${who} has these.`}
                </p>
                <ul
                  className="friend-hub-radar-strip"
                  aria-label="Want-list cards this friend owns"
                >
                  {radar.map((m) => (
                    <RadarCardTile key={m.name} match={m} />
                  ))}
                </ul>
                <Button
                  variant="primary"
                  onClick={() => setTab('collection')}
                  className="friend-hub-radar-propose"
                >
                  Propose a trade
                </Button>
              </>
            )}
          </section>
        )}

        {showWantRadar && (
          <section className="friend-hub-section" aria-label="What this friend is looking for">
            <SectionHeader
              title="They're looking for"
              titleClassName="friend-hub-section-head"
              variant="overline"
            />
            {wantsError ? (
              <p className="friend-hub-radar-note" role="alert">
                Couldn't check your collection against {who}'s want lists.{' '}
                <Button variant="link" onClick={retryWants} className="friend-hub-radar-retry">
                  Retry
                </Button>
              </p>
            ) : collectionUnknown || wantRadar === null ? (
              <div
                className="friend-hub-radar-skeleton"
                aria-label={`Checking ${who}'s want lists`}
                role="img"
                aria-busy="true"
              />
            ) : wantRadar.length === 0 ? (
              <p className="friend-hub-radar-note" role="status">
                Nothing you own is on {who}'s want lists.
              </p>
            ) : (
              <>
                <p className="friend-hub-radar-lede">
                  {wantRadar.length === 1
                    ? `1 card you own is on ${who}'s want list`
                    : `${wantRadar.length} cards you own are on ${who}'s want list`}
                  {spareMatches > 0
                    ? `. ${spareMatches} you can spare.`
                    : '. Every copy is in a deck or cube.'}
                </p>
                <ul
                  className="friend-hub-radar-strip"
                  aria-label={`Cards you own that ${who} wants`}
                >
                  {wantRadar.map((m) => (
                    <WantCardTile key={m.oracleId || m.name} match={m} />
                  ))}
                </ul>
                <Button
                  variant="primary"
                  onClick={() => setTab('collection')}
                  className="friend-hub-radar-propose"
                >
                  Propose a trade
                </Button>
              </>
            )}
          </section>
        )}

        {error && (
          <p className="friends-error" role="alert">
            <span>{error}</span>{' '}
            <Button
              variant="link"
              onClick={() => {
                setError(null);
                setShares(null);
                setSharesReloadKey((k) => k + 1);
              }}
            >
              Retry
            </Button>
          </p>
        )}

        {loading ? (
          <HubSkeleton />
        ) : sharesList.length === 0 ? (
          <EmptyState
            status
            tagline={
              <>
                {ownerUsername
                  ? `${hasDisplayName ? identity!.primary : handle} hasn't`
                  : "This person hasn't"}{' '}
                {(friendCards?.length ?? 0) > 0
                  ? 'shared any links with friends yet.'
                  : 'shared anything with friends yet.'}
              </>
            }
            hint={
              (friendCards?.length ?? 0) > 0 ? 'Their cards are on the Collection tab.' : undefined
            }
          />
        ) : (
          KIND_ORDER.map((kind) => {
            const rows = sharesList.filter((s) => s.kind === kind);
            if (rows.length === 0) return null;
            const { plural } = KIND_META[kind];
            return (
              <section key={kind} className="friend-hub-section" aria-label={plural}>
                <SectionHeader
                  title={plural}
                  titleClassName="friend-hub-section-head"
                  variant="overline"
                />
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
        id="friend-hub-panel-decks"
        aria-labelledby="sc-tab-decks"
        hidden={tab !== 'decks'}
      >
        {decksError ? (
          <p className="friend-hub-radar-note" role="alert">
            Couldn't load {who}'s decks.{' '}
            <Button variant="link" onClick={retryDecks} className="friend-hub-radar-retry">
              Retry
            </Button>
          </p>
        ) : friendDecks === null ? (
          <div
            className="friend-hub-collection-skeleton"
            aria-label={`Loading ${who}'s decks`}
            role="status"
            aria-busy="true"
          />
        ) : (
          <DeckLibrary
            decks={libraryDecks}
            ariaLabel={`${who}'s decks`}
            emptyTagline={`${who} hasn't shared any decks yet.`}
            emptyHint="Decks they publish, or share with friends, show up here."
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="friend-hub-panel-collection"
        aria-labelledby="sc-tab-collection"
        hidden={tab !== 'collection'}
      >
        {tab === 'collection' && friendId && (
          <TradeWorkspace
            friendId={friendId}
            friendName={who}
            theirCards={friendCopies}
            error={collectionError ? 'Check your connection, then retry.' : null}
            onRetry={retryCollection}
            isPrivate={!!collectionCurrent?.isPrivate}
            friendWants={theyWant}
            onSent={() => {
              setTab('trades');
              refreshTrades();
            }}
          />
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
          <Button variant="primary" onClick={() => setTab('collection')}>
            Propose a trade
          </Button>
        </div>

        {offersError ? (
          <p className="friend-hub-radar-note" role="alert">
            Couldn't load your trades with {who}.{' '}
            <Button variant="link" onClick={refreshTrades} className="friend-hub-radar-retry">
              Retry
            </Button>
          </p>
        ) : offers === null ? (
          <div
            className="friend-hub-collection-skeleton"
            aria-label={`Loading trades with ${who}`}
            role="status"
            aria-busy="true"
          />
        ) : (
          <TradeOfferList
            offers={offers}
            onChanged={refreshTrades}
            onCounter={(offer) => {
              const params = new URLSearchParams(searchParams);
              params.set('counter', offer.id);
              setSearchParams(params, { replace: true });
            }}
          />
        )}
      </div>
    </div>
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
