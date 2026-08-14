import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import type { Change } from '@/lib/deck-change';
import { analyzeDeck } from '../../lib/deck-analysis';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import { buildDeckReviewCards, splitReviewSections, tokenizeCardNames } from '../../lib/ai-review';
import { requestDeckRefine, type RefineCard, type RefineTweak } from '../../lib/ai-refine';
import { noteAiExhausted, noteAiSpend, useAiStatus } from '../../lib/use-ai-status';
import { AiMarker, DeckAiConsent, isAiInviteDismissed } from './DeckAiConsent';
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
  /**
   * Where the panel lives, which decides its posture and copy.
   *
   * - `'build'` (default): the post-generation pass — full panel, generated
   *   decks, "second-guess the generator" framing.
   * - `'suggestions'`: the add-cards sheet's Suggestions tab (E244). The tab's
   *   primary job is browsing candidates, so per the STYLE_GUIDE insight-strip
   *   ruling the panel starts as ONE compact 44px strip and expands in place —
   *   it never pushes the suggestion rows down uninvited. Renders nothing at
   *   all with an empty pool (an advisor with nothing to say shows no chrome).
   * - `'replace'`: the replace-when-full prompt. The pool is exactly the ONE
   *   card being added, so the model's answer is a verdict: a swap tweak means
   *   "it's an upgrade, cut this", zero tweaks means it isn't worth a slot.
   *   Cut-less tweaks are dropped — a pure add can't apply to a full deck.
   *   Same strip posture (the ranked cuts are the prompt's primary content).
   */
  variant?: 'build' | 'suggestions' | 'replace';
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
  variant = 'build',
}: DeckAiRefineProps) {
  const taggerReady = useTaggerReady();
  const status = useAiStatus();
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamed, setStreamed] = useState('');
  const [strategy, setStrategy] = useState<string | null>(null);
  const [tweaks, setTweaks] = useState<RefineTweak[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [inviteDismissed, setInviteDismissed] = useState(isAiInviteDismissed);
  const [expanded, setExpanded] = useState(false);

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
        // A full deck can't take a pure add — in the replace posture a
        // cut-less tweak has no apply path, so it never renders as one.
        setTweaks(variant === 'replace' ? result.tweaks.filter((t) => t.cut) : result.tweaks);
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

  const isSuggestions = variant === 'suggestions';
  const isReplace = variant === 'replace';
  // Strip posture for both slot mounts: their hosts' primary content is a list
  // (suggestion rows / ranked cuts) that the panel must not displace.
  const strip = isSuggestions || isReplace;
  const incoming = pool[0]?.name ?? 'this card';
  const title = isReplace
    ? 'Is it an upgrade?'
    : isSuggestions
      ? 'Weigh these suggestions'
      : 'Refine this build';

  // Nothing without the feature configured. Without CONSENT, offer it here
  // rather than rendering nothing: on the post-generation build report this is
  // the user's first point of use, and staying silent would hide the feature
  // exactly where it was meant to appear.
  if (!status) return null;
  if (!status.optIn && inviteDismissed) return null;
  // An advisor with nothing to say shows no chrome (insight-strip ruling).
  if (strip && pool.length === 0) return null;

  // The host's rows are the primary content — start as one compact strip and
  // let the user choose the expansion. Sheet state resets on close, so a
  // one-way disclosure is enough (the build report has no collapse either).
  if (strip && !expanded) {
    return (
      <button
        type="button"
        className="deck-ai-strip"
        aria-expanded={false}
        onClick={() => setExpanded(true)}
      >
        <AiMarker />
        <span className="deck-ai-strip-title">{title}</span>
        {isSuggestions && (
          <span className="deck-ai-strip-teaser">
            {pool.length} candidate{pool.length === 1 ? '' : 's'}
          </span>
        )}
        <ChevronDown width={16} height={16} aria-hidden />
      </button>
    );
  }

  if (!status.optIn) {
    return (
      <DeckAiConsent
        title={title}
        blurb={
          isReplace
            ? `AI can judge whether the card you're adding earns a slot, and which card to cut for it. Turning this on sends this deck's card names, its computed stats and the card you're adding to Anthropic. Nothing is sent until you press an AI button, ${status.limit} a day. Your collection is never sent, and you can turn it back off in Settings.`
            : isSuggestions
              ? `AI can weigh the suggestions on this tab against the deck and pick the few worth making. Turning this on sends this deck's card names, its computed stats and those candidates to Anthropic. Nothing is sent until you press an AI button, ${status.limit} a day. Your collection is never sent, and you can turn it back off in Settings.`
              : `AI can weigh the candidates the coach already found and suggest a few swaps. Turning this on sends this deck's card names, its computed stats and those candidates to Anthropic. Nothing is sent until you press an AI button, ${status.limit} a day. Your collection is never sent, and you can turn it back off in Settings.`
        }
        onDismiss={() => setInviteDismissed(true)}
      />
    );
  }

  return (
    <section className="deck-stats-panel deck-stats-panel--wide deck-ai-review">
      <h4 className="deck-stats-panel-title">
        {title}
        <AiMarker />
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
              {isReplace
                ? `AI wouldn't cut a card for ${incoming} — the deck holds together as it stands.`
                : 'No changes worth making — the build already holds together.'}
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
            {isReplace
              ? `AI can judge whether ${incoming} earns a slot in this deck — and if it does, which card to cut for it. It only ever names cards already in the deck.`
              : isSuggestions
                ? `AI can read the deck and pick the few of these ${pool.length} suggestions worth making — what to add, and what to cut to make room${
                    ownedOnly ? ', from cards you own' : ''
                  }. It only chooses cards the app already found, never invented ones.`
                : pool.length === 0
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
              {isReplace
                ? 'Weigh this add'
                : isSuggestions
                  ? 'Weigh the suggestions'
                  : 'Refine this build'}
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
