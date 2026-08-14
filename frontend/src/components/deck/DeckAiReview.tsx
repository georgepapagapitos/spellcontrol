import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { analyzeDeck } from '../../lib/deck-analysis';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { isBasicLandName } from '../../lib/allocations-core';
import {
  buildDeckReviewCards,
  deckContentKey,
  requestDeckReview,
  splitReviewSections,
  tokenizeCardNames,
} from '../../lib/ai-review';
import { grantAiConsent, noteAiExhausted, noteAiSpend, useAiStatus } from '../../lib/use-ai-status';
import { useCardCarousel } from './useCardCarousel';
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
  const [inviteDismissed, setInviteDismissed] = useState(
    () => localStorage.getItem(INVITE_DISMISSED_KEY) === '1'
  );
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<HeldReview | null>(null);
  /** Prose received so far while the model is still writing (T102 streaming). */
  const [streamed, setStreamed] = useState('');

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
  const stale = review !== null && review.key !== currentKey;

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

  // ── Not opted in: consent granted in place, or dismissed for good ──
  if (!status.optIn) {
    if (inviteDismissed) return null;
    const enable = () => {
      setConsentBusy(true);
      setConsentError(null);
      grantAiConsent()
        .catch((err: Error) => setConsentError(err.message || 'Could not turn this on.'))
        .finally(() => setConsentBusy(false));
    };
    return (
      <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
        <h4 className="deck-stats-panel-title">
          Read the deck
          <span className="deck-ai-marker">AI Beta</span>
        </h4>
        <div className="deck-ai-invite">
          <p className="deck-ai-invite-text">
            AI can read this deck and write what it's trying to do — and the structural problems the
            statistics can't show. Turning this on sends this deck's card names and computed stats
            to Anthropic. Nothing is sent until you press an AI button, {status.limit} readings a
            day. Your collection is never sent, and you can turn it back off in Settings.
          </p>
          {consentError && (
            <p className="deck-ai-consent-error" role="alert">
              {consentError}
            </p>
          )}
          <div className="deck-ai-invite-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={enable}
              disabled={consentBusy}
            >
              {consentBusy ? 'Turning on…' : 'Turn on AI Beta'}
            </button>
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
          <ReviewProse content={review.content} chipCards={chipCards} stale={stale} />
        </div>
      )}

      {/* Streaming: the skeleton only covers the wait before the first word.
          Once prose is arriving it renders as it lands — plain paragraphs, no
          section titles and no chips yet, because the sections are decided by
          where the LAST paragraph falls and chips on half a name would
          flicker. The titled, weakness-first view settles in on completion. */}
      {phase === 'reading' &&
        (streamed ? (
          <div className="deck-ai-prose deck-ai-prose--streaming" aria-busy="true">
            <p className="deck-ai-writing" role="status">
              Writing…
            </p>
            {streamed.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        ) : (
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
        ))}

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

/**
 * The review, read as three titled sections with the weakness led — that's the
 * part statistics can't give you, so it doesn't wait at the bottom of three
 * chunky blocks of text. Prose the prompt didn't shape into three paragraphs
 * falls back to plain paragraphs rather than mislabelling itself.
 *
 * Card names in the prose become chips into the shared card carousel; every
 * name mentioned anywhere in the review is a carousel slide, so a tap lands on
 * the card tapped and swipes through the rest.
 */
function ReviewProse({
  content,
  chipCards,
  stale,
}: {
  content: string;
  chipCards: Map<string, ScryfallCard>;
  stale: boolean;
}) {
  const carousel = useCardCarousel('Cards in the reading');
  const sections = useMemo(() => splitReviewSections(content), [content]);
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

  const renderParagraph = (text: string, key: string) => (
    <p key={key}>
      {tokenizeCardNames(text, names).map((t, i) => {
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
      })}
    </p>
  );

  return (
    <>
      <div className={`deck-ai-prose${stale ? ' deck-ai-prose--stale' : ''}`}>
        {sections
          ? sections.map((s) => (
              <section
                key={s.id}
                className={`deck-ai-section deck-ai-section--${s.id}`}
                aria-labelledby={`deck-ai-section-${s.id}`}
              >
                <h5 id={`deck-ai-section-${s.id}`} className="deck-ai-section-title">
                  {s.title}
                </h5>
                {s.paragraphs.map((p, i) => renderParagraph(p, `${s.id}-${i}`))}
              </section>
            ))
          : paragraphs.map((p, i) => renderParagraph(p, `p-${i}`))}
      </div>
      {carousel.preview}
    </>
  );
}
