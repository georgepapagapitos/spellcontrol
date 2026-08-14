import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import type { Change } from '@/lib/deck-change';
import { analyzeDeck } from '../../lib/deck-analysis';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { buildDeckReviewCards, splitReviewSections, tokenizeCardNames } from '../../lib/ai-review';
import { requestDeckRefine, type RefineCard, type RefineTweak } from '../../lib/ai-refine';
import { noteAiExhausted, noteAiSpend, useAiStatus } from '../../lib/use-ai-status';
import { useCardCarousel } from './useCardCarousel';
import './DeckAiReview.css';

interface DeckAiRefineProps {
  deckId: string;
  format: DeckFormat;
  commander: ScryfallCard;
  partnerCommander: ScryfallCard | null;
  mainboard: { slotId: string; card: ScryfallCard }[];
  /** Engine-supplied candidates — the only cards the model may propose. */
  pool: RefineCard[];
  ownedOnly: boolean;
  /** The existing coach apply path — never a parallel one. */
  onApplyMove: (change: Change) => void;
}

/**
 * "Refine this build" — the optional post-generation AI pass (T102 slice 4).
 *
 * The engine decides what the model may even consider: `pool` comes from the
 * coach's own already-computed lanes, and the server re-verifies every name
 * before it reaches here. So a tweak rendered in this panel is guaranteed to
 * name a real candidate and a real in-deck card.
 *
 * Accepting one builds a `Change` and hands it to the same `onApplyMove` the
 * CoachFeed uses, so allocation, atomic swap and undo all behave identically
 * to accepting a coach suggestion.
 */
export function DeckAiRefine({
  deckId,
  format,
  commander,
  partnerCommander,
  mainboard,
  pool,
  ownedOnly,
  onApplyMove,
}: DeckAiRefineProps) {
  const taggerReady = useTaggerReady();
  const status = useAiStatus();
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamed, setStreamed] = useState('');
  const [strategy, setStrategy] = useState<string | null>(null);
  const [tweaks, setTweaks] = useState<RefineTweak[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const commanderName = partnerCommander
    ? `${commander.name} // ${partnerCommander.name}`
    : commander.name;
  const cards = useMemo(() => buildDeckReviewCards(mainboard), [mainboard]);
  const cardsByName = useMemo(() => {
    const m = new Map<string, ScryfallCard>();
    for (const { card } of mainboard) m.set(card.name, card);
    return m;
  }, [mainboard]);

  // Self-hiding like every AI surface: nothing at all when the feature is
  // unavailable or consent hasn't been granted (the review panel above owns
  // the consent card, so this one simply waits for it).
  const remaining = status ? Math.max(0, status.limit - status.used) : 0;

  const run = () => {
    setPhase('working');
    setError(null);
    setStreamed('');
    setStrategy(null);
    setTweaks([]);
    setApplied(new Set());
    const analysis = analyzeDeck({ format, commander, partnerCommander, mainboard }, taggerReady);
    requestDeckRefine(
      { deckId, commander: commanderName, cards, pool, ownedOnly, analysis },
      setStreamed
    )
      .then((result) => {
        setStrategy(result.content);
        setTweaks(result.tweaks);
        setStreamed('');
        setPhase('idle');
        if (!result.cached) noteAiSpend();
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 429) noteAiExhausted();
        setStreamed('');
        setError(err.message || 'The refine pass could not be generated. Try again.');
        setPhase('error');
      });
  };

  const accept = (tweak: RefineTweak) => {
    // `name` is the card coming IN and `inName` the one being cut — the
    // direction `fromSwap` and the page's apply handler both use.
    onApplyMove(
      tweak.cut
        ? {
            id: `ai-refine:${tweak.cut}->${tweak.add}`,
            type: 'swap',
            lane: 'similar',
            name: tweak.add,
            inName: tweak.cut,
            reason: tweak.why,
          }
        : {
            id: `ai-refine:${tweak.add}`,
            type: 'add',
            lane: 'similar',
            name: tweak.add,
            reason: tweak.why,
          }
    );
    setApplied((prev) => new Set(prev).add(tweak.add));
  };

  if (!status || !status.optIn) return null;

  return (
    <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
      <h4 className="deck-stats-panel-title">
        Refine this build
        <span className="deck-ai-marker">AI Beta</span>
      </h4>

      {strategy && (
        <div aria-live="polite">
          <RefineProse content={strategy} cardsByName={cardsByName} />
          {tweaks.length > 0 ? (
            <ul className="deck-ai-tweaks">
              {tweaks.map((t) => (
                <li key={t.add} className="deck-ai-tweak">
                  <div className="deck-ai-tweak-move">
                    <strong>{t.add}</strong>
                    {t.cut && (
                      <>
                        <span className="deck-ai-tweak-arrow" aria-hidden>
                          ←
                        </span>
                        <span className="deck-ai-tweak-cut">{t.cut}</span>
                      </>
                    )}
                  </div>
                  <p className="deck-ai-tweak-why">{t.why}</p>
                  {applied.has(t.add) ? (
                    <span className="deck-ai-tweak-done">
                      <Check width={14} height={14} strokeWidth={2.5} aria-hidden /> Applied
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => accept(t)}
                      aria-label={t.cut ? `Swap ${t.cut} for ${t.add}` : `Add ${t.add}`}
                    >
                      Apply
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            /* An empty list is a real answer, not a failure — say so plainly
               rather than leaving the panel looking broken. */
            <p className="deck-ai-tweak-none">
              No changes worth making — the build already holds together.
            </p>
          )}
        </div>
      )}

      {/* Same rule as the review panel: the streaming text and the settled
          text render through ONE path in final typography, so nothing reflows
          when it lands. Chips wait for a paragraph to finish — chipping a
          half-typed name would change its width under the cursor. */}
      {phase === 'working' && streamed && (
        <div aria-live="polite">
          <span className="sr-only" role="status">
            Reading the build…
          </span>
          <RefineProse content={streamed} cardsByName={cardsByName} streaming />
        </div>
      )}

      {phase === 'working' && !streamed && (
        <div
          className="deck-ai-skeleton"
          role="status"
          aria-live="polite"
          aria-label="Refining the build"
        >
          <span className="deck-ai-skeleton-line" />
          <span className="deck-ai-skeleton-line" />
          <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
        </div>
      )}

      {phase === 'error' && error && (
        <div className="deck-ai-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={run}>
            Try again
          </button>
        </div>
      )}

      {phase === 'idle' && !strategy && (
        <div className="deck-ai-idle">
          <p className="deck-ai-idle-text">
            {pool.length === 0
              ? 'Once the coach has candidates for this deck, AI can weigh them and suggest a few swaps.'
              : `AI can read what the generator built and suggest a few changes${
                  ownedOnly ? ' from cards you own' : ''
                } — chosen from the ${pool.length} candidates the coach already found, never invented.`}
          </p>
          <div className="deck-ai-idle-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={run}
              disabled={remaining === 0 || pool.length === 0}
            >
              Refine this build
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

/** The strategy read, sectioned and chipped exactly like the deck review. */
function RefineProse({
  content,
  cardsByName,
  streaming = false,
}: {
  content: string;
  cardsByName: Map<string, ScryfallCard>;
  streaming?: boolean;
}) {
  const carousel = useCardCarousel('Cards in the reading');
  const sections = useMemo(() => splitReviewSections(content), [content]);
  const names = useMemo(() => [...cardsByName.keys()], [cardsByName]);
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

  const entries = useMemo(() => {
    const seen: string[] = [];
    for (const para of paragraphs) {
      for (const t of tokenizeCardNames(para, names)) {
        if (t.card && !seen.includes(t.card)) seen.push(t.card);
      }
    }
    return seen.map((name) => ({
      name,
      label: 'Named in the reading',
      card: cardsByName.get(name),
    }));
  }, [paragraphs, names, cardsByName]);

  return (
    <>
      <div className={`deck-ai-prose${streaming ? ' deck-ai-prose--streaming' : ''}`}>
        {paragraphs.map((para, i) => (
          <p key={i}>
            {/* The final paragraph is the one still being typed. */}
            {streaming && i === paragraphs.length - 1 ? (
              <span>{para}</span>
            ) : (
              tokenizeCardNames(para, names).map((t, j) => {
                const named = t.card;
                return named ? (
                  <button
                    key={j}
                    type="button"
                    className="deck-ai-card-chip"
                    onClick={() => void carousel.open(entries, named)}
                    aria-label={`Preview ${named}`}
                  >
                    {t.text}
                  </button>
                ) : (
                  <span key={j}>{t.text}</span>
                );
              })
            )}
          </p>
        ))}
      </div>
      {carousel.preview}
    </>
  );
}
