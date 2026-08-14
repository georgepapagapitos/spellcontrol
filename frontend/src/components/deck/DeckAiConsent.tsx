import { useState } from 'react';
import { X } from 'lucide-react';
import { grantAiConsent } from '../../lib/use-ai-status';

/** Shared across every AI surface — dismissing anywhere dismisses everywhere. */
const INVITE_DISMISSED_KEY = 'sc-ai-invite-dismissed';

export function isAiInviteDismissed(): boolean {
  return localStorage.getItem('sc-ai-invite-dismissed') === '1';
}

/**
 * The in-place AI consent card (T102). One implementation, mounted by every
 * surface that can be a first point of use — the deck review panel, the refine
 * panel, and the post-generation build report.
 *
 * That multiplicity is the reason it's extracted: whichever surface a user
 * meets first has to be able to grant consent, or the feature is invisible
 * exactly where it would have helped. Consent itself is a single server-side
 * flag, and `grantAiConsent` publishes it through the shared status store, so
 * enabling here lights up every other mounted panel at once.
 *
 * `blurb` is per-surface because the honest disclosure differs: the review
 * sends a decklist, the refine pass also sends the candidate pool.
 */
export function DeckAiConsent({
  title,
  blurb,
  onDismiss,
}: {
  title: string;
  blurb: string;
  /** Omit to hide the dismiss action (a surface that's already opt-in-shaped). */
  onDismiss?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = () => {
    setBusy(true);
    setError(null);
    grantAiConsent()
      .catch((err: Error) => setError(err.message || 'Could not turn this on.'))
      .finally(() => setBusy(false));
  };

  return (
    <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
      <h4 className="deck-stats-panel-title">
        {title}
        <span className="deck-ai-marker">AI Beta</span>
      </h4>
      <div className="deck-ai-invite">
        <p className="deck-ai-invite-text">{blurb}</p>
        {error && (
          <p className="deck-ai-consent-error" role="alert">
            {error}
          </p>
        )}
        <div className="deck-ai-invite-actions">
          <button type="button" className="btn btn-primary" onClick={enable} disabled={busy}>
            {busy ? 'Turning on…' : 'Turn on AI Beta'}
          </button>
          {onDismiss && (
            <button
              type="button"
              className="btn deck-ai-invite-dismiss"
              onClick={() => {
                localStorage.setItem(INVITE_DISMISSED_KEY, '1');
                onDismiss();
              }}
            >
              <X width={16} height={16} strokeWidth={2} aria-hidden />
              No thanks
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
