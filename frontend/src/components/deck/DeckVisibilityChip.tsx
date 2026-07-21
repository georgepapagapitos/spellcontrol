import { useState } from 'react';
import { Globe, Link2, Lock, Users } from 'lucide-react';
import { ShareDialog } from '../ShareDialog';
import { useDeckVisibility, type DeckVisibility } from '../../lib/use-deck-visibility';
import './DeckVisibilityChip.css';

interface Props {
  deckId: string;
  deckName: string;
}

const VISIBILITY_META: Record<DeckVisibility, { icon: typeof Globe; label: string }> = {
  public: { icon: Globe, label: 'Public' },
  friends: { icon: Users, label: 'Friends' },
  link: { icon: Link2, label: 'Link' },
  private: { icon: Lock, label: 'Private' },
};

/**
 * Persistent visibility indicator in the deck-editor header — the deck's
 * ONLY sharing affordance on this page (there is no separate Share button to
 * compete with it): the chip shows current state at a glance and is itself
 * the entry point into the existing ShareDialog. Re-fetches on close so a
 * publish/unpublish/share change made inside the dialog reflects immediately.
 *
 * Guests get no special-casing here — `useDeckVisibility` already resolves
 * them to 'private', and ShareDialog itself renders the sign-in prompt when
 * opened as a guest.
 */
export function DeckVisibilityChip({ deckId, deckName }: Props) {
  const { visibility, refetch } = useDeckVisibility(deckId);
  const [open, setOpen] = useState(false);
  const { icon: Icon, label } = VISIBILITY_META[visibility];

  return (
    <>
      <button
        type="button"
        className="deck-visibility-chip"
        onClick={() => setOpen(true)}
        aria-label={`Sharing: ${label} — change visibility`}
      >
        <Icon width={14} height={14} strokeWidth={1.8} aria-hidden />
        {label}
      </button>
      {open && (
        <ShareDialog
          kind="deck"
          resourceId={deckId}
          resourceLabel={deckName}
          onClose={() => {
            setOpen(false);
            refetch();
          }}
        />
      )}
    </>
  );
}
