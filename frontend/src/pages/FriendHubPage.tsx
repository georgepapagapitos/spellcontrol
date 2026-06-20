import './FriendHubPage.css';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Box, FolderOpen, Layers, ListChecks } from 'lucide-react';
import { useAuth } from '../store/auth';
import { getFriendShares, type FriendShareRow } from '../lib/share-client';
import type { ShareKind } from '../lib/shared-types';

/** Display order + presentation for each shareable kind. */
const KIND_META: Record<ShareKind, { label: string; plural: string; Icon: typeof Layers }> = {
  deck: { label: 'Deck', plural: 'Decks', Icon: Layers },
  collection: { label: 'Collection', plural: 'Collections', Icon: BookOpen },
  cube: { label: 'Cube', plural: 'Cubes', Icon: Box },
  binder: { label: 'Binder', plural: 'Binders', Icon: FolderOpen },
  list: { label: 'List', plural: 'Lists', Icon: ListChecks },
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

  if (status === 'guest') {
    return (
      <div className="friend-hub">
        <BackLink />
        <div className="friends-signin-prompt">
          <p className="friends-signin-title">Sign in to view shared content</p>
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

  return (
    <div className="friend-hub">
      <BackLink />
      <h1 className="friend-hub-heading">{heading}</h1>
      <p className="friend-hub-sub">Shared with friends</p>

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
