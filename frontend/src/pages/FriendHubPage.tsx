import './FriendHubPage.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Box, FolderOpen, Layers, ListChecks } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { formatMoney } from '../lib/format-money';
import { getFriendShares, type FriendShareRow } from '../lib/share-client';
import { fetchH2H, type H2HResponse } from '../lib/game-results-client';
import { fetchFriendCollection, type FriendCard } from '../lib/cube/pool';
import { buildTradeRadar, type TradeRadarMatch } from '../lib/trade-radar';
import { isTrackingList } from '../lib/lists';
import { useCardThumb } from '../lib/card-thumbs';
import { H2HSummary } from '../components/play/H2HSummary';
import type { ShareKind } from '../lib/shared-types';

/** Display order + presentation for each shareable kind. */
const KIND_META: Record<ShareKind, { label: string; plural: string; Icon: typeof Layers }> = {
  deck: { label: 'Deck', plural: 'Decks', Icon: Layers },
  collection: { label: 'Collection', plural: 'Collections', Icon: BookOpen },
  cube: { label: 'Cube', plural: 'Cubes', Icon: Box },
  binder: { label: 'Binder', plural: 'Binders', Icon: FolderOpen },
  list: { label: 'List', plural: 'Lists', Icon: ListChecks },
  feedback: { label: 'Deck feedback', plural: 'Deck feedback', Icon: Layers },
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
  const [shares, setShares] = useState<FriendShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [h2h, setH2h] = useState<H2HResponse | null>(null);
  const [h2hLoading, setH2hLoading] = useState(true);

  // Trade radar: cross-reference the viewer's own want lists against this
  // friend's collection — the same oracle-level fetch the cube collab pool
  // uses, so it rides the existing sharing model (no new privacy surface).
  const lists = useCollectionStore((s) => s.lists);
  // Tracking lists catalogue cards the viewer owns — never wants.
  const wantsAnything = lists.some((l) => !isTrackingList(l) && l.entries.length > 0);
  const [radarAttempt, setRadarAttempt] = useState(0);
  // Keyed result: a stale key (friend switch / retry) reads as loading again,
  // so the effect never needs a synchronous reset-setState.
  const [radarResult, setRadarResult] = useState<{
    key: string;
    cards: FriendCard[] | null;
    error: boolean;
  } | null>(null);
  const radarKey = `${friendId ?? ''}:${radarAttempt}`;

  useEffect(() => {
    // Nothing on any list → nothing to radar; skip the fetch entirely.
    if (status !== 'authed' || !friendId || !wantsAnything) return;
    let cancelled = false;
    const key = `${friendId}:${radarAttempt}`;
    fetchFriendCollection(friendId)
      .then((res) => {
        if (!cancelled) setRadarResult({ key, cards: res.cards, error: false });
      })
      .catch(() => {
        if (!cancelled) setRadarResult({ key, cards: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [friendId, status, wantsAnything, radarAttempt]);

  const radarCurrent = radarResult && radarResult.key === radarKey ? radarResult : null;
  const radarError = radarCurrent?.error ?? false;
  const friendCards = radarCurrent?.cards ?? null;

  const radar: TradeRadarMatch[] | null = useMemo(
    () => (friendCards ? buildTradeRadar(lists, friendCards) : null),
    [lists, friendCards]
  );

  useEffect(() => {
    if (status !== 'authed' || !friendId) return;
    let cancelled = false;
    getFriendShares(friendId)
      .then((res) => {
        if (cancelled) return;
        setOwnerUsername(res.ownerUsername);
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
  const heading = ownerUsername ? `@${ownerUsername}` : 'Shared with friends';
  const who = ownerUsername ? `@${ownerUsername}` : 'this friend';

  return (
    <div className="friend-hub">
      <BackLink />
      <h1 className="friend-hub-heading">{heading}</h1>
      <p className="friend-hub-sub">Shared with friends</p>

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
                onClick={() => setRadarAttempt((n) => n + 1)}
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
              <ul className="friend-hub-radar-strip" aria-label="Want-list cards this friend owns">
                {radar.map((m) => (
                  <RadarCardTile key={m.name} match={m} />
                ))}
              </ul>
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
          {ownerUsername ? `@${ownerUsername} hasn’t` : 'This person hasn’t'} shared anything with
          friends yet.
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
  );
}

/** One want-list card the friend owns: thumbnail (CDN via useCardThumb, never
 *  the throttled Scryfall API), name, and which list wants it + target price. */
function RadarCardTile({ match }: { match: TradeRadarMatch }) {
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
