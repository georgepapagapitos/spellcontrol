import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { unpublishDeck } from '../../lib/publications-client';
import { notifyDeckVisibilityChanged } from '../../lib/use-deck-visibility';
import { userMessage } from '@/lib/user-error';
import './DeckPublishNudge.css';

interface Props {
  deckId: string;
}

/** A new deck's default publish lands on the server's first sync of it, a
 *  moment after the editor opens. One look again covers a tap that beats it. */
const PUBLISH_CATCH_UP_MS = 800;

async function makePrivate(deckId: string): Promise<void> {
  try {
    await unpublishDeck(deckId);
  } catch {
    await new Promise((r) => setTimeout(r, PUBLISH_CATCH_UP_MS));
    await unpublishDeck(deckId);
  }
}

/**
 * One-shot, dismissible post-create notice that the new deck is PUBLIC (board
 * T136: new decks are public by default). Shown only by the flows that
 * create a deck without a visibility choice of their own: a one-tap copy,
 * brew, a generation without the fieldset, a multi-file import landing on
 * one deck. The caller mounts it from a router-state one-shot flag, so it
 * never outlives the visit that created the deck.
 *
 * The one action is the one someone might want right now, "Make private",
 * in a single tap. Everything else lives behind the header's visibility chip,
 * which this tells to look again once the change lands.
 *
 * "One-row, dismissible, non-displacing" per STYLE_GUIDE's insight-surface
 * ruling. Guests never see it: a guest's deck isn't published (see
 * defaultNewDeckVisibility).
 */
export function DeckPublishNudge({ deckId }: Props) {
  const isGuest = useAuth((s) => s.status === 'guest');
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isGuest || dismissed) return null;

  const onMakePrivate = async () => {
    setBusy(true);
    try {
      await makePrivate(deckId);
      toast.show({ message: 'This deck is private now. Only you can see it.', tone: 'success' });
      notifyDeckVisibilityChanged(deckId);
      setDismissed(true);
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't make it private. Try again."),
        tone: 'warn',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="deck-publish-nudge" role="status" aria-live="polite">
      <p>This deck is public. Anyone can find it on your profile.</p>
      <div className="deck-publish-nudge-actions">
        <button
          type="button"
          className="btn"
          onClick={() => void onMakePrivate()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? 'Making private…' : 'Make private'}
        </button>
        <button
          type="button"
          className="deck-publish-nudge-dismiss"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <X width={16} height={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
