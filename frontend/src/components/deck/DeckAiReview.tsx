import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { analyzeDeck } from '../../lib/deck-analysis';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { isBasicLandName } from '../../lib/allocations-core';
import { formatRelativeTime } from '../../lib/format-time';
import {
  buildDeckReviewCards,
  deckContentKey,
  fetchReviewHistory,
  requestDeckReview,
  splitReviewSections,
  tokenizeCardNames,
  type ReviewReading,
} from '../../lib/ai-review';
import { noteAiExhausted, noteAiSpend, useAiStatus } from '../../lib/use-ai-status';
import { AiMarker, DeckAiConsent, isAiInviteDismissed } from './DeckAiConsent';
import { useCardCarousel } from './useCardCarousel';
import './DeckAiReview.css';

interface DeckAiReviewProps {
  deckId: string;
  format: DeckFormat;
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  mainboard: { slotId: string; card: ScryfallCard }[];
}

interface HeldReview {
  content: string;
  /**
   * Content key of the deck the review was written for — staleness signal.
   * Null for a reading restored from history: the deck it was written against
   * isn't known client-side, so it carries an as-of date instead.
   */
  key: string | null;
  /** Server timestamp, present only on history-restored readings. */
  writtenAt?: number;
}

/**
 * "Read the deck" — the opt-in AI panel (T96, moved to the Tune tab in T102).
 * Renders nothing at all unless the backend has the feature configured AND the
 * user is signed in; until they opt in it renders a dismissible inline consent
 * card that grants consent in place. Never auto-loads: a page render never
 * spends money — only the button does.
 *
 * Additive insight surface: it sits below the coach feed and displaces nothing.
 */
export function DeckAiReview({
  deckId,
  format,
  commander,
  partnerCommander,
  mainboard,
}: DeckAiReviewProps) {
  const taggerReady = useTaggerReady();
  const status = useAiStatus();
  const [inviteDismissed, setInviteDismissed] = useState(isAiInviteDismissed);
  // Insight-strip posture (E244): the Coach tab's primary content is the
  // suggestion feed, so this panel starts as one compact strip and expands in
  // place. One-way disclosure — a tab switch unmounts and re-collapses it; the
  // review itself is hash-cached server-side, so re-expanding stays free.
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<HeldReview | null>(null);
  /** Prose received so far while the model is still writing (T102 streaming). */
  const [streamed, setStreamed] = useState('');
  /** Past readings for this deck, newest first. Null until fetched. */
  const [history, setHistory] = useState<ReviewReading[] | null>(null);

  // Restoring past readings is a DB read of the user's own content — free,
  // never a model call — so fetching on expand doesn't break the
  // never-auto-spend rule. The newest one becomes the displayed reading, which
  // is what makes the panel feel persistent across tab switches and visits.
  // Keyed on the idle phase so it can never race a stream in progress, and so
  // a finished generation refreshes the list on its way back to idle.
  useEffect(() => {
    if (!expanded || !status?.optIn || phase !== 'idle') return;
    let alive = true;
    fetchReviewHistory(deckId)
      .then((readings) => {
        if (!alive) return;
        setHistory(readings);
        const newest = readings[0];
        if (newest) {
          setReview(
            (prev) => prev ?? { content: newest.content, key: null, writtenAt: newest.createdAt }
          );
        }
      })
      .catch(() => {
        if (alive) setHistory((prev) => prev ?? []);
      });
    return () => {
      alive = false;
    };
  }, [expanded, status?.optIn, deckId, phase]);

  const commanderName = partnerCommander
    ? `${commander.name} // ${partnerCommander.name}`
    : commander.name;

  const cards = useMemo(() => buildDeckReviewCards(mainboard), [mainboard]);
  const currentKey = useMemo(() => deckContentKey(commanderName, cards), [commanderName, cards]);

  /** Every card the prose may name, mapped to the printing this deck holds so
   *  chips open the player's own copy. Basics are excluded: "your Swamps" is a
   *  turn of phrase, not a card reference worth a chip. */
  const chipCards = useMemo(() => {
    const byName = new Map<string, ScryfallCard>();
    for (const c of [commander, partnerCommander, ...mainboard.map((m) => m.card)]) {
      if (c && !isBasicLandName(c.name)) byName.set(c.name, c);
    }
    return byName;
  }, [commander, partnerCommander, mainboard]);

  if (!status) return null;

  const remaining = Math.max(0, status.limit - status.used);
  const stale = review !== null && review.key !== null && review.key !== currentKey;

  const read = () => {
    const requestKey = currentKey;
    setPhase('reading');
    setError(null);
    setStreamed('');
    setReview(null);
    const analysis = analyzeDeck({ format, commander, partnerCommander, mainboard }, taggerReady);
    requestDeckReview({ deckId, commander: commanderName, cards, analysis }, setStreamed)
      .then((result) => {
        setReview({ content: result.content, key: requestKey });
        setStreamed('');
        setPhase('idle');
        if (!result.cached) noteAiSpend();
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 429) noteAiExhausted();
        // A partial reading is worth nothing — it was never stored, and half a
        // finding reads as a finding. Drop it and offer the retry.
        setStreamed('');
        setError(err.message || 'The review could not be generated. Try again.');
        setPhase('error');
      });
  };

  // Dismissed for good without consent: nothing at all (self-hiding rule).
  if (!status.optIn && inviteDismissed) return null;

  // Collapsed strip — expanding reveals the consent card or the panel itself.
  if (!expanded) {
    return (
      <button
        type="button"
        className="deck-ai-strip"
        aria-expanded={false}
        onClick={() => setExpanded(true)}
      >
        <AiMarker label={status.optIn ? 'AI-written' : undefined} />
        <span className="deck-ai-strip-title">Read the deck</span>
        <ChevronDown width={16} height={16} aria-hidden />
      </button>
    );
  }

  // ── Not opted in: consent granted in place, or dismissed for good ──
  if (!status.optIn) {
    return (
      <DeckAiConsent
        title="Read the deck"
        blurb={`AI can read this deck and write what it's trying to do — and the structural problems the statistics can't show. Turning this on sends this deck's card names and computed stats to Anthropic. Nothing is sent until you press an AI button, ${status.limit} readings a day. Your collection is never sent, and you can turn it back off in Settings.`}
        onDismiss={() => setInviteDismissed(true)}
      />
    );
  }

  // ── Opted in: idle / reading / error / result / stale ──
  return (
    <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
      <h4 className="deck-stats-panel-title">
        Read the deck
        <AiMarker label="AI-written" />
      </h4>

      {/* One render path for the streaming text and the settled review, so the
          reading never reflows: all three titled blocks exist from the first
          byte and each fills in place. Prompt v4 emits the labels in display
          order, so no block waits on a later one. The skeleton covers only the
          gap before the first label arrives. */}
      {(review || streamed) && (
        <div aria-live="polite">
          {stale && (
            <div className="deck-ai-stale" role="status">
              <span>Your deck has changed since this was written.</span>
              <button type="button" className="btn" onClick={read} disabled={phase === 'reading'}>
                Read again
              </button>
            </div>
          )}
          {/* A history-restored reading gets an as-of date, not a stale flag —
              whether the deck has changed since isn't knowable client-side. */}
          {review?.key === null && (
            <div className="deck-ai-stale" role="status">
              <span>Written {formatRelativeTime(review.writtenAt ?? 0, { verbose: true })}.</span>
              <button type="button" className="btn" onClick={read} disabled={phase === 'reading'}>
                Read again
              </button>
            </div>
          )}
          {/* Announced, but visually hidden — a "Writing…" line that later
              disappears would itself shift the reading. */}
          {!review && (
            <span className="sr-only" role="status">
              Writing the reading…
            </span>
          )}
          <ReviewProse
            content={review ? review.content : streamed}
            chipCards={chipCards}
            stale={stale}
            streaming={!review}
          />
        </div>
      )}

      {/* Every reading kept for this deck, newest first — reopening one is a
          local swap, never a model call. Hidden while a new one is written. */}
      {history !== null && history.length > 1 && phase !== 'reading' && (
        <nav className="deck-ai-history" aria-label="Previous readings">
          <span className="deck-ai-history-label">Readings</span>
          {history.map((r) => {
            const active = review !== null && review.content === r.content;
            return (
              <button
                key={r.id}
                type="button"
                className="deck-ai-history-item"
                aria-current={active || undefined}
                onClick={() => {
                  if (active) return;
                  setReview({ content: r.content, key: null, writtenAt: r.createdAt });
                  setError(null);
                  setPhase('idle');
                }}
              >
                {formatRelativeTime(r.createdAt, { verbose: true })}
              </button>
            );
          })}
        </nav>
      )}

      {/* First expand: a beat while past readings are checked, so the idle
          pitch never flashes in front of a reading about to restore. */}
      {phase === 'idle' && !review && history === null && (
        <div
          className="deck-ai-skeleton"
          role="status"
          aria-live="polite"
          aria-label="Checking for past readings"
        >
          <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
        </div>
      )}

      {phase === 'reading' && !streamed && (
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

      {phase === 'idle' && !review && history !== null && (
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

/**
 * The review, rendered as three titled sections with the weakness led — that's
 * the part statistics can't give you, so it doesn't wait at the bottom of three
 * chunky blocks of text.
 *
 * The SAME component draws the live stream and the finished review, which is
 * what stops the reading reflowing when it settles: all three titled blocks are
 * present from the first label, and each fills in place with its final
 * typography. A section still being written shows a caret; sections not reached
 * yet sit quiet.
 *
 * Card names become chips into the shared card carousel, but only once their
 * section is COMPLETE — chipping a half-typed name would change its width and
 * jitter the line under the cursor.
 *
 * Prose with no labels at all (a review cached from prompt v3) falls back to
 * plain paragraphs, exactly as it rendered before.
 */
function ReviewProse({
  content,
  chipCards,
  stale,
  streaming = false,
}: {
  content: string;
  chipCards: Map<string, ScryfallCard>;
  stale: boolean;
  streaming?: boolean;
}) {
  const carousel = useCardCarousel('Cards in the reading');
  const sections = useMemo(() => splitReviewSections(content, streaming), [content, streaming]);
  const names = useMemo(() => [...chipCards.keys()], [chipCards]);

  const paragraphs = useMemo(
    () =>
      sections
        ? sections.flatMap((s) => s.paragraphs)
        : content
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean),
    [sections, content]
  );

  /** Carousel slides: every mentioned card, in first-appearance order. */
  const entries = useMemo(() => {
    const seen: string[] = [];
    for (const para of paragraphs) {
      for (const t of tokenizeCardNames(para, names)) {
        if (t.card && !seen.includes(t.card)) seen.push(t.card);
      }
    }
    return seen.map((name) => ({ name, label: 'Named in the reading', card: chipCards.get(name) }));
  }, [paragraphs, names, chipCards]);

  const renderParagraph = (text: string, key: string, chipped: boolean) => (
    <p key={key}>
      {chipped ? (
        tokenizeCardNames(text, names).map((t, i) => {
          const named = t.card;
          return named ? (
            <button
              key={i}
              type="button"
              className="deck-ai-card-chip"
              onClick={() => void carousel.open(entries, named)}
              aria-label={`Preview ${named}`}
            >
              {t.text}
            </button>
          ) : (
            <span key={i}>{t.text}</span>
          );
        })
      ) : (
        <span>{text}</span>
      )}
    </p>
  );

  const proseClass = `deck-ai-prose${stale ? ' deck-ai-prose--stale' : ''}${
    streaming ? ' deck-ai-prose--streaming' : ''
  }`;

  return (
    <>
      <div className={proseClass} aria-busy={streaming || undefined}>
        {sections
          ? sections.map((sec) => (
              <section
                key={sec.id}
                className={`deck-ai-section deck-ai-section--${sec.id}${
                  sec.paragraphs.length === 0 ? ' deck-ai-section--pending' : ''
                }${!sec.complete && sec.paragraphs.length > 0 ? ' deck-ai-section--writing' : ''}`}
                aria-labelledby={`deck-ai-section-${sec.id}`}
              >
                <h5 id={`deck-ai-section-${sec.id}`} className="deck-ai-section-title">
                  {sec.title}
                </h5>
                {sec.paragraphs.map((para, i) =>
                  renderParagraph(para, `${sec.id}-${i}`, sec.complete)
                )}
              </section>
            ))
          : paragraphs.map((p, i) => renderParagraph(p, `p-${i}`, !streaming))}
      </div>
      {carousel.preview}
    </>
  );
}
