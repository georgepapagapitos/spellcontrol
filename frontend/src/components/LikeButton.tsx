import './LikeButton.css';
import { useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { likeDeck, unlikeDeck } from '../lib/discover-client';
import { GuestActionPopover } from './GuestActionPopover';

interface Props {
  slug: string;
  initialLiked: boolean;
  initialCount: number;
  size?: number;
}

/**
 * Icon-only like toggle for a Discover tile. Optimistic: flips + increments
 * immediately, reconciles the count with the server response, rolls back +
 * toasts on failure. A guest tap never fires a request — it opens
 * GuestActionPopover instead, with no optimistic flip (no false-positive
 * state a guest could see reverted). Accessible name is always "Like" —
 * state is communicated by aria-pressed, never a label swap.
 */
export function LikeButton({ slug, initialLiked, initialCount, size = 16 }: Props) {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAuthed) {
      setGuestOpen(true);
      return;
    }
    if (busy) return;

    const prevLiked = liked;
    const prevCount = count;
    const nextLiked = !liked;
    setBusy(true);
    setLiked(nextLiked);
    setCount(prevCount + (nextLiked ? 1 : -1));
    try {
      if (nextLiked) {
        const res = await likeDeck(slug);
        setCount(res.likeCount);
      } else {
        await unlikeDeck(slug);
      }
    } catch {
      setLiked(prevLiked);
      setCount(prevCount);
      toast.show({ message: "Couldn't like this deck — try again", tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tile-action-btn"
        aria-label="Like"
        aria-pressed={liked}
        disabled={busy}
        onClick={handleClick}
      >
        <Heart
          width={size}
          height={size}
          strokeWidth={2}
          fill={liked ? 'currentColor' : 'none'}
          aria-hidden
        />
      </button>
      <GuestActionPopover
        open={guestOpen}
        onClose={() => setGuestOpen(false)}
        anchorRef={triggerRef}
        message="Sign in to like decks"
      />
    </>
  );
}
