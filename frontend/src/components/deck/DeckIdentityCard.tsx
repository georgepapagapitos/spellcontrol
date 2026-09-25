import { useState, useEffect, useMemo, lazy, Suspense, type JSX } from 'react';
import { ArrowRight } from 'lucide-react';
import './DeckIdentityCard.css';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  bandFor,
  headlineFor,
  type SubScoreKey,
  type PlanScore,
} from '@/deck-builder/services/deckBuilder/planScore';
import { buildCommanderKey } from '@/lib/commander-key';
import { getCommanderStats } from '@/lib/aggregates-client';
import { CommanderPopularityStat } from './CommanderPopularityStat';
import type {
  CheckStatus,
  ValidationResult,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { LaneId } from '@/lib/deck-change';
import { InfoTip } from '@/components/InfoTip';
import { SelectMenu, type SelectOption } from '@/components/SelectMenu';
import { MeterBar } from '@/components/shared/MeterBar';
import type { Archetype } from '@/deck-builder/types';
import { ARCHETYPE_LABEL } from '@/deck-builder/services/deckBuilder/strategyVocabulary';
import {
  engineSentence,
  type DeckIdentity,
} from '@/deck-builder/services/deckBuilder/deckIdentity';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

// The radar is its own chunk; the band mounts it straight away (it is the
// section's lead visual, no longer behind an expander) and holds its height
// while the chunk loads so nothing below it jumps.
const PlaystyleRadar = lazy(() =>
  import('./PlaystyleRadar').then((m) => ({ default: m.PlaystyleRadar }))
);

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeckIdentityCardProps {
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  format: string;
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
   * retryable notice in that block instead of silently showing nothing.
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
  /** Deep-link handler for a failing check → the Coach lane that fixes it. */
  onNavigate?: (lane: LaneId) => void;
  /**
   * The deck's cards (commander included) — the radar and the engine
   * sentence both read them, so their numbers match.
   */
  cards?: ScryfallCard[];
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Glyph per check status — never color alone (§ Glyph literacy). */
const STATUS_GLYPH: Record<CheckStatus, string> = { pass: '✓', warn: '▾', fail: '✗' };

/** Build-health rows, in reading order. */
const SUBSCORES: Array<{ key: SubScoreKey; label: string }> = [
  { key: 'strategy', label: 'Strategy' },
  { key: 'roles', label: 'Roles' },
  { key: 'curve', label: 'Curve' },
  { key: 'cardFit', label: 'Card fit' },
];

/** The score a sub-score has to clear to read "Dialed in" (`bandFor`). */
const DIALED_IN_LINE = 70;

/**
 * A failing or warning check → the Coach lane that can fix it. Hard-rule ids
 * (size / identity / singleton / legality) are absent: those need card edits
 * in the list, not suggestions.
 */
const CHECK_TO_LANE: Record<string, LaneId> = {
  ramp: 'fill-gaps',
  removal: 'fill-gaps',
  cardDraw: 'fill-gaps',
  boardwipe: 'fill-gaps',
  curve: 'fill-gaps',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** The weakest scored sub-score, when it falls short of the Dialed in line. */
function softSpot(plan: PlanScore): { key: SubScoreKey; label: string } | null {
  let weakest: { key: SubScoreKey; label: string; value: number } | null = null;
  for (const { key, label } of SUBSCORES) {
    const sub = plan.subscores[key];
    if (!sub || sub.partial) continue;
    if (!weakest || sub.value < weakest.value) weakest = { key, label, value: sub.value };
  }
  return weakest && weakest.value < DIALED_IN_LINE ? weakest : null;
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * The glance band that leads the deck stats: what the deck plays as (the
 * playstyle radar beside the archetype, with one sentence on its engine),
 * then the working behind the two verdicts: every deck check with its
 * number, and build health as four scored meters. The verdict WORDS live
 * elsewhere (the strip's "All clear", the hero's bracket); this band shows
 * why, so it repeats neither (§ Deck view: one fact, one place).
 */
export function DeckIdentityCard({
  commander,
  partnerCommander,
  format,
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
  // Absent while analysis is pending (or never computed) reads as 0, which
  // with the loading gate below never renders a premature/wrong number.
  const edhrecNumDecks = edhrecNumDecksProp ?? 0;

  const lead = useMemo(() => {
    const spells = cards.filter((c) => !getFrontFaceTypeLine(c).toLowerCase().includes('land'));
    return engineSentence(analyzeDeckSynergy(cards), spells.length);
  }, [cards]);

  // Human format label ("Commander"), falling back to the raw id for unknown formats.
  const formatLabel =
    (DECK_FORMAT_CONFIGS as Partial<Record<string, { label: string }>>)[format]?.label ?? format;

  // Archetype picker: "Auto" plus the full archetype vocabulary, alphabetized.
  // The headline states the archetype; the closed trigger says whose call it
  // is, so it reads as an edit chip rather than a second copy of the name.
  const triggerLabel = archetypeOverride ? 'Your pick' : 'Auto';
  const archetypeOptions: SelectOption<string>[] = [
    { value: '', label: 'Auto', triggerLabel },
    ...Object.entries(ARCHETYPE_LABEL)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label, triggerLabel })),
  ];

  const spot = planScore ? softSpot(planScore) : null;
  // Build health has something to say only while it loads, when it failed,
  // or once there is a score. A deck that never gets one (any non-Commander
  // format) shows no block at all rather than a heading over nothing.
  const showHealth = analysisState !== 'ready' || edhrecMissing || planScore !== null;

  return (
    <section className="deck-identity-card" aria-label="Deck identity">
      <div className="deck-identity-card-glance">
        {/* ── What it plays as ── */}
        <div className="deck-identity-card-plays">
          <span className="deck-identity-card-eyebrow">Plays as</span>
          <div className="deck-identity-card-archetype-row">
            <h4 className="deck-identity-card-archetype">
              {identity ? identity.archetypeLabel : `${formatLabel} deck`}
            </h4>
            {identity && <span className="deck-identity-card-pacing">{identity.pacingShort}</span>}
            {identity && onSetArchetypeOverride && (
              <SelectMenu
                ariaLabel="Change deck archetype"
                className="deck-identity-card-archetype-menu"
                value={archetypeOverride ?? ''}
                options={archetypeOptions}
                onChange={(v) => onSetArchetypeOverride(v === '' ? null : (v as Archetype))}
              />
            )}
          </div>
          {lead && <p className="deck-identity-card-lead">{lead}</p>}
          <CommanderPopularityStat
            edhrecNumDecks={edhrecNumDecks}
            ownCount={effectiveOwnCount}
            loading={analysisState !== 'ready' || effectiveStatsLoading}
            variant="card"
          />
        </div>

        {/* ── The radar: the section's lead visual ── */}
        <div className="deck-identity-card-radar">
          <Suspense fallback={<div className="deck-identity-card-radar-loading" />}>
            <PlaystyleRadar cards={cards} />
          </Suspense>
        </div>

        {/* ── The working behind the verdicts ── */}
        <div className="deck-identity-card-verdicts">
          <div className="deck-identity-card-block">
            <div className="deck-identity-card-block-head">
              <span className="deck-identity-card-eyebrow">Deck checks</span>
              <span className="deck-identity-card-aside">
                {validation.passCount} of {validation.total} pass
              </span>
            </div>
            <ul className="deck-identity-card-checks" aria-label="Deck checks">
              {validation.checks.map((check) => {
                const lane = check.status !== 'pass' ? CHECK_TO_LANE[check.id] : undefined;
                return (
                  <li key={check.id} className={`deck-identity-card-check is-${check.status}`}>
                    <span className="deck-identity-card-check-glyph" aria-hidden="true">
                      {STATUS_GLYPH[check.status]}
                    </span>
                    <span className="deck-identity-card-check-label">{check.label}</span>
                    <span className="deck-identity-card-check-detail">{check.detail}</span>
                    {lane && onNavigate && (
                      <button
                        type="button"
                        className="deck-identity-card-check-fix"
                        onClick={() => onNavigate(lane)}
                        aria-label={`${check.label} ${check.detail}, fix in Coach`}
                      >
                        Fix in Coach
                        <ArrowRight aria-hidden={true} width={12} height={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── Build health ──
              While the first analysis is still running (or has failed) there is
              no planScore yet, so those states come before the planScore
              branch below. E162: 'error' renders a failure message + retry
              instead of an endless skeleton. */}
          {showHealth && (
            <div className="deck-identity-card-block">
              <div className="deck-identity-card-block-head">
                <span className="deck-identity-card-eyebrow">Build health</span>
                {planScore && analysisState === 'ready' && (
                  <span className="deck-identity-card-aside">
                    {bandFor(planScore.overall)}
                    {planScore.limitedData && ' · limited data'}
                    <InfoTip
                      label="build health"
                      text={`Each part of the build is scored out of 100. The mark is ${DIALED_IN_LINE}, the line for Dialed in.`}
                    />
                  </span>
                )}
              </div>
              {analysisState === 'pending' ? (
                <>
                  <div
                    className="deck-analysis-skeleton-bar deck-identity-card-skeleton"
                    aria-label="Build health loading…"
                  />
                  <p className="deck-identity-card-foot">Analyzing this deck…</p>
                </>
              ) : analysisState === 'error' ? (
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
              ) : edhrecMissing && !planScore ? (
                // A partial (EDHREC-missing) analysis: `analysisState` is 'ready'
                // (a real bracket exists), but Build health is EDHREC-derived, so
                // planScore never got computed.
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
              ) : planScore ? (
                <>
                  <ul className="deck-identity-card-health" aria-label="Build health scores">
                    {SUBSCORES.map(({ key, label }) => {
                      const sub = planScore.subscores[key];
                      if (!sub) return null;
                      const soft = !sub.partial && sub.value < DIALED_IN_LINE;
                      return (
                        <li
                          key={key}
                          className={`deck-identity-card-health-row${soft ? ' is-soft' : ''}`}
                        >
                          <span className="deck-identity-card-health-label">{label}</span>
                          <MeterBar
                            className="deck-identity-card-health-meter"
                            value={sub.partial ? 0 : sub.value}
                            tick={DIALED_IN_LINE}
                            color={soft ? 'var(--warn-text)' : undefined}
                          />
                          <span className="deck-identity-card-health-value">
                            {sub.partial ? 'not scored' : sub.value}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Rebuilt from the stored score, not the stored headline, so
                    a deck analyzed before the bands and headline were aligned
                    still reads right (planScore.ts headlineFor). */}
                  <p className="deck-identity-card-foot">
                    {headlineFor(planScore.overall)}
                    {spot && (
                      <>
                        {' '}
                        The soft spot is{' '}
                        <strong className="deck-identity-card-soft">
                          {spot.label.toLowerCase()}
                        </strong>
                        .
                      </>
                    )}
                  </p>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
