import { useState, useEffect, lazy, Suspense, type JSX } from 'react';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import './DeckIdentityCard.css';
import type { ScryfallCard } from '@/deck-builder/types';
import type { SubScoreKey, PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import { buildCommanderKey } from '@/lib/commander-key';
import { getCommanderStats } from '@/lib/aggregates-client';
import { CommanderPopularityStat } from './CommanderPopularityStat';
import {
  summarizeValidation,
  type ValidationResult,
  type ValidationTone,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { LaneId } from '@/lib/deck-change';
import { InfoTip } from '@/components/InfoTip';
import { SelectMenu, type SelectOption } from '@/components/SelectMenu';
import type { Archetype } from '@/deck-builder/types';
import { ARCHETYPE_LABEL } from '@/deck-builder/services/deckBuilder/strategyVocabulary';
import type { DeckIdentity } from '@/deck-builder/services/deckBuilder/deckIdentity';
import { buildIdentityLine } from '@/lib/deck-identity-line';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

// ── Lazy-loaded PlaystyleRadar (only imported when the expander is first opened) ──
const PlaystyleRadar = lazy(() =>
  import('./PlaystyleRadar').then((m) => ({ default: m.PlaystyleRadar }))
);

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeckIdentityCardProps {
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  format: string;
  /** The effective bracket (1-5) from effectiveBracket(deck). */
  bracket?: number;
  /**
   * 'pending' while !deck.gradeBracketSignature on commander decks (the first
   * analysis hasn't landed). 'error' (E162) means that first attempt failed
   * or stalled — renders a failure message + retry instead of skeletoning
   * forever. 'ready' is the default (non-commander decks, or any deck that's
   * ever had a successful analysis).
   */
  analysisState: 'pending' | 'ready' | 'error';
  /** E162: retries a failed/stalled first analysis. Passed only when analysisState is 'error'. */
  onRetryAnalysis?: () => void;
  /**
   * The persisted analysis ran without EDHREC (unreachable / this commander
   * isn't indexed) — `analysisState` is 'ready' (a real bracket exists), but
   * `planScore` is absent because Build health is EDHREC-derived. Renders a
   * retryable notice in that pillar instead of silently showing nothing.
   */
  edhrecMissing?: boolean;
  validation: ValidationResult;
  planScore: PlanScore | null;
  /**
   * EDHREC's own sample size for this commander (its `numDecks`) — already
   * fetched by the analysis hook for other purposes (planScore's byline);
   * threaded here rather than re-fetched. Feeds CommanderPopularityStat.
   * `null`/`undefined` reads as "unknown" (not "0 decks"), same as `0`.
   */
  edhrecNumDecks?: number | null;
  /** The live-computed deck identity from deriveDeckIdentity(). null for non-commander decks. */
  identity: DeckIdentity | null;
  /** User-pinned archetype; null/absent = auto. Already folded into `identity` upstream. */
  archetypeOverride?: Archetype | null;
  /** Set/clear the manual archetype override. When absent the label is read-only. */
  onSetArchetypeOverride?: (archetype: Archetype | null) => void;
  /** Deep-link handler for shortfall buttons → Tune lane. */
  onNavigate?: (lane: LaneId) => void;
  /**
   * The deck's cards — used to power the playstyle radar.
   * Thread from DeckAnalysisView's `allCards` prop (includes commander).
   */
  cards?: ScryfallCard[];
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Verdict glyph per tone — mirrors the checklist's status glyphs (pass/warn/fail). */
const TONE_GLYPH: Record<ValidationTone, string> = { success: '✓', warn: '▾', err: '✗' };

/** Friendly, title-cased labels for the plan sub-score keys (for the soft-spot line). */
const SUBSCORE_LABEL: Record<SubScoreKey, string> = {
  strategy: 'Strategy',
  roles: 'Roles',
  curve: 'Curve',
  cardFit: 'Card fit',
};

/** Up to this many shortfalls are named inline before collapsing to "+k more". */
const MAX_SHORTFALLS = 3;

/**
 * Map a failing/warning validation check id to the Tune lane that can fix it.
 * Hard-rule ids (size / identity / singleton) are excluded — those require card
 * edits in the Deck view, not the Tune suggestions lane.
 */
const CHECK_TO_LANE: Record<string, LaneId> = {
  ramp: 'fill-gaps',
  removal: 'fill-gaps',
  cardDraw: 'fill-gaps',
  boardwipe: 'fill-gaps',
  curve: 'fill-gaps',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Pick the weakest plan sub-score — the min `value` over the non-partial entries.
 * Returns null when every sub-score is partial (nothing comparable to call out).
 */
function weakestSubscore(plan: PlanScore): { key: SubScoreKey; bandLabel: string } | null {
  let weakest: { key: SubScoreKey; value: number; bandLabel: string } | null = null;
  for (const key of Object.keys(plan.subscores) as SubScoreKey[]) {
    const sub = plan.subscores[key];
    if (sub.partial) continue;
    if (weakest === null || sub.value < weakest.value) {
      weakest = { key, value: sub.value, bandLabel: sub.bandLabel };
    }
  }
  return weakest ? { key: weakest.key, bandLabel: weakest.bandLabel } : null;
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * The deck identity card at the top of the deck stats.
 *
 * The identity line (archetype, bracket, checks), commander popularity,
 * playstyle, and the two pillars: functional verdict and build health. It
 * leads the stats under the deck list; the page hero above already carries
 * the commander art, deck name and format, so the card repeats none of them.
 * Bracket and build health show skeleton shimmer during analysis.
 */
export function DeckIdentityCard({
  commander,
  partnerCommander,
  format,
  bracket,
  analysisState,
  onRetryAnalysis,
  edhrecMissing = false,
  validation,
  planScore,
  edhrecNumDecks: edhrecNumDecksProp,
  identity,
  archetypeOverride,
  onSetArchetypeOverride,
  onNavigate,
  cards = [],
}: DeckIdentityCardProps): JSX.Element {
  // Playstyle expander: collapsed by default; lazy-mounts PlaystyleRadar on first expand
  const [playstyleOpen, setPlaystyleOpen] = useState(false);
  // Track whether it has ever been opened — once true, the Suspense boundary stays mounted
  const [playstyleEverOpened, setPlaystyleEverOpened] = useState(false);

  // Commander-popularity stat (social W4): SpellControl's own threshold-gated
  // platform count, blended with EDHREC's numDecks (threaded in via the
  // edhrecNumDecks prop — see below — rather than re-fetched here). Skipped
  // entirely for a no-commander deck or PDH (no EDHREC data there either).
  const commanderKey =
    commander && format !== 'paupercommander'
      ? buildCommanderKey(commander.oracle_id, partnerCommander?.oracle_id)
      : null;
  // Result keyed by the commanderKey it was resolved for — comparing keys at
  // render time (below) derives both "loading" and "stale from a since-changed
  // commander" for free, with no separate loading flag and no synchronous
  // setState anywhere in the effect body (react-hooks/set-state-in-effect):
  // the only setState call happens after the `await`, in the async continuation.
  const [resolved, setResolved] = useState<{ key: string; ownCount: number | null } | null>(null);
  useEffect(() => {
    if (!commanderKey) return;
    let cancelled = false;
    void (async () => {
      const stats = await getCommanderStats(commanderKey);
      if (cancelled) return;
      setResolved({ key: commanderKey, ownCount: stats?.deckCount ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [commanderKey]);
  const effectiveOwnCount =
    commanderKey && resolved?.key === commanderKey ? resolved.ownCount : null;
  const effectiveStatsLoading = !!commanderKey && resolved?.key !== commanderKey;
  // edhrecNumDecks is threaded from the parent (DeckDisplay → DeckAnalysisView),
  // sourced from the SAME analysis-hook fetch that already computes planScore
  // — never re-fetched here. Absent while analysis is pending (or never
  // computed) reads as 0, which combined with the loading gate below never
  // renders a premature/wrong number.
  const edhrecNumDecks = edhrecNumDecksProp ?? 0;

  const togglePlaystyle = () => {
    if (!playstyleOpen && !playstyleEverOpened) {
      setPlaystyleEverOpened(true);
    }
    setPlaystyleOpen((open) => !open);
  };
  const verdict = summarizeValidation(validation);

  const shortfallChecks = validation.checks.filter(
    (c) => c.status === 'warn' || c.status === 'fail'
  );
  const namedChecks = shortfallChecks.slice(0, MAX_SHORTFALLS);
  const extraShortfalls = shortfallChecks.length - namedChecks.length;

  const softSpot = planScore ? weakestSubscore(planScore) : null;

  // Human format label ("Commander"), falling back to the raw id for unknown formats.
  const formatLabel =
    (DECK_FORMAT_CONFIGS as Partial<Record<string, { label: string }>>)[format]?.label ?? format;

  // Identity line segments
  const identitySegments = buildIdentityLine({
    identity,
    formatLabel,
    bracket: analysisState === 'ready' ? bracket : undefined,
    validation,
  });

  // Archetype override picker — "Auto" plus the full archetype vocabulary,
  // alphabetized. Every option shares the identity line's own text as its
  // trigger label, so the closed control reads exactly like the plain segment
  // it replaces (the effective archetype always matches `identity`, which has
  // the override folded in upstream).
  const archetypeSegText = identitySegments[0]?.text ?? '';
  const archetypeOptions: SelectOption<string>[] = [
    { value: '', label: 'Auto', triggerLabel: archetypeSegText },
    ...Object.entries(ARCHETYPE_LABEL)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label, triggerLabel: archetypeSegText })),
  ];

  return (
    <section className="deck-identity-card" aria-label="Deck identity">
      {/* ── Body ── */}
      <div className="deck-identity-card-body">
        {/* Identity line */}
        <div className="deck-identity-card-identity-line">
          {identitySegments.map((seg, i) => (
            <span key={seg.kind} className="deck-identity-card-identity-seg-wrap">
              {i > 0 && (
                <span className="deck-identity-card-identity-sep" aria-hidden="true">
                  ·
                </span>
              )}{' '}
              {seg.kind === 'bracket' ? (
                <span className="deck-identity-card-identity-bracket">
                  {seg.text}
                  {seg.tipText && <InfoTip label={`Bracket ${bracket}`} text={seg.tipText} />}
                </span>
              ) : seg.kind === 'validation' ? (
                <span className={`deck-identity-card-identity-val is-${seg.tone}`}>{seg.text}</span>
              ) : identity && onSetArchetypeOverride ? (
                <SelectMenu
                  ariaLabel="Change deck archetype"
                  className="deck-identity-card-archetype-menu"
                  value={archetypeOverride ?? ''}
                  options={archetypeOptions}
                  onChange={(v) => onSetArchetypeOverride(v === '' ? null : (v as Archetype))}
                />
              ) : (
                <span>{seg.text}</span>
              )}
            </span>
          ))}
        </div>

        {/* Commander popularity — new stat line (net-new, not beside an
            existing EDHREC number: DeckIdentityCard shows none today). */}
        <CommanderPopularityStat
          edhrecNumDecks={edhrecNumDecks}
          ownCount={effectiveOwnCount}
          loading={analysisState !== 'ready' || effectiveStatsLoading}
          variant="card"
        />

        {/* ── Playstyle expander ── */}
        <div className="deck-identity-card-playstyle">
          <button
            type="button"
            className="deck-identity-card-playstyle-toggle"
            aria-expanded={playstyleOpen}
            aria-controls="deck-identity-playstyle-body"
            onClick={togglePlaystyle}
          >
            <span className="deck-identity-card-playstyle-title">Playstyle</span>
            <span className="deck-identity-card-playstyle-chevron" aria-hidden="true">
              {playstyleOpen ? (
                <ChevronUp width={14} height={14} />
              ) : (
                <ChevronDown width={14} height={14} />
              )}
            </span>
          </button>
          <div
            id="deck-identity-playstyle-body"
            className="deck-identity-card-playstyle-body"
            hidden={!playstyleOpen}
            aria-hidden={!playstyleOpen}
          >
            {/* Lazy-mount: only render after first expand */}
            {playstyleEverOpened && (
              <Suspense fallback={<div className="deck-identity-card-playstyle-loading" />}>
                <PlaystyleRadar cards={cards} />
              </Suspense>
            )}
          </div>
        </div>

        {/* Pillars */}
        <div
          className={`deck-identity-card-pillars${planScore || analysisState !== 'ready' ? '' : ' is-solo'}`}
        >
          {/* ── Functional verdict ── */}
          <div className="deck-identity-card-pillar">
            <span className="deck-identity-card-eyebrow">Functional</span>
            <p className={`deck-identity-card-verdict is-${verdict.tone}`}>
              <span className="deck-identity-card-verdict-glyph" aria-hidden="true">
                {TONE_GLYPH[verdict.tone]}
              </span>
              <strong className="deck-identity-card-verdict-label">{verdict.label}</strong>
            </p>
            <p className="deck-identity-card-ratio">
              {validation.passCount} of {validation.total} checks pass
            </p>
            {namedChecks.length > 0 && (
              <ul className="deck-identity-card-shortfall-list" aria-label="Issues to address">
                {namedChecks.map((check) => {
                  const lane = CHECK_TO_LANE[check.id];
                  const label = `${check.label} ${check.detail}`;
                  return (
                    <li key={check.id} className="deck-identity-card-shortfall-item">
                      {onNavigate && lane ? (
                        <button
                          type="button"
                          className="deck-identity-card-shortfall-btn"
                          onClick={() => onNavigate(lane)}
                          aria-label={`${label}, go to Tune`}
                        >
                          <span className="deck-identity-card-shortfall-text">{label}</span>
                          <ArrowRight
                            className="deck-identity-card-shortfall-arrow"
                            aria-hidden={true}
                            width={12}
                            height={12}
                          />
                        </button>
                      ) : (
                        <span className="deck-identity-card-shortfall-text">{label}</span>
                      )}
                    </li>
                  );
                })}
                {extraShortfalls > 0 && (
                  <li className="deck-identity-card-shortfall-item deck-identity-card-shortfall-more">
                    +{extraShortfalls} more
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* ── Build health ──
              While the first analysis is still running (or has failed) there is
              no planScore yet, so those checks must come before the planScore
              branch below (pending/error ⇒ planScore is absent). E162: 'error'
              renders a failure message + retry instead of an endless skeleton. */}
          {analysisState === 'pending' ? (
            <div className="deck-identity-card-pillar">
              <span className="deck-identity-card-eyebrow">Build health</span>
              <div
                className="deck-analysis-skeleton-bar deck-identity-card-skeleton-pillar"
                aria-label="Build health loading…"
              />
              <p className="deck-identity-card-headline">Analyzing this deck…</p>
            </div>
          ) : analysisState === 'error' ? (
            <div className="deck-identity-card-pillar">
              <span className="deck-identity-card-eyebrow">Build health</span>
              <p className="deck-identity-card-error-text">
                Couldn't analyze this deck.
                {onRetryAnalysis && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="deck-identity-card-retry-btn"
                      onClick={onRetryAnalysis}
                    >
                      Retry
                    </button>
                  </>
                )}
              </p>
            </div>
          ) : edhrecMissing && !planScore ? (
            // A partial (EDHREC-missing) analysis: `analysisState` is 'ready'
            // (a real bracket exists), but Build health is EDHREC-derived, so
            // planScore never got computed. Same failure-message shape as the
            // 'error' branch above, reworded — this isn't a failed analysis,
            // just one EDHREC couldn't finish.
            <div className="deck-identity-card-pillar">
              <span className="deck-identity-card-eyebrow">Build health</span>
              <p className="deck-identity-card-error-text">
                Couldn't reach EDHREC for build health.
                {onRetryAnalysis && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="deck-identity-card-retry-btn"
                      onClick={onRetryAnalysis}
                    >
                      Retry
                    </button>
                  </>
                )}
              </p>
            </div>
          ) : (
            planScore && (
              <div className="deck-identity-card-pillar">
                <span className="deck-identity-card-eyebrow">Build health</span>
                <p className="deck-identity-card-band">
                  <strong className="deck-identity-card-band-num">{planScore.bandLabel}</strong>
                  {planScore.limitedData && (
                    <span className="deck-identity-card-limited"> · limited data</span>
                  )}
                </p>
                <p className="deck-identity-card-headline">{planScore.headline}</p>
                {softSpot && (
                  <p className="deck-identity-card-softspot">
                    soft spot: {SUBSCORE_LABEL[softSpot.key]} · {softSpot.bandLabel}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Brand mark ── */}
      <div className="deck-identity-card-brand">
        <span className="deck-identity-card-brand-text">SpellControl</span>
      </div>
    </section>
  );
}
