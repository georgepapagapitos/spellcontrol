import { Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { copySharedDeck } from '../../lib/copy-shared-deck';
import { recordDeckCopy } from '../../lib/share-client';
import { toast } from '../../store/toasts';
import type { PublicDeck } from '../../lib/shared-types';

interface Props {
  data: PublicDeck;
  variant?: 'bar' | 'block';
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
export function CopyDeckButton({ data, variant = 'bar', slug }: Props) {
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

  if (variant === 'block') {
    return (
      <button
        type="button"
        className="btn btn-primary shared-copy-btn shared-copy-btn--block"
        onClick={handleCopy}
      >
        <Copy width={16} height={16} strokeWidth={2} aria-hidden />
        Copy this deck
      </button>
    );
  }

  return (
    <button type="button" className="btn btn-primary shared-copy-btn" onClick={handleCopy}>
      <Copy width={14} height={14} strokeWidth={2} aria-hidden />
      Copy
    </button>
  );
}
