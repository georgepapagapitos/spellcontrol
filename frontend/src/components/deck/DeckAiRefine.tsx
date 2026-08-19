import { useMemo, useState } from 'react';
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import type { Change } from '@/lib/deck-change';
import { analyzeDeck } from '../../lib/deck-analysis';
import { useTaggerReady } from '@/lib/use-tagger-ready';
import {
  buildDeckReviewCards,
  splitReviewSections,
  stripEmphasis,
  toAiAnalysis,
  tokenizeCardNames,
} from '../../lib/ai-review';
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
  /** The owner's target bracket (`deck.bracketOverride`), if set. */
  bracketTarget?: number | null;
  /** The app's current-power estimate (`deck.bracketEstimation?.bracket`), if computed. */
  bracketEstimate?: number | null;
  /** The existing coach apply path — never a parallel one. */
  onApplyMove: (change: Change) => void;
  /**
   * Where the panel lives, which decides its posture and copy.
   *
   * - `'build'` (default): the post-generation build-report sheet — full panel,
   *   always a freshly generated deck. `'coach'` shares this copy but is NOT
   *   generated-only any more (#1673), so the shared text stays
   *   provenance-neutral rather than claiming a generator built the deck.
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
  variant?: 'build' | 'suggestions' | 'replace' | 'coach';
  /**
   * Same-role stand-ins per proposed card, keyed by the proposed card's name.
   * Built by `buildAlternativeIndex`. Absent ⇒ render no re-roll control.
   */
  alternatives?: ReadonlyMap<string, string[]>;
  /**
   * Bulk-apply every remaining swap tweak as ONE undo entry.
   * Absent ⇒ render no bulk control.
   */
  onApplyAll?: (swaps: Array<{ removeName: string; addName: string }>) => void;
}

/** localStorage key for a deck's dismissed AI-refine suggestions (added-card
 *  names). Wrapped in try/catch everywhere it's touched — Safari private
 *  mode throws on both read and write. */
function dismissedKey(deckId: string): string {
  return `sc-ai-refine-dismissed:${deckId}`;
}

function loadDismissed(deckId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedKey(deckId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? new Set(parsed.filter((n) => typeof n === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(deckId: string, names: Set<string>): void {
  try {
    localStorage.setItem(dismissedKey(deckId), JSON.stringify([...names]));
  } catch {
    // Private-mode/quota — the dismissal just won't survive a reload.
  }
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
  bracketTarget = null,
  bracketEstimate = null,
  onApplyMove,
  variant = 'build',
  alternatives,
  onApplyAll,
}: DeckAiRefineProps) {
  const taggerReady = useTaggerReady();
  const status = useAiStatus();
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamed, setStreamed] = useState('');
  const [strategy, setStrategy] = useState<string | null>(null);
  /** Cards the pass looked up — chipped alongside the deck's own. */
  const [suggested, setSuggested] = useState<string[] | undefined>(undefined);
  const [tweaks, setTweaks] = useState<RefineTweak[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [inviteDismissed, setInviteDismissed] = useState(isAiInviteDismissed);
  const [expanded, setExpanded] = useState(false);
  // Dismissed swaps (T102 refine levers) — keyed by the AI's proposed `add`
  // name, persisted so a rejected suggestion never resurrects on reopen or a
  // cached-reading replay.
  //
  // ⚠️ This initializer runs on MOUNT, which is correct only because every call
  // site passes `key={deck.id}`. `/decks/:id` has no route key, so react-router
  // reuses the editor element when navigating between decks — without the key
  // this panel would never unmount, deck A's set would stay in state, and the
  // next `saveDismissed` would write it back under deck B's key. The same key is
  // what discards deck A's reading, so "Apply all" can't push A's swaps into B.
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(deckId));
  // Re-roll index per tweak (keyed by the AI's `add` name) into that row's
  // `alternatives` list. Absent ⇒ showing the AI's original pick.
  const [rerollIndex, setRerollIndex] = useState<Map<string, number>>(new Map());

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
    setSuggested(undefined);
    setTweaks([]);
    setApplied(new Set());
    setRerollIndex(new Map());
    const analysis = toAiAnalysis(
      analyzeDeck({ format, commander, partnerCommander, mainboard }, taggerReady),
      { target: bracketTarget, estimate: bracketEstimate }
    );
    requestDeckRefine(
      { deckId, commander: commanderName, cards, pool, ownedOnly, analysis },
      setStreamed
    )
      .then((result) => {
        setStrategy(result.content);
        setSuggested(result.fetched);
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

  // A re-rolled row shows a different card than the AI proposed, so any
  // apply path — single accept or the bulk "Apply all" — must move on the
  // card actually on screen, never the AI's original pick underneath it.
  const displayNameFor = (tweak: RefineTweak): string => {
    const idx = rerollIndex.get(tweak.add);
    if (idx === undefined) return tweak.add;
    return alternatives?.get(tweak.add)?.[idx] ?? tweak.add;
  };

  const accept = (tweak: RefineTweak) => {
    const addName = displayNameFor(tweak);
    // The AI's `why` is about the AI's card — once re-rolled it no longer
    // applies, so the applied Change carries a neutral engine reason instead
    // of misattributing the model's claim to a card it never evaluated.
    const reason = rerollIndex.has(tweak.add)
      ? `Engine alternative — same role as ${tweak.add}.`
      : tweak.why;
    // `name` is the card coming IN and `inName` the one being cut — the
    // direction `fromSwap` and the page's apply handler both use.
    onApplyMove(
      tweak.cut
        ? {
            id: `ai-refine:${tweak.cut}->${addName}`,
            type: 'swap',
            lane: 'similar',
            name: addName,
            inName: tweak.cut,
            reason,
          }
        : {
            id: `ai-refine:${addName}`,
            type: 'add',
            lane: 'similar',
            name: addName,
            reason,
          }
    );
    setApplied((prev) => new Set(prev).add(tweak.add));
  };

  // Every remaining swap tweak eligible for the bulk button: not yet applied
  // or dismissed, and cut-bearing (a cut-less pure add has no swap pair).
  const bulkable = tweaks.filter((t) => t.cut && !applied.has(t.add) && !dismissed.has(t.add));

  const applyAll = () => {
    if (!onApplyAll) return;
    const swaps = bulkable.map((t) => ({
      removeName: t.cut as string,
      addName: displayNameFor(t),
    }));
    onApplyAll(swaps);
    setApplied((prev) => {
      const next = new Set(prev);
      for (const t of bulkable) next.add(t.add);
      return next;
    });
  };

  const dismiss = (addName: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(addName);
      saveDismissed(deckId, next);
      return next;
    });
  };

  const undoDismiss = (addName: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(addName);
      saveDismissed(deckId, next);
      return next;
    });
  };

  /** Cycle: AI's pick → alt 0 → alt 1 → … → back to the AI's pick. */
  const cycleAlt = (addName: string, altsLength: number) => {
    setRerollIndex((prev) => {
      const cur = prev.get(addName);
      const nextIdx = cur === undefined ? 0 : cur + 1;
      const next = new Map(prev);
      if (nextIdx >= altsLength) next.delete(addName);
      else next.set(addName, nextIdx);
      return next;
    });
  };

  const resetReroll = (addName: string) => {
    setRerollIndex((prev) => {
      if (!prev.has(addName)) return prev;
      const next = new Map(prev);
      next.delete(addName);
      return next;
    });
  };

  const isSuggestions = variant === 'suggestions';
  const isReplace = variant === 'replace';
  // `coach` = the Coach-tab mount: same build framing, but the tab's primary
  // content is the suggestion feed, so it takes the strip posture too. Only
  // the build-report sheet (a report, not a list) mounts the full panel.
  const isCoach = variant === 'coach';
  // Strip posture for the list-surface mounts: their hosts' primary content is
  // a list (suggestion rows / ranked cuts) that the panel must not displace.
  const strip = isSuggestions || isReplace || isCoach;
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
        {(isSuggestions || isCoach) && (
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
          <RefineProse content={strategy} cardsByName={cardsByName} suggested={suggested} />
          {tweaks.length > 0 ? (
            <>
              {onApplyAll && !isReplace && bulkable.length >= 2 && (
                <button type="button" className="btn deck-ai-bulk-apply" onClick={applyAll}>
                  Apply all {bulkable.length} swaps
                </button>
              )}
              <ul className="deck-ai-tweaks">
                {tweaks.map((t) => {
                  if (dismissed.has(t.add)) {
                    return (
                      <li key={t.add} className="deck-ai-tweak deck-ai-tweak--dismissed">
                        <span className="deck-ai-tweak-dismissed-text">Dismissed {t.add}</span>
                        <button
                          type="button"
                          className="btn deck-ai-tweak-undo"
                          onClick={() => undoDismiss(t.add)}
                        >
                          Undo
                        </button>
                      </li>
                    );
                  }
                  const alts = alternatives?.get(t.add) ?? [];
                  const rerollIdx = rerollIndex.get(t.add);
                  const rerolled = rerollIdx !== undefined;
                  const shownName = rerolled ? (alts[rerollIdx] ?? t.add) : t.add;
                  return (
                    <li key={t.add} className="deck-ai-tweak">
                      <div className="deck-ai-tweak-move">
                        <strong>{shownName}</strong>
                        {t.cut && (
                          <>
                            <span className="deck-ai-tweak-arrow" aria-hidden>
                              ←
                            </span>
                            <span className="deck-ai-tweak-cut">{t.cut}</span>
                          </>
                        )}
                      </div>
                      {rerolled ? (
                        <p className="deck-ai-tweak-why deck-ai-tweak-why--engine">
                          Engine alternative — same role as {t.add}.{' '}
                          <button
                            type="button"
                            className="deck-ai-tweak-reset"
                            onClick={() => resetReroll(t.add)}
                            aria-label={`Use the AI's pick, ${t.add}, instead`}
                          >
                            Use the AI&rsquo;s pick
                          </button>
                        </p>
                      ) : (
                        <p className="deck-ai-tweak-why">{t.why}</p>
                      )}
                      <div className="deck-ai-tweak-actions">
                        {alts.length > 0 && (
                          <button
                            type="button"
                            className="deck-ai-tweak-reroll"
                            onClick={() => cycleAlt(t.add, alts.length)}
                            aria-label={`Try another alternative to ${shownName}`}
                          >
                            <RefreshCw width={16} height={16} aria-hidden />
                          </button>
                        )}
                        <button
                          type="button"
                          className="deck-ai-tweak-dismiss"
                          onClick={() => dismiss(t.add)}
                          aria-label={`Dismiss ${shownName}`}
                        >
                          <X width={16} height={16} aria-hidden />
                        </button>
                        {applied.has(t.add) ? (
                          <span className="deck-ai-tweak-done">
                            <Check width={14} height={14} strokeWidth={2.5} aria-hidden /> Applied
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => accept(t)}
                            aria-label={
                              t.cut ? `Swap ${t.cut} for ${shownName}` : `Add ${shownName}`
                            }
                          >
                            Apply
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
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
                  : /* Deliberately says "this deck", not "what the generator
                       built": since #1673 the Coach mount is no longer gated to
                       generated decks, and this same string renders on
                       hand-built ones, where a generator never existed. */
                    `AI can read this deck and suggest a few changes${
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

/** The strategy read, sectioned and chipped exactly like the deck review —
 *  including `suggested`, the cards this pass looked up, which stay name-only
 *  so the carousel resolves the player's own printing where they own one. */
function RefineProse({
  content,
  cardsByName,
  suggested,
  streaming = false,
}: {
  content: string;
  cardsByName: Map<string, ScryfallCard>;
  suggested?: string[];
  streaming?: boolean;
}) {
  const carousel = useCardCarousel('Cards in the reading');
  // See ReviewProse: markdown emphasis is stripped before anything reads the
  // prose, because nothing here renders markdown.
  const prose = useMemo(() => stripEmphasis(content), [content]);
  const sections = useMemo(() => splitReviewSections(prose), [prose]);
  const names = useMemo(
    () => [...cardsByName.keys(), ...(suggested ?? [])],
    [cardsByName, suggested]
  );
  const paragraphs = useMemo(
    () =>
      sections
        ? sections.flatMap((s) => s.paragraphs)
        : prose
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean),
    [sections, prose]
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
      label: cardsByName.has(name) ? 'Named in the reading' : 'Suggested — not in this deck',
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
