import './FriendOwnersPanel.css';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAvatar } from '@/components/profile/UserAvatar';
import { Button } from '@/components/shared/Button';
import { fetchFriendOwners, type FriendOwner } from '@/lib/social/friends-client';
import { formatIdentity } from '@/lib/social/display-name';
import { emptyDraft } from '@/lib/trade/trade-draft';
import { MAX_COPIES_PER_LINE } from '@/lib/trade/trade-basket';
import { useAuth } from '@/store/auth';
import { useTradeDraftsStore } from '@/store/trade-drafts';

/** Wait for the card to settle before asking: the preview mounts this per
 *  focused card, and the endpoint allows 30 a minute. Same wait as Played in. */
export const FRIEND_OWNERS_SETTLE_MS = 350;

const cache = new Map<string, FriendOwner[]>();
const inflight = new Map<string, Promise<FriendOwner[]>>();

/** Test seam: the cache lives for the page session. */
export function clearFriendOwnersCache() {
  cache.clear();
  inflight.clear();
}

function loadOwners(oracleId: string): Promise<FriendOwner[]> {
  const hit = cache.get(oracleId);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(oracleId);
  if (!p) {
    p = fetchFriendOwners(oracleId)
      .then((owners) => {
        cache.set(oracleId, owners);
        return owners;
      })
      .finally(() => inflight.delete(oracleId));
    inflight.set(oracleId, p);
  }
  return p;
}

type State = { oracleId: string; owners: FriendOwner[] | null; failed: boolean };

interface Props {
  oracleId: string;
  cardName: string;
}

/**
 * "Friends who own this": rendered after the preview's own sections so it
 * never pushes the card out of view. Ask puts the card in the draft for that
 * friend and opens the review.
 */
export function FriendOwnersPanel({ oracleId, cardName }: Props) {
  const viewerId = useAuth((s) => s.user?.id);
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ oracleId, owners: null, failed: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!viewerId) return;
    let alive = true;
    const t = window.setTimeout(
      () => {
        loadOwners(oracleId).then(
          (owners) => alive && setState({ oracleId, owners, failed: false }),
          () => alive && setState({ oracleId, owners: null, failed: true })
        );
      },
      cache.has(oracleId) || attempt > 0 ? 0 : FRIEND_OWNERS_SETTLE_MS
    );
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [oracleId, viewerId, attempt]);

  const ask = useCallback(
    (owner: FriendOwner) => {
      if (!viewerId) return;
      const { getDraft, setDraft } = useTradeDraftsStore.getState();
      const { primary } = formatIdentity(owner);
      const draft = getDraft(viewerId, owner.friendId) ?? emptyDraft(owner.friendId, primary);
      const have = draft.get[oracleId]?.quantity ?? 0;
      const quantity = Math.min(have + 1, owner.count, MAX_COPIES_PER_LINE);
      setDraft(viewerId, owner.friendId, {
        ...draft,
        get: { ...draft.get, [oracleId]: { name: cardName, oracleId, quantity } },
      });
      navigate(`/friends/${encodeURIComponent(owner.friendId)}?tab=collection&review=1`);
    },
    [viewerId, oracleId, cardName, navigate]
  );

  if (!viewerId) return null;
  const current = state.oracleId === oracleId ? state : null;
  const owners = current?.owners ?? cache.get(oracleId) ?? null;

  return (
    <section className="friend-owners" aria-label="Friends who own this">
      <h3 className="friend-owners-title">Friends who own this</h3>
      {owners === null && !current?.failed && (
        <p className="friend-owners-status" role="status">
          Checking your friends…
        </p>
      )}
      {owners === null && current?.failed && (
        <p className="friend-owners-status" role="alert">
          Couldn&apos;t check your friends.{' '}
          <button
            type="button"
            className="friend-owners-retry"
            onClick={() => {
              setState({ oracleId, owners: null, failed: false });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {owners !== null && owners.length === 0 && (
        <p className="friend-owners-status">None of your friends have this.</p>
      )}
      {owners !== null && owners.length > 0 && (
        <ul className="friend-owners-list">
          {owners.map((o) => {
            const { primary } = formatIdentity(o);
            return (
              <li key={o.friendId} className="friend-owners-row">
                <UserAvatar imageUrl={null} name={primary} size={32} />
                <span className="friend-owners-body">
                  <span className="friend-owners-name">{primary}</span>
                  <span className="friend-owners-meta">
                    {o.count} · {o.spare ? 'spare' : 'not spare'}
                  </span>
                </span>
                <Button
                  placement="row"
                  aria-label={`Ask ${primary} for ${cardName}`}
                  onClick={() => ask(o)}
                >
                  Ask
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The `renderPanelExtra` body for a viewer's own-card preview: the panel for
 *  a card that has an oracle id, nothing otherwise. */
export function renderFriendOwners(card: { oracleId?: string; name: string } | undefined) {
  return card?.oracleId ? (
    <FriendOwnersPanel key={card.oracleId} oracleId={card.oracleId} cardName={card.name} />
  ) : null;
}
