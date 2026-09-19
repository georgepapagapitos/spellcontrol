import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ChevronDown, Sparkles } from 'lucide-react';
import { AiMarker, DeckAiConsent } from '../components/deck/DeckAiConsent';
import {
  isRulesReferenceTab,
  RulesReference,
  RulesReferenceFoot,
  useRulesBundle,
  type RulesReferenceTab,
} from '../components/RulesReference';
import { Tabs } from '../components/Tabs';
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

type PageTab = RulesReferenceTab | 'ask';

/**
 * `/rules` — the Rules hub, the linkable home of everything rules-shaped:
 *
 * - **Keywords / Glossary / Rules** — the offline Comprehensive Rules
 *   reference (the same lists the in-game Rules Reference sheet shows; the
 *   sheet stays the quick look for mid-game, this page is the place you can
 *   link, bookmark and search from the header, the palette, and You › Help).
 * - **Ask** — the AI rules Q&A (E261, "Ask a judge"), self-hiding like every
 *   AI surface: without AI the page is exactly the reference.
 *
 * The section and search live in the URL (`?tab=`, `?q=`) so a rule lookup
 * is a shareable address; the sheet's AI door lands on `?tab=ask` with the
 * search that came up short as location state (a seed, never auto-sent).
 */
export function RulesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const status = useAiStatus();
  const bundle = useRulesBundle();

  // Where the page opens: the tab you asked for; else Ask when the sheet's AI
  // door sent a question along; else Keywords.
  const requested = params.get('tab');
  const seededQuestion = !!(location.state as { question?: string } | null)?.question;
  const initialTab: PageTab =
    requested === 'ask'
      ? 'ask'
      : isRulesReferenceTab(requested)
        ? requested
        : seededQuestion
          ? 'ask'
          : 'keywords';
  const [tabRaw, setTabRaw] = useState<PageTab>(initialTab);
  const [query, setQueryRaw] = useState(() => params.get('q') ?? '');
  /** A row's "Ask AI about this": the question the Ask tab opens with. */
  const [askSeed, setAskSeed] = useState<string | null>(null);

  // Mirror both into the URL with `replace` — typing a search is one visit,
  // not a Back-button trail. `q` belongs to the reference only.
  const setTab = (t: PageTab) => {
    setTabRaw(t);
    setParams(
      (p) => {
        p.set('tab', t);
        if (t === 'ask') p.delete('q');
        return p;
      },
      { replace: true }
    );
  };
  const setQuery = (q: string) => {
    setQueryRaw(q);
    setParams(
      (p) => {
        if (q.trim()) p.set('q', q);
        else p.delete('q');
        return p;
      },
      { replace: true }
    );
  };

  // The Ask tab exists while AI might be available (undefined = still
  // checking, so the strip doesn't flicker); a null status hides it and drops
  // a requested `?tab=ask` onto the reference.
  const askAvailable = status !== null;
  const tab: PageTab = tabRaw === 'ask' && !askAvailable ? 'keywords' : tabRaw;

  const tabs = [
    { id: 'keywords' as const, label: 'Keywords', controls: 'rules-ref-panel' },
    { id: 'glossary' as const, label: 'Glossary', controls: 'rules-ref-panel' },
    { id: 'rules' as const, label: 'Rules', controls: 'rules-ref-panel' },
    ...(askAvailable
      ? [
          {
            id: 'ask' as const,
            label: 'Ask',
            icon: <Sparkles width={14} height={14} aria-hidden />,
            ariaLabel: 'Ask a rules question (AI)',
            controls: 'rules-ask-panel',
          },
        ]
      : []),
  ];

  return (
    <div className="rules-page">
      <header className="rules-page-header">
        <h1 className="rules-page-heading">Rules</h1>
        <p className="rules-page-sub">
          Look up a keyword, a glossary term, or a rule by number in the official Comprehensive
          Rules.
        </p>
      </header>

      <Tabs<PageTab>
        tabs={tabs}
        value={tab}
        onChange={(t) => {
          setAskSeed(null);
          setTab(t);
        }}
        ariaLabel="Rules sections"
        variant="underline"
        className="rules-page-tabs"
      />

      {tab === 'ask' ? (
        <div role="tabpanel" id="rules-ask-panel" aria-labelledby="sc-tab-ask">
          <RulesAsk seed={askSeed ?? undefined} />
        </div>
      ) : (
        <>
          <RulesReference
            bundle={bundle}
            tab={tab}
            query={query}
            onTabChange={setTab}
            onQueryChange={setQuery}
            showTabs={false}
            onAsk={
              askAvailable
                ? (q) => {
                    setAskSeed(q);
                    setTab('ask');
                  }
                : undefined
            }
          />
          <RulesReferenceFoot bundle={bundle} />
        </>
      )}
    </div>
  );
}

/**
 * The Ask tab — the AI rules Q&A (E261, "Ask a judge"). Ask a Magic rules
 * question; the answer is grounded in the Comprehensive Rules index and the
 * card database, streams in as it is written, and cites the exact rules it
 * relies on — each citation expandable to the official text below the answer.
 *
 * Every STYLE_GUIDE AI ruling applies: provenance pill on the title, nothing
 * sent until the Ask button, consent granted in place, streaming shows the
 * prose never the plumbing, past answers restore for free.
 */
function RulesAsk({ seed }: { seed?: string }) {
  const status = useAiStatus();
  const location = useLocation();
  // A row's "Ask AI about this" (`seed`) or the Rules Reference sheet's door
  // (the search that came up short, as location state) seeds the box — an
  // initializer (setState-in-effect is an ERROR here), and only a seed:
  // nothing is sent until Ask (never auto-spend).
  const [question, setQuestion] = useState(
    () => seed ?? (location.state as { question?: string } | null)?.question ?? ''
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

  // A row handed its question over: the box is the next thing to touch.
  useEffect(() => {
    if (seed) inputRef.current?.focus();
  }, [seed]);

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

  // Unavailable (null) never renders here — the page hides the Ask tab. Loading
  // (undefined) shows a skeleton line rather than flashing the ask box at
  // someone who may not be able to use it.
  if (!status) {
    return (
      <div className="rules-ask-section">
        <RulesAskHeader />
        {status === undefined && (
          <div
            className="deck-ai-skeleton"
            role="status"
            aria-live="polite"
            aria-label="Checking whether the rules Q&A is available"
          >
            <span className="deck-ai-skeleton-line deck-ai-skeleton-line--short" />
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
      <div className="rules-ask-section">
        <RulesAskHeader />
        <DeckAiConsent
          title="Ask a rules question"
          blurb={`AI answers Magic rules questions, grounded in the Comprehensive Rules and the cards involved, and cites its sources. Turning this on sends your question to Anthropic when you press Ask. You get ${status.limit} uses a day, shared across AI features, and can turn it off anytime in Settings.`}
        />
      </div>
    );
  }

  return (
    <div className="rules-ask-section">
      <RulesAskHeader />

      {/* The box and its starters — the side column on a wide screen. */}
      <div className="rules-ask-compose">
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
                ? 'Daily limit reached. Resets at midnight UTC.'
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
      </div>

      {/* The answer and its in-flight states — the main column on a wide
          screen; empty (and hidden) until something is asked. */}
      <div className="rules-ask-result">
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
      </div>

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
        {effectiveDate ? ` (effective ${effectiveDate})` : ''}. AI can misread corner cases, so ask
        a judge for tournament play.
      </p>
    </div>
  );
}

function RulesAskHeader() {
  return (
    <header className="rules-ask-header">
      <h2 className="rules-ask-heading">
        Ask a rules question
        <AiMarker label="AI-written" />
      </h2>
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
