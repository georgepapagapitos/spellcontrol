import { useState } from 'react';
import { X } from 'lucide-react';
import { ShareDialog } from '../ShareDialog';
import { useAuth } from '../../store/auth';
import './DeckPublishNudge.css';

interface Props {
  deckId: string;
  deckName: string;
  colorIdentity?: string[];
}

/**
 * One-shot, dismissible post-create nudge toward the persistent
 * DeckVisibilityChip above it (E150) — for the two entry surfaces that skip
 * the creation-time visibility fieldset entirely (CopyDeckButton's one-tap
 * copy; a multi-file import that lands on a single deck). The caller
 * mounts this only when it's confirmed the deck was JUST created by one of
 * those flows (a router-state one-shot flag, mirroring `justGenerated`) —
 * decks created via /decks/new or the single-deck import path already
 * surfaced the same choice inline (see `usePublishOnCreate`), so nudging
 * again here would be redundant noise, not discoverability.
 *
 * "One-row, dismissible, non-displacing" per STYLE_GUIDE's insight-surface
 * ruling — shape mirrors NavMigrationTip (in-flow, not sticky) crossed with
 * AutoLinkBanner's action-button row. Local `dismissed` state only: this is
 * scoped to a single page visit (the one-shot flag never survives a fresh
 * navigation), so there's nothing to persist across sessions.
 */
export function DeckPublishNudge({ deckId, deckName, colorIdentity }: Props) {
  const isGuest = useAuth((s) => s.status === 'guest');
  const [dismissed, setDismissed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // A guest can't publish — ShareDialog would just show its sign-in prompt,
  // which isn't what "share it when you're ready" promises.
  if (isGuest || dismissed) return null;

  return (
    <div className="deck-publish-nudge" role="status" aria-live="polite">
      <p>Only you can see this deck. Share it when you&apos;re ready.</p>
      <div className="deck-publish-nudge-actions">
        <button type="button" className="btn btn-primary" onClick={() => setShareOpen(true)}>
          Share…
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
      {shareOpen && (
        <ShareDialog
          kind="deck"
          resourceId={deckId}
          resourceLabel={deckName}
          colorIdentity={colorIdentity}
          onClose={() => {
            setShareOpen(false);
            // Engaging with Share at all — publish or not — is enough
            // intent to retire the nudge for the rest of this visit.
            setDismissed(true);
          }}
        />
      )}
    </div>
  );
}
