import { Loader2, Plus } from 'lucide-react';
import { useScryfallCooldownSeconds } from '@/lib/cards/use-scryfall-cooldown';

/** Says why a Scryfall-backed press is waiting while the shared 429 cooldown
 *  parks every caller. The live region is always mounted so the change is
 *  announced; the countdown is aria-hidden so it does not chatter every second. */
export function ScryfallCooldownNote() {
  const seconds = useScryfallCooldownSeconds();
  return (
    <div role="status" aria-live="polite">
      {seconds > 0 && (
        <p className="card-search-tag-note card-search-cooldown-note">
          Scryfall is rate-limiting requests. Adds go through when it clears
          <span aria-hidden>{` (${seconds}s)`}</span>.
        </p>
      )}
    </div>
  );
}

/** The add button's glyph: a spinner while the card lookup resolves. */
export function AddButtonIcon({ pending }: { pending?: boolean }) {
  return pending ? (
    <Loader2 className="inline-card-search-add-spinner" width={12} height={12} />
  ) : (
    <Plus width={12} height={12} strokeWidth={2} />
  );
}
