import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import './DeckFeedbackSheet.css';
import { createShare, shareUrl } from '../../lib/share-client';
import {
  deleteFeedback,
  listDeckFeedback,
  setSuggestionStatus,
  type FeedbackResponse,
  type FeedbackSuggestion,
} from '../../lib/feedback-client';
import { findSlotForCut, suggestionBlockedReason } from '../../lib/feedback-apply';
import { formatRelativeTime } from '../../lib/format-time';
import { isNativePlatform } from '../../lib/platform';
import { Share } from '@capacitor/share';
import { useEscapeKey } from '../../lib/use-escape-key';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useSheetExit } from '../../lib/use-sheet-exit';
import { useAuth } from '../../store/auth';
import { useDeckHistoryStore } from '../../store/deck-history';
import { useDecksStore, type Deck } from '../../store/decks';
import { toast } from '../../store/toasts';

interface Props {
  deck: Deck;
  onClose: () => void;
}

/**
 * Owner side of the Feedback Tool: mints/copies the deck's feedback link and
 * reviews submitted responses — accept applies the suggestion to the deck
 * through the normal store mutations (so it syncs and is undoable like any
 * edit), then records the verdict server-side. Rides the shared
 * `.card-picker-*` sheet shell like {@link CardOtagsSheet}.
 */
export function DeckFeedbackSheet({ deck, onClose }: Props) {
  const isGuest = useAuth((s) => s.status === 'guest');
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [responses, setResponses] = useState<FeedbackResponse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);

  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    createShare({ kind: 'feedback', resourceId: deck.id })
      .then((row) => {
        if (!cancelled) setLink(shareUrl(row.token));
      })
      .catch((err) => {
        if (!cancelled) setLinkError(err instanceof Error ? err.message : 'Failed to create link.');
      });
    listDeckFeedback(deck.id)
      .then((rows) => {
        if (!cancelled) setResponses(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : 'Failed to load feedback.');
      });
    return () => {
      cancelled = true;
    };
  }, [deck.id, isGuest]);

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.show({ message: 'Feedback link copied to clipboard.', tone: 'success' });
    } catch {
      toast.show({ message: "Couldn't copy. Select and copy manually.", tone: 'warn' });
    }
  };

  // Native system share sheet — parity with ShareDialog's handleNativeShare.
  const handleNativeShare = async () => {
    if (!link) return;
    try {
      await Share.share({
        title: `Feedback on ${deck.name}`,
        text: `Suggest cuts and adds for ${deck.name} on SpellControl`,
        url: link,
        dialogTitle: 'Share feedback link',
      });
    } catch (err) {
      // Cancelling the system sheet rejects with a generic error; soft no-op.
      if (err && (err as { message?: string }).message?.includes('cancel')) return;
      toast.show({ message: "Couldn't open share sheet.", tone: 'warn' });
    }
  };

  // Optimistically stamp the verdict locally; the server call runs after the
  // deck edit so a failure can be reported without leaving a half-applied UI.
  const stampStatus = (
    feedbackId: string,
    suggestionId: string,
    status: FeedbackSuggestion['status']
  ) => {
    setResponses(
      (prev) =>
        prev?.map((r) =>
          r.id === feedbackId
            ? {
                ...r,
                suggestions: r.suggestions.map((s) =>
                  s.id === suggestionId ? { ...s, status } : s
                ),
              }
            : r
        ) ?? null
    );
  };

  const handleVerdict = async (
    response: FeedbackResponse,
    suggestion: FeedbackSuggestion,
    status: 'accepted' | 'rejected'
  ) => {
    if (status === 'accepted') {
      if (suggestion.type === 'add') {
        const card = suggestion.card;
        if (!card) {
          toast.show({ message: 'This suggestion has no card data to apply.', tone: 'warn' });
          return;
        }
        useDeckHistoryStore
          .getState()
          .record(deck.id, `add ${suggestion.cardName}`, () => addCard(deck.id, card));
        toast.show({ message: `Added ${suggestion.cardName}`, tone: 'success' });
      } else {
        const current = useDecksStore.getState().decks.find((d) => d.id === deck.id);
        const slot = current ? findSlotForCut(current.cards, suggestion) : null;
        if (!slot) {
          toast.show({ message: `${suggestion.cardName} is no longer in the deck.`, tone: 'warn' });
          return;
        }
        useDeckHistoryStore
          .getState()
          .record(deck.id, `cut ${suggestion.cardName}`, () => removeCard(deck.id, slot.slotId));
        toast.show({ message: `Cut ${suggestion.cardName}`, tone: 'success' });
      }
    }
    stampStatus(response.id, suggestion.id, status);
    try {
      await setSuggestionStatus(response.id, suggestion.id, status);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Failed to record the verdict.',
        tone: 'warn',
      });
    }
  };

  const handleDelete = async (response: FeedbackResponse) => {
    setResponses((prev) => prev?.filter((r) => r.id !== response.id) ?? null);
    try {
      await deleteFeedback(response.id);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Failed to delete the response.',
        tone: 'warn',
      });
    }
  };

  const deckCards = useDecksStore((s) => s.decks.find((d) => d.id === deck.id)?.cards ?? []);

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet deck-feedback-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Feedback for ${deck.name}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="deck-feedback-eyebrow">Deck feedback</p>
          <p className="deck-feedback-deck-name">{deck.name}</p>
        </div>

        {isGuest ? (
          <div className="card-picker-empty">
            Feedback links need an account, so responses stay tied to you.{' '}
            <Link to="/auth" onClick={onClose}>
              Sign in
            </Link>{' '}
            to use the Feedback Tool.
          </div>
        ) : (
          <div className="deck-feedback-body">
            <p className="deck-feedback-hint">
              Anyone with this link gets a suggestion-only view of the deck — they can propose cuts
              and adds, rate the power bracket, and leave comments. You review every suggestion here
              and apply the ones you like with one tap.
            </p>
            {linkError && (
              <p role="alert" className="deck-feedback-error">
                {linkError}
              </p>
            )}
            {link && (
              <div className="deck-feedback-link">
                <input
                  type="text"
                  value={link}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Feedback link"
                />
                <button type="button" className="btn btn-primary" onClick={handleCopy}>
                  Copy
                </button>
                {isNativePlatform() && (
                  <button type="button" className="btn" onClick={handleNativeShare}>
                    Share…
                  </button>
                )}
              </div>
            )}

            <h3 className="deck-feedback-section-title">
              Responses{responses ? ` (${responses.length})` : ''}
            </h3>
            {loadError && (
              <p role="alert" className="deck-feedback-error">
                {loadError}
              </p>
            )}
            {responses && responses.length === 0 && (
              <p className="deck-feedback-empty">
                No responses yet. Share the link with your pod or post it with your deck.
              </p>
            )}
            {responses?.map((response) => (
              <article key={response.id} className="deck-feedback-response">
                <header className="deck-feedback-response-head">
                  <span className="deck-feedback-author">{response.authorName}</span>
                  {response.bracketSuggestion != null && (
                    <span className="deck-feedback-bracket">
                      Bracket {response.bracketSuggestion}
                    </span>
                  )}
                  <span className="deck-feedback-time">
                    {formatRelativeTime(response.createdAt)}
                  </span>
                  <button
                    type="button"
                    className="deck-feedback-dismiss"
                    aria-label={`Delete response from ${response.authorName}`}
                    onClick={() => handleDelete(response)}
                  >
                    <X width={14} height={14} strokeWidth={2} aria-hidden />
                  </button>
                </header>
                {response.comment && <p className="deck-feedback-comment">{response.comment}</p>}
                {response.suggestions.length > 0 && (
                  <ul className="deck-feedback-suggestions">
                    {response.suggestions.map((suggestion) => {
                      const blocked =
                        suggestion.status === 'pending'
                          ? suggestionBlockedReason(deckCards, suggestion)
                          : null;
                      return (
                        <li key={suggestion.id} className="deck-feedback-suggestion">
                          <span
                            className={`deck-feedback-kind deck-feedback-kind--${suggestion.type}`}
                          >
                            {suggestion.type === 'add' ? 'Add' : 'Cut'}
                          </span>
                          <span className="deck-feedback-suggestion-name">
                            {suggestion.cardName}
                          </span>
                          {suggestion.status === 'pending' ? (
                            blocked ? (
                              <span className="deck-feedback-blocked">{blocked}</span>
                            ) : (
                              <span className="deck-feedback-verdicts">
                                <button
                                  type="button"
                                  className="deck-feedback-verdict deck-feedback-verdict--accept"
                                  onClick={() => handleVerdict(response, suggestion, 'accepted')}
                                >
                                  <Check width={13} height={13} strokeWidth={2.2} aria-hidden />
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  className="deck-feedback-verdict"
                                  onClick={() => handleVerdict(response, suggestion, 'rejected')}
                                >
                                  <X width={13} height={13} strokeWidth={2.2} aria-hidden />
                                  Reject
                                </button>
                              </span>
                            )
                          ) : (
                            <span
                              className={`deck-feedback-status deck-feedback-status--${suggestion.status}`}
                            >
                              {suggestion.status === 'accepted' ? 'Accepted' : 'Rejected'}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
            ))}
            {!responses && !loadError && <p className="deck-feedback-empty">Loading responses…</p>}
          </div>
        )}

        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={() => dismiss()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
