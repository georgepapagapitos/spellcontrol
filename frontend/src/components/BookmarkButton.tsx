import { useRef, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { bookmarkDeck, unbookmarkDeck } from '../lib/discover-client';
import { GuestActionPopover } from './GuestActionPopover';

interface Props {
  slug: string;
  initialBookmarked: boolean;
  size?: number;
  /**
   * Fired after a server-confirmed change (not optimistically — avoids
   * needing to re-insert a removed tile on a rare rollback). SavedDecksPage
   * passes this to splice an unsaved deck out of its list immediately;
   * Discover leaves it undefined (nothing needs to happen there).
   * ponytail: server-confirmed rather than optimistic removal — a POST/
   * DELETE round trip here is fast enough to read as immediate, and this
   * sidesteps re-inserting a tile at the right spot if the request fails.
   */
  onChange?: (bookmarked: boolean) => void;
}

/**
 * Icon-only bookmark toggle — same shape and states as LikeButton (reuses
 * its `.tile-action-btn` family in LikeButton.css), minus a public count.
 * Accessible name is always "Save", never "Unsave"; state is aria-pressed.
 */
export function BookmarkButton({ slug, initialBookmarked, size = 16, onChange }: Props) {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
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

    const prevBookmarked = bookmarked;
    const nextBookmarked = !bookmarked;
    setBusy(true);
    setBookmarked(nextBookmarked);
    try {
      if (nextBookmarked) {
        await bookmarkDeck(slug);
      } else {
        await unbookmarkDeck(slug);
      }
      onChange?.(nextBookmarked);
    } catch {
      setBookmarked(prevBookmarked);
      toast.show({ message: "Couldn't save this deck — try again", tone: 'error' });
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
        aria-label="Save"
        aria-pressed={bookmarked}
        disabled={busy}
        onClick={handleClick}
      >
        <Bookmark
          width={size}
          height={size}
          strokeWidth={2}
          fill={bookmarked ? 'currentColor' : 'none'}
          aria-hidden
        />
      </button>
      <GuestActionPopover
        open={guestOpen}
        onClose={() => setGuestOpen(false)}
        anchorRef={triggerRef}
        message="Sign in to save decks"
      />
    </>
  );
}
