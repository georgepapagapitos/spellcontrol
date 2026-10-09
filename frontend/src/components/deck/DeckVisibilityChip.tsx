import { useState } from 'react';
import { Globe, Link2, Lock, Users } from 'lucide-react';
import { ShareDialog } from '@/components/share/ShareDialog';
import { useDeckVisibility, type DeckVisibility } from '@/lib/social/use-deck-visibility';
import { Button } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import './DeckVisibilityChip.css';

interface Props {
  deckId: string;
  deckName: string;
  /** Forwarded to ShareDialog for the first-publish seal's motes (E150). */
  colorIdentity?: string[];
  /** `meta` (default): the meta line's last segment, "Sharing: Public".
   *  `button`: a phone's header action beside Add cards, so the meta line
   *  stays one line of facts instead of wrapping into 44px touch rows. */
  variant?: 'meta' | 'button';
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
export function DeckVisibilityChip({ deckId, deckName, colorIdentity, variant = 'meta' }: Props) {
  const { visibility, refetch } = useDeckVisibility(deckId);
  const [open, setOpen] = useState(false);
  const { icon: Icon, label } = VISIBILITY_META[visibility];

  return (
    <>
      {variant === 'button' ? (
        // A labeled button among the header actions: the state on its face,
        // the visibility glyph beside it, "Sharing" in its name.
        <Button
          className="deck-editor-action-btn deck-visibility-btn"
          onClick={() => setOpen(true)}
          aria-label={`Sharing: ${label}. Change visibility`}
          icon={<Icon width={14} height={14} strokeWidth={1.8} />}
        >
          {label}
        </Button>
      ) : (
        // "Sharing:" on the face, not only in the aria-label: a chip that just
        // said "Private" was the page's only share door and nothing told a
        // first-time user that tapping the state changes it.
        <Chip
          className="deck-meta-link deck-visibility-chip"
          onClick={() => setOpen(true)}
          aria-label={`Sharing: ${label}. Change visibility`}
          icon={<Icon width={14} height={14} strokeWidth={1.8} />}
          trailing={<span className="deck-meta-link-value">{label}</span>}
        >
          Sharing:{' '}
        </Chip>
      )}
      {open && (
        <ShareDialog
          kind="deck"
          resourceId={deckId}
          resourceLabel={deckName}
          colorIdentity={colorIdentity}
          onClose={() => {
            setOpen(false);
            refetch();
          }}
        />
      )}
    </>
  );
}
