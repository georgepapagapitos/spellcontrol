import { Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { copySharedDeck } from '../../lib/copy-shared-deck';
import { toast } from '../../store/toasts';
import type { PublicDeck } from '../../lib/shared-types';

interface Props {
  data: PublicDeck;
  variant?: 'bar' | 'block';
}

/**
 * CTA button that copies a shared deck into the visitor's local decks store
 * and navigates to the new deck. Works for logged-out visitors — the decks
 * store has no auth check and the sync subscriber no-ops for guests.
 */
export function CopyDeckButton({ data, variant = 'bar' }: Props) {
  const navigate = useNavigate();

  function handleCopy() {
    const id = copySharedDeck(data);
    toast.show({ message: 'Copied to your decks.', tone: 'success' });
    void navigate(`/decks/${id}`);
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
