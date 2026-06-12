import { useId, useState, lazy, Suspense, type JSX } from 'react';
import { useAnimatedNumber } from '@/lib/use-animated-number';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import './DeckIdentityCard.css';
import type { ScryfallCard } from '@/deck-builder/types';
import type { SubScoreKey, PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import {
  summarizeValidation,
  type ValidationResult,
  type ValidationTone,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { LaneId } from '@/lib/deck-change';
import { COLOR_INFO } from '../../lib/colors';
import { ColorPip } from '../shared/ManaSymbol';
import { useCardThumb } from '@/lib/card-thumbs';
import { InfoTip } from '@/components/InfoTip';
import { avgCmcBandWord } from './DeckCurvePhases';
import type { DeckIdentity } from '@/deck-builder/services/deckBuilder/deckIdentity';
import { buildIdentityLine } from '@/lib/deck-identity-line';
import type { Pacing } from '@/deck-builder/services/deckBuilder/pacingDetector';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

// ── Lazy-loaded PlaystyleRadar (only imported when the expander is first opened) ──
const PlaystyleRadar = lazy(() =>
  import('./PlaystyleRadar').then((m) => ({ default: m.PlaystyleRadar }))
);

// ── Types ──────────────────────────────────────────────────────────────────

export interface DeckIdentityCardProps {
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  deckName: string;
  format: string;
  deckColor: string; // deck.color hex for no-commander banner
  /** The effective bracket (1-5) from effectiveBracket(deck). */
  bracket?: number;
  /** Analysis pending = true when !deck.gradeBracketSignature on commander decks. */
  analysisPending: boolean;
  /**
   * Session-scoped reveal key. When provided, plays a 0→target reveal tween
   * the first time this key is seen. Pass null/undefined to skip the reveal.
   */
  revealKey?: string | null;
  validation: ValidationResult;
  planScore: PlanScore | null;
  /** manaCurve memo from DeckDisplay (Record<0..7, number>). */
  manaCurve: Record<number, number>;
  /** The live-computed deck identity from deriveDeckIdentity(). null for non-commander decks. */
  identity: DeckIdentity | null;
  /** Mana analysis average CMC - used for sparkline band word. */
  averageCmc: number;
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

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'];

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

/**
 * Map average CMC to a Pacing key for avgCmcBandWord.
 * lean < 2.8 → 'fast-tempo', balanced 2.8-3.5 → 'balanced', top-heavy > 3.5 → 'late-game'
 */
function avgCmcToPacing(avgCmc: number): Pacing {
  if (avgCmc < 2.8) return 'fast-tempo';
  if (avgCmc <= 3.5) return 'balanced';
  return 'late-game';
}

// ── Color identity arc SVG ─────────────────────────────────────────────────

function ColorIdentityArc({
  colorIdentity,
  artUrl,
}: {
  colorIdentity: string[];
  artUrl: string | undefined;
}): JSX.Element {
  const clipId = useId();
  const radius = 24;
  const stroke = 6;
  const circ = 2 * Math.PI * radius;

  // The colors to arc, filtered to what's in the identity
  const colors = colorIdentity.length > 0 ? colorIdentity : ['C'];
  const filtered = COLOR_ORDER.filter((k) => colors.includes(k));
  const arcColors = filtered.length > 0 ? filtered : ['C'];

  const segLen = circ / arcColors.length;

  const segments = arcColors.reduce<Array<{ k: string; len: number; offset: number }>>((acc, k) => {
    const offset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].len : 0;
    acc.push({ k, len: segLen, offset });
    return acc;
  }, []);

  const identityLabel =
    arcColors
      .filter((k) => k !== 'C')
      .map((k) => COLOR_INFO[k]?.label ?? k)
      .join(', ') || 'Colorless';

  return (
    <div className="deck-identity-card-arc-wrap">
      <svg
        viewBox="-32 -32 64 64"
        width={56}
        height={56}
        role="img"
        aria-label={`Color identity: ${identityLabel}`}
      >
        {/* Clip path for circular portrait */}
        <defs>
          <clipPath id={clipId}>
            <circle r={radius - stroke / 2 - 1} />
          </clipPath>
        </defs>
        {/* Background ring */}
        <circle r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {/* Color segments */}
        {segments.map(({ k, len, offset }) => (
          <circle
            key={k}
            r={radius}
            fill="none"
            stroke={COLOR_INFO[k]?.pip ?? 'var(--accent)'}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${circ - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90)"
          />
        ))}
        {/* Commander portrait in center */}
        {artUrl && (
          <image
            href={artUrl}
            x={-(radius - stroke / 2 - 1)}
            y={-(radius - stroke / 2 - 1)}
            width={(radius - stroke / 2 - 1) * 2}
            height={(radius - stroke / 2 - 1) * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          />
        )}
      </svg>
    </div>
  );
}

// ── Sparkline ──────────────────────────────────────────────────────────────

function CurveSparkline({
  manaCurve,
  averageCmc,
}: {
  manaCurve: Record<number, number>;
  averageCmc: number;
}): JSX.Element {
  const buckets = Array.from({ length: 8 }, (_, i) => manaCurve[i] ?? 0);
  const max = Math.max(...buckets, 1);
  const pacing = avgCmcToPacing(averageCmc);
  const bandWord = avgCmcBandWord(pacing);

  return (
    <div className="deck-identity-card-sparkline-wrap">
      <div className="deck-identity-card-sparkline" aria-hidden="true">
        {buckets.map((count, i) => {
          const heightPct = Math.round((count / max) * 100);
          return (
            <div
              key={i}
              className="deck-identity-card-spark-bar"
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>
      <span className="deck-identity-card-sparkline-label">{bandWord} curve</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * The deck identity hero card for the Stats tab.
 *
 * Replaces StatsHero with a richer visual layout: commander art band, color-identity
 * arc, sparkline curve summary, and the two-pillar functional verdict / build health.
 * All sync data (art, arc, name, sparkline) renders immediately; bracket and build
 * health show skeleton shimmer during analysis.
 */
export function DeckIdentityCard({
  commander,
  partnerCommander,
  deckName,
  format,
  deckColor,
  bracket,
  analysisPending,
  validation,
  planScore,
  manaCurve,
  identity,
  averageCmc,
  onNavigate,
  cards = [],
  revealKey,
}: DeckIdentityCardProps): JSX.Element {
  // Playstyle expander: collapsed by default; lazy-mounts PlaystyleRadar on first expand
  const [playstyleOpen, setPlaystyleOpen] = useState(false);
  // Track whether it has ever been opened — once true, the Suspense boundary stays mounted
  const [playstyleEverOpened, setPlaystyleEverOpened] = useState(false);

  // Animate the build health number only — everything else (bandLabel, headline,
  // softSpot) is text and stays static. Suppressed while analysis is pending since
  // planScore is absent then; the reveal fires once it arrives via revealKey.
  const planScoreOverall = planScore
    ? Math.max(0, Math.min(100, Math.round(planScore.overall)))
    : 0;
  const { display: planScoreDisplay } = useAnimatedNumber(planScoreOverall, {
    revealMs: 600,
    revealKey: revealKey ? `${revealKey}:build-health` : null,
  });

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

  // Commander art
  const commanderName = commander?.name;
  const artCrop =
    commander?.image_uris?.art_crop ?? commander?.card_faces?.[0]?.image_uris?.art_crop;
  // Fallback via CDN thumb when art_crop not directly available on the card object
  const cdnThumb = useCardThumb(artCrop ? undefined : commanderName, 'normal');
  const artUrl = artCrop ?? cdnThumb;

  // Color identity (union of commander + partner)
  const colorIdentity = [
    ...(commander?.color_identity ?? []),
    ...(partnerCommander?.color_identity ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  // Human format label ("Commander"), falling back to the raw id for unknown formats.
  const formatLabel =
    (DECK_FORMAT_CONFIGS as Partial<Record<string, { label: string }>>)[format]?.label ?? format;

  // Identity line segments
  const identitySegments = buildIdentityLine({
    identity,
    formatLabel,
    bracket: analysisPending ? undefined : bracket,
    validation,
  });

  return (
    <section className="deck-identity-card" aria-label="Deck identity">
      {/* ── Art band ── */}
      <div className="deck-identity-card-art-band">
        {commander ? (
          <>
            <div className="deck-identity-card-art-layer">
              {artUrl ? (
                <img className="deck-identity-card-art-img" src={artUrl} alt={commander.name} />
              ) : (
                <div
                  className="deck-identity-card-art-img"
                  style={{ background: deckColor }}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="deck-identity-card-art-fade" aria-hidden="true" />
          </>
        ) : (
          <div
            className="deck-identity-card-color-banner"
            style={{ background: deckColor }}
            aria-hidden="true"
          >
            {colorIdentity.length > 0 ? (
              colorIdentity
                .filter((k) => COLOR_ORDER.includes(k))
                .map((k) => <ColorPip key={k} color={k} />)
            ) : (
              <ColorPip color="C" />
            )}
          </div>
        )}
        <div className="deck-identity-card-art-content">
          {commander && <ColorIdentityArc colorIdentity={colorIdentity} artUrl={artUrl} />}
          <div className="deck-identity-card-title-row">
            {commander && (
              <span className="deck-identity-card-commander-name">
                {commander.name}
                {partnerCommander ? ` · ${partnerCommander.name}` : ''}
              </span>
            )}
            <h2 className="deck-identity-card-deck-name">{deckName}</h2>
            <span className="deck-identity-card-format">{formatLabel}</span>
          </div>
        </div>
      </div>

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
              ) : (
                <span>{seg.text}</span>
              )}
            </span>
          ))}
        </div>

        {/* Sparkline */}
        <CurveSparkline manaCurve={manaCurve} averageCmc={averageCmc} />

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
          className={`deck-identity-card-pillars${planScore || analysisPending ? '' : ' is-solo'}`}
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
                          aria-label={`${label} — go to Tune`}
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
              While the first analysis is still running there is no planScore yet,
              so the pending check must come first (pending ⇒ planScore is absent). */}
          {analysisPending ? (
            <div className="deck-identity-card-pillar">
              <span className="deck-identity-card-eyebrow">Build health</span>
              <div
                className="deck-analysis-skeleton-bar deck-identity-card-skeleton-pillar"
                aria-label="Build health loading…"
              />
            </div>
          ) : (
            planScore && (
              <div className="deck-identity-card-pillar">
                <span className="deck-identity-card-eyebrow">Build health</span>
                <p className="deck-identity-card-band">
                  <strong className="deck-identity-card-band-num">{planScoreDisplay}</strong> ·{' '}
                  {planScore.bandLabel}
                  {planScore.limitedData && (
                    <span className="deck-identity-card-limited"> · limited data</span>
                  )}
                </p>
                <p className="deck-identity-card-headline">{planScore.headline}</p>
                {softSpot && (
                  <p className="deck-identity-card-softspot">
                    soft spot: {SUBSCORE_LABEL[softSpot.key]} — {softSpot.bandLabel}
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
