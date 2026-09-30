import { useRef, useState } from 'react';
import { Check, UserPlus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { followUser, unfollowUser } from '@/lib/social/brewers-client';
import { userMessage } from '@/lib/util/user-error';
import { GuestActionPopover } from './GuestActionPopover';
import { Button } from '../shared/Button';

interface Props {
  username: string;
  initialFollowing: boolean;
  /** Fires after the server confirms, with the canonical follower count. */
  onChange?: (following: boolean, followerCount: number) => void;
}

/**
 * Follow / Following toggle for a brewer. Optimistic: flips at once, reverts
 * and toasts if the request fails. A guest tap opens the same sign-in popover
 * as Like and Bookmark and sends no request. The caller decides where it
 * shows (never on your own profile). State is carried by `aria-pressed`; the
 * accessible name stays "Follow <username>" so it doesn't change under a
 * screen reader.
 */
export function FollowButton({ username, initialFollowing, onChange }: Props) {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function handleClick() {
    if (!isAuthed) {
      setGuestOpen(true);
      return;
    }
    if (busy) return;
    const prev = following;
    const next = !prev;
    setBusy(true);
    setFollowing(next);
    try {
      const res = await (next ? followUser(username) : unfollowUser(username));
      setFollowing(res.following);
      onChange?.(res.following, res.followerCount);
    } catch (err) {
      setFollowing(prev);
      toast.show({
        message: userMessage(
          err,
          next ? "Couldn't follow this brewer. Try again." : "Couldn't unfollow. Try again."
        ),
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant={following ? 'secondary' : 'primary'}
        className="follow-button"
        aria-pressed={following}
        aria-label={`Follow ${username}`}
        disabled={busy}
        icon={following ? <Check width={16} height={16} /> : <UserPlus width={16} height={16} />}
        onClick={() => void handleClick()}
      >
        {following ? 'Following' : 'Follow'}
      </Button>
      <GuestActionPopover
        open={guestOpen}
        onClose={() => setGuestOpen(false)}
        anchorRef={triggerRef}
        message="Sign in to follow brewers"
      />
    </>
  );
}
