import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { AiMarker, DeckAiConsent } from '../components/deck/DeckAiConsent';
// The answer's skeleton, inline error and card chips reuse the review panel's
// classes by name; this page is its own lazy chunk, so it has to load the
// stylesheet it borrows from (css-chunk-ownership.test.ts).
import '../components/deck/DeckAiReview.css';
import { useCardCarousel, type CarouselEntry } from '../components/deck/useCardCarousel';
import {
  fetchRulesHistory,
  requestRulesAnswer,
  tokenizeRuleRefs,
  type CitedRule,
  type RulesQuestionEntry,
} from '../lib/ai-rules';
import { stripEmphasis, tokenizeCardNames } from '../lib/ai-review';
import { noteAiExhausted, noteAiSpend, useAiStatus } from '../lib/use-ai-status';
import { formatRelativeTime } from '../lib/format-time';
import { useRulesReferenceStore } from '../store/rules-reference';
import './RulesPage.css';

import { userMessage } from '@/lib/user-error';
/** Fill-the-box starters — tapping one spends nothing (never auto-ask). */
const SAMPLE_QUESTIONS = [
  'Does deathtouch destroy a creature with indestructible?',
  'Can I respond to my opponent cracking a fetchland?',
  'If my commander is dealt lethal damage, can I put it back in the command zone?',
];

interface HeldAnswer {
  question: string;
  content: string;
  rules: CitedRule[];
  /** Cards the answer looked up — the tappable names. */
  fetched?: string[];
  /** Server timestamp, present only on history-restored answers. */
  askedAt?: number;
}

/**
 * `/rules` — the AI rules Q&A (E261, "Ask a judge"). Ask a Magic rules
 * question; the answer is grounded in the Comprehensive Rules index and the
 * card database, streams in as it is written, and cites the exact rules it
 * relies on — each citation expandable to the official text below the answer.
 *
 * Every STYLE_GUIDE AI ruling applies: provenance pill on the title, nothing
 * sent until the Ask button, consent granted in place, streaming shows the
 * prose never the plumbing, past answers restore for free.
 */
export function RulesPage() {
  const status = useAiStatus();
  const location = useLocation();
  // The Rules Reference sheet's "Ask AI" door seeds the box with the search
  // that came up short — an initializer (setState-in-effect is an ERROR here),
  // and only a seed: nothing is sent until Ask (never auto-spend).
  const [question, setQuestion] = useState(
    () => (location.state as { question?: string } | null)?.question ?? ''
  );
  const [phase, setPhase] = useState<'idle' | 'asking' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<HeldAnswer | null>(null);
  /** Prose received so far while the model is still writing. */
  const [streamed, setStreamed] = useState('');
  /** Past questions, newest first. Null until fetched. */
  const [history, setHistory] = useState<RulesQuestionEntry[] | null>(null);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** The question in flight / most recently sent — rendered as the answer's
   *  title while streaming, and what Try again retries after the box cleared.
   *  State, not a ref: it is read during render (react-hooks/refs is an ERROR
   *  here). */
  const [lastAsked, setLastAsked] = useState('');

  // Restoring past answers is a DB read of the user's own content — free,
  // never a model call. Keyed on the idle phase so it can never race a stream,
  // and so a finished generation refreshes the list on its way back to idle.
  useEffect(() => {
    if (!status?.optIn || phase !== 'idle') return;
    let alive = true;
    fetchRulesHistory()
      .then((h) => {
        if (!alive) return;
        setHistory(h.questions);
        setEffectiveDate(h.effectiveDate);
        const newest = h.questions[0];
        if (newest) {
          setAnswer(
            (prev) =>
              prev ?? {
                question: newest.question,
                content: newest.content,
                rules: newest.rules,
                fetched: newest.fetched,
                askedAt: newest.createdAt,
              }
          );
        }
      })
      .catch(() => {
        if (alive) setHistory((prev) => prev ?? []);
      });
    return () => {
      alive = false;
    };
  }, [status?.optIn, phase]);

  // The built-in Comprehensive Rules reference (keywords, glossary, rule
  // numbers) is the door out of this page when the AI Q&A isn't available —
  // a guest who followed Play's "Rules" button here should still get rules.
  const openRulesReference = useRulesReferenceStore((s) => s.open);

  if (!status) {
    // Loading (undefined) shows a skeleton line rather than flashing the ask
    // box at someone who can't use it. Unavailable (null) is one signal with
    // several causes — no key on the backend, an account the feature isn't
    // open to, signed out, or the status call failed — so the copy names
    // none of them (STYLE_GUIDE § Voice, rule 3) and offers the door that is
    // always open: the built-in Comprehensive Rules reference.
    return (
      <div className="rules-page">
        <RulesPageHeader />
        {status === undefined ? (
          <div
            className="deck-ai-skeleton"
            role="status"
            aria-live="polite"
            aria-label="Checking whether the rules Q&A is available"
          >
            <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
          </div>
        ) : (
          <div className="rules-unavailable">
            <p>
              The AI rules Q&amp;A isn&rsquo;t available for you right now. The rules themselves are
              still here: look up a keyword, a glossary term, or a rule number in the reference.
            </p>
            <button type="button" className="btn" onClick={openRulesReference}>
              Open the rules reference
            </button>
          </div>
        )}
      </div>
    );
  }

  const remaining = Math.max(0, status.limit - status.used);

  const ask = (raw: string) => {
    const q = raw.trim();
    if (!q || phase === 'asking' || remaining === 0) return;
    setLastAsked(q);
    setPhase('asking');
    setError(null);
    setStreamed('');
    setAnswer(null);
    setQuestion('');
    requestRulesAnswer(q, setStreamed)
      .then((result) => {
        setAnswer({
          question: q,
          content: result.content,
          rules: result.rules,
          fetched: result.fetched,
        });
        setStreamed('');
        setPhase('idle');
        if (!result.cached) noteAiSpend();
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 429) noteAiExhausted();
        // A partial answer is worth nothing — it was never stored, and half a
        // ruling still reads as a ruling. Drop it and offer the retry.
        setStreamed('');
        setError(userMessage(err, "Couldn't generate an answer. Try again."));
        setPhase('error');
      });
  };

  if (!status.optIn) {
    return (
      <div className="rules-page">
        <RulesPageHeader />
        <DeckAiConsent
          title="Ask a rules question"
          blurb={`AI can answer Magic rules questions, grounded in the official Comprehensive Rules and the exact text of the cards involved — every answer cites the rules it relies on. Turning this on sends your question to Anthropic. Nothing is sent until you press Ask, ${status.limit} AI uses a day shared across AI features. You can turn it back off in Settings.`}
        />
      </div>
    );
  }

  return (
    <div className="rules-page">
      <RulesPageHeader />

      <form
        className="rules-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label className="sr-only" htmlFor="rules-question">
          Your rules question
        </label>
        <textarea
          id="rules-question"
          ref={inputRef}
          className="rules-ask-input"
          rows={2}
          maxLength={500}
          placeholder="Ask a rules question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
        />
        <div className="rules-ask-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!question.trim() || phase === 'asking' || remaining === 0}
          >
            Ask
          </button>
          <span className="rules-ask-remaining">
            {remaining === 0
              ? 'Daily limit reached — resets at midnight UTC.'
              : `${remaining} of ${status.limit} left today`}
          </span>
        </div>
      </form>

      {/* Starters, only while there's nothing else on the page to read. */}
      {phase === 'idle' && !answer && history !== null && (
        <div className="rules-samples" aria-label="Example questions">
          {SAMPLE_QUESTIONS.map((sample) => (
            <button
              key={sample}
              type="button"
              className="rules-sample"
              onClick={() => {
                setQuestion(sample);
                inputRef.current?.focus();
              }}
            >
              {sample}
            </button>
          ))}
        </div>
      )}

      {/* First visit: a beat while past questions are checked, so the samples
          never flash in front of an answer about to restore. */}
      {phase === 'idle' && !answer && history === null && (
        <div
          className="deck-ai-skeleton"
          role="status"
          aria-live="polite"
          aria-label="Checking for past questions"
        >
          <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
        </div>
      )}

      {phase === 'asking' && !streamed && (
        <div
          className="deck-ai-skeleton"
          role="status"
          aria-live="polite"
          aria-label="Writing the answer"
        >
          <span className="deck-ai-skeleton-line" />
          <span className="deck-ai-skeleton-line" />
          <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
        </div>
      )}

      {phase === 'error' && error && (
        <div className="deck-ai-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={() => ask(lastAsked)}>
            Try again
          </button>
        </div>
      )}

      {(answer || streamed) && (
        <article className="rules-answer" aria-live="polite">
          <h2 className="rules-answer-question">{answer ? answer.question : lastAsked}</h2>
          {answer?.askedAt != null && (
            <p className="rules-answer-when">
              Asked {formatRelativeTime(answer.askedAt, { verbose: true })}
            </p>
          )}
          {!answer && (
            <span className="sr-only" role="status">
              Writing the answer…
            </span>
          )}
          <AnswerBody
            content={answer ? answer.content : streamed}
            rules={answer?.rules ?? []}
            fetched={answer?.fetched}
            streaming={!answer}
          />
        </article>
      )}

      {/* Past questions, newest first — reopening one is a local swap. */}
      {history !== null && history.length > 1 && phase !== 'asking' && (
        <nav className="rules-history" aria-label="Past questions">
          <span className="rules-history-label">Past questions</span>
          {history.map((entry) => {
            const active = answer !== null && answer.content === entry.content;
            return (
              <button
                key={entry.id}
                type="button"
                className="rules-history-item"
                aria-current={active || undefined}
                onClick={() => {
                  if (active) return;
                  setAnswer({
                    question: entry.question,
                    content: entry.content,
                    rules: entry.rules,
                    fetched: entry.fetched,
                    askedAt: entry.createdAt,
                  });
                  setError(null);
                  setPhase('idle');
                }}
              >
                {entry.question}
              </button>
            );
          })}
        </nav>
      )}

      <p className="rules-disclaimer">
        Answers cite the official Comprehensive Rules
        {effectiveDate ? ` (effective ${effectiveDate})` : ''}. AI can misread corner cases — for
        tournament play, ask a judge.
      </p>
    </div>
  );
}

function RulesPageHeader() {
  return (
    <header className="rules-page-header">
      <h1 className="rules-page-heading">
        Rules Q&amp;A
        <AiMarker label="AI-written" />
      </h1>
      <p className="rules-page-sub">
        Ask how an interaction works. Answers are grounded in the Comprehensive Rules and the exact
        text of the cards involved, and cite the rules they rely on.
      </p>
    </header>
  );
}

/**
 * The answer prose plus its citations.
 *
 * While streaming, paragraphs render plain with a caret — structure that
 * depends on the whole answer (rule-citation buttons, card chips) waits for
 * `{done}`, per the STYLE_GUIDE streaming ruling. Settled, every verified rule
 * number becomes a button that expands the official text in the "Rules cited"
 * list below, and card names open the shared card carousel.
 */
function AnswerBody({
  content,
  rules,
  fetched,
  streaming,
}: {
  content: string;
  rules: CitedRule[];
  fetched?: string[];
  streaming: boolean;
}) {
  const carousel = useCardCarousel('Cards in the answer');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const prose = useMemo(() => stripEmphasis(content), [content]);
  const paragraphs = useMemo(
    () =>
      prose
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    [prose]
  );
  const verifiedRefs = useMemo(() => rules.map((r) => r.ref), [rules]);
  const cardNames = useMemo(() => fetched ?? [], [fetched]);
  const entries = useMemo<CarouselEntry[]>(
    () => cardNames.map((name) => ({ name, label: 'Named in the answer' })),
    [cardNames]
  );

  const toggleRef = (ref: string, reveal = false) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ref) && !reveal) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const citeId = (ref: string) => `rules-cite-${ref}`;

  /** One paragraph's runs: rule citations first, card chips inside the rest. */
  const renderRuns = (text: string) =>
    tokenizeRuleRefs(text, verifiedRefs).flatMap((run, i) => {
      if (run.ref) {
        const ref = run.ref;
        return [
          <button
            key={`r-${i}`}
            type="button"
            className="rules-ref-chip"
            aria-expanded={expanded.has(ref)}
            aria-controls={citeId(ref)}
            onClick={() => {
              toggleRef(ref, true);
              document.getElementById(citeId(ref))?.scrollIntoView({ block: 'nearest' });
            }}
          >
            {run.text}
          </button>,
        ];
      }
      return tokenizeCardNames(run.text, cardNames).map((t, j) =>
        t.card ? (
          <button
            key={`c-${i}-${j}`}
            type="button"
            className="deck-ai-card-chip"
            onClick={() => void carousel.open(entries, t.card!)}
            aria-label={`Preview ${t.card}`}
          >
            {t.text}
          </button>
        ) : (
          <span key={`t-${i}-${j}`}>{t.text}</span>
        )
      );
    });

  return (
    <>
      <div
        className={`rules-answer-prose${streaming ? ' rules-answer-prose--streaming' : ''}`}
        aria-busy={streaming || undefined}
      >
        {paragraphs.map((para, i) => (
          <p key={i}>{streaming ? para : renderRuns(para)}</p>
        ))}
      </div>

      {!streaming && rules.length > 0 && (
        <section className="rules-cited" aria-label="Rules cited">
          <h3 className="rules-cited-title">Rules cited</h3>
          <ul className="rules-cited-list" role="list">
            {rules.map((rule) => {
              const open = expanded.has(rule.ref);
              return (
                <li key={rule.ref} id={citeId(rule.ref)} className="rules-cite">
                  <button
                    type="button"
                    className="rules-cite-toggle"
                    aria-expanded={open}
                    onClick={() => toggleRef(rule.ref)}
                  >
                    <span className="rules-cite-ref">{rule.ref}</span>
                    <span className={`rules-cite-text${open ? '' : ' rules-cite-text--clamped'}`}>
                      {rule.text}
                    </span>
                    <ChevronDown
                      className={`rules-cite-chevron${open ? ' rules-cite-chevron--open' : ''}`}
                      width={16}
                      height={16}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {carousel.preview}
    </>
  );
}
