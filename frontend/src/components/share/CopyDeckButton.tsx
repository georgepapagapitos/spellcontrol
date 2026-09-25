import { Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { copySharedDeck } from '../../lib/copy-shared-deck';
import { recordDeckCopy } from '../../lib/share-client';
import { toast } from '../../store/toasts';
import type { PublicDeck } from '../../lib/shared-types';
import { Button } from '@/components/shared/Button';

interface Props {
  data: PublicDeck;
  variant?: 'header' | 'block';
  /** The deck_publications slug, present when copying from `/d/:slug`
   *  (`w1-public-deck-page`), absent from a `/s/:token` share. Stamps the
   *  copy's `forkedFrom` lineage and bumps the public copy counter — a
   *  share-token copy does neither. */
  slug?: string;
}

/**
 * CTA button that copies a shared deck into the visitor's local decks store
 * and navigates to the new deck. Works for logged-out visitors — the decks
 * store has no auth check and the sync subscriber no-ops for guests.
 */
export function CopyDeckButton({ data, variant = 'header', slug }: Props) {
  const navigate = useNavigate();

  function handleCopy() {
    const id = copySharedDeck(data, slug);
    // Fire-and-forget: a failed counter bump must never block or error the
    // actual copy above (recordDeckCopy already swallows its own errors).
    if (slug) void recordDeckCopy(slug);
    toast.show({ message: 'Copied to your decks', tone: 'success' });
    // promptVisibility (E150): a one-tap copy skips the creation-time
    // visibility fieldset entirely, so the editor shows a post-create
    // DeckPublishNudge instead — mirrors `justGenerated`'s one-shot
    // router-state pattern.
    void navigate(`/decks/${id}`, { state: { promptVisibility: true } });
  }

  // Block: the full-width echo at the end of the deck content.
  if (variant === 'block') {
    return (
      <Button
        variant="primary"
        onClick={handleCopy}
        className="shared-copy-btn shared-copy-btn--block"
        icon={<Copy width={16} height={16} strokeWidth={2} />}
      >
        Copy this deck
      </Button>
    );
  }

  // Header: sits in the deck hero's action row beside Playtest, so it carries
  // that row's sizing (.shared-view-actions .btn) and names its destination —
  // "Copy" alone made sense beside a brand bar, not beside a verb.
  return (
    <Button
      onClick={handleCopy}
      className="shared-copy-btn"
      icon={<Copy width={15} height={15} strokeWidth={2} />}
    >
      Copy to my decks
    </Button>
  );
}
