import './FriendPicker.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/overlays/Modal';
import { UserAvatar } from '@/components/profile/UserAvatar';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { listFriends, type Friend } from '@/lib/social/friends-client';
import { formatIdentity } from '@/lib/social/display-name';
import { userMessage } from '@/lib/util/user-error';

interface Props {
  onClose: () => void;
}

/**
 * "New trade": pick the friend to trade with. A trade is built in that
 * friend's Collection tab, so each row is a link there; the picker only
 * answers "with whom". Loading, error with retry, and no-friends are all
 * states of the same dialog.
 */
export function FriendPicker({ onClose }: Props) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listFriends()
      .then((list) => {
        if (cancelled) return;
        setFriends(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(userMessage(err, "Couldn't load your friends. Check your connection."));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <Modal
      onClose={onClose}
      labelledBy="friend-picker-title"
      className="choice-dialog friend-picker"
    >
      <h2 id="friend-picker-title" className="choice-dialog-title">
        Trade with
      </h2>

      {error && (
        <div className="friend-picker-error" role="alert">
          <span>{error}</span>
          <Button
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {!error && friends === null && (
        <p className="friend-picker-loading" role="status">
          Loading your friends…
        </p>
      )}

      {friends !== null && friends.length === 0 && (
        <EmptyState
          tagline="No friends yet."
          hint="Trades are between friends."
          actions={
            <Button variant="primary" to="/friends" onClick={onClose}>
              Find a friend to trade with
            </Button>
          }
        />
      )}

      {friends !== null && friends.length > 0 && (
        <ul className="friend-picker-list" aria-label="Your friends">
          {friends.map((f) => {
            const { primary, secondary } = formatIdentity(f);
            return (
              <li key={f.id}>
                <Link
                  to={`/friends/${encodeURIComponent(f.id)}?tab=collection`}
                  className="friend-picker-row"
                  onClick={onClose}
                >
                  <UserAvatar imageUrl={f.avatarImageUrl ?? null} name={primary} size={40} />
                  <span className="friend-picker-name">{primary}</span>
                  {secondary && <span className="friend-picker-handle">{secondary}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="choice-dialog-actions">
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
