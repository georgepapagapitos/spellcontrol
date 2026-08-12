import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { analyzeDeck } from '../../lib/deck-analysis';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import {
  buildDeckReviewCards,
  deckContentKey,
  fetchAiStatus,
  requestDeckReview,
  type AiStatus,
} from '../../lib/ai-review';
import './DeckAiReview.css';

const INVITE_DISMISSED_KEY = 'sc-ai-invite-dismissed';

interface DeckAiReviewProps {
  deckId: string;
  format: DeckFormat;
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  mainboard: { slotId: string; card: ScryfallCard }[];
}

interface HeldReview {
  content: string;
  /** Content key of the deck the review was written for — staleness signal. */
  key: string;
}

/**
 * "Read the deck" — the opt-in AI panel (T96). Renders nothing at all unless
 * the backend has the feature configured AND the user is signed in; renders a
 * one-time dismissible invitation until the user opts in. Never auto-loads:
 * a page render never spends money — only the button does.
 *
 * Additive insight surface: it sits below the existing analysis panels and
 * displaces nothing.
 */
export function DeckAiReview({
  deckId,
  format,
  commander,
  partnerCommander,
  mainboard,
}: DeckAiReviewProps) {
  const taggerReady = useTaggerReady();
  const [status, setStatus] = useState<AiStatus | null | 'loading'>('loading');
  const [inviteDismissed, setInviteDismissed] = useState(
    () => localStorage.getItem(INVITE_DISMISSED_KEY) === '1'
  );
  const [phase, setPhase] = useState<'idle' | 'reading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<HeldReview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commanderName = partnerCommander
    ? `${commander.name} // ${partnerCommander.name}`
    : commander.name;

  const cards = useMemo(() => buildDeckReviewCards(mainboard), [mainboard]);
  const currentKey = useMemo(() => deckContentKey(commanderName, cards), [commanderName, cards]);

  if (status === 'loading' || status === null) return null;

  const remaining = Math.max(0, status.limit - status.used);
  const stale = review !== null && review.key !== currentKey;

  const read = () => {
    const requestKey = currentKey;
    setPhase('reading');
    setError(null);
    const analysis = analyzeDeck({ format, commander, partnerCommander, mainboard }, taggerReady);
    requestDeckReview({ deckId, commander: commanderName, cards, analysis })
      .then((result) => {
        setReview({ content: result.content, key: requestKey });
        setPhase('idle');
        if (!result.cached) {
          setStatus((s) => (s && s !== 'loading' ? { ...s, used: s.used + 1 } : s));
        }
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 429) {
          setStatus((s) => (s && s !== 'loading' ? { ...s, used: s.limit } : s));
        }
        setError(err.message || 'The review could not be generated. Try again.');
        setPhase('error');
      });
  };

  // ── Not opted in: a single dismissible invitation, then nothing ──
  if (!status.optIn) {
    if (inviteDismissed) return null;
    return (
      <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
        <h4 className="deck-stats-panel-title">Read the deck</h4>
        <div className="deck-ai-invite">
          <p className="deck-ai-invite-text">
            AI can read this deck and write what it's trying to do — and the structural problems the
            statistics can't show. Off until you turn it on in Settings.
          </p>
          <div className="deck-ai-invite-actions">
            <Link to="/you?section=ai" className="btn">
              Open Settings
            </Link>
            <button
              type="button"
              className="btn deck-ai-invite-dismiss"
              onClick={() => {
                localStorage.setItem(INVITE_DISMISSED_KEY, '1');
                setInviteDismissed(true);
              }}
            >
              <X width={16} height={16} strokeWidth={2} aria-hidden />
              No thanks
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ── Opted in: idle / reading / error / result / stale ──
  return (
    <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
      <h4 className="deck-stats-panel-title">
        Read the deck
        <span className="deck-ai-marker">AI-written</span>
      </h4>

      {review && (
        <div aria-live="polite">
          {stale && (
            <div className="deck-ai-stale" role="status">
              <span>Your deck has changed since this was written.</span>
              <button type="button" className="btn" onClick={read} disabled={phase === 'reading'}>
                Read again
              </button>
            </div>
          )}
          <div className={`deck-ai-prose${stale ? ' deck-ai-prose--stale' : ''}`}>
            {review.content.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}

      {phase === 'reading' && (
        <div
          className="deck-ai-skeleton"
          role="status"
          aria-live="polite"
          aria-label="Reading the deck"
        >
          <span className="deck-ai-skeleton-line" />
          <span className="deck-ai-skeleton-line" />
          <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
        </div>
      )}

      {phase === 'error' && error && (
        <div className="deck-ai-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={read}>
            Try again
          </button>
        </div>
      )}

      {phase === 'idle' && !review && (
        <div className="deck-ai-idle">
          <p className="deck-ai-idle-text">
            What is this deck actually trying to do, and where does it break? Written for this exact
            list — nothing is sent until you ask.
          </p>
          <div className="deck-ai-idle-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={read}
              disabled={remaining === 0}
            >
              Read the deck
            </button>
            <span className="deck-ai-remaining">
              {remaining === 0
                ? 'Daily limit reached — resets at midnight UTC.'
                : `${remaining} of ${status.limit} left today`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
