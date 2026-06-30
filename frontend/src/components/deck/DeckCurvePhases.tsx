import { type JSX, useMemo, useState } from 'react';
import { COLOR_INFO } from '../../lib/colors';
import { useCardCarousel, tallyToEntries, type CardTally } from './useCardCarousel';
import { CardGroupSheet } from './CardGroupSheet';
import type { CurveColorBucket } from './deck-mana-types';
import { gradeCurve } from '@/deck-builder/services/deckBuilder/curveGrading';
import type { Pacing } from '@/deck-builder/services/deckBuilder/pacingDetector';
import { InfoTip } from '@/components/InfoTip';
import './DeckCurvePhases.css';

/**
 * Maps a pacing label to a compact avg-CMC band word for the curve summary.
 * Exported for unit testing.
 */
export function avgCmcBandWord(pacing: Pacing): 'lean' | 'balanced' | 'top-heavy' {
  switch (pacing) {
    case 'aggressive-early':
    case 'fast-tempo':
      return 'lean';
    case 'midrange':
    case 'balanced':
      return 'balanced';
    case 'late-game':
      return 'top-heavy';
  }
}

/**
 * The deck's mana curve, reimagined as a "color-stacked curve hero".
 *
 * Each mana-value bar (0..7+) is a vertical STACK of color segments — bar
 * height ∝ the number of nonland cards at that CMC, each segment ∝ that color
 * category's share. A toggle flips between "by color" (stacked, default) and
 * "count" (solid accent bars, the classic histogram). Below the bars, the
 * counts roll up into three play-phases — Early (CMC 0-2), Mid (3-4), Late
 * (5+) — each with a transparent A–F grade.
 *
 * `manaCurve` is keyed by CMC where the key 7 is the "7+" bucket; `curveByColor`
 * mirrors it with per-color counts.
 */

// CMC slots we render, in order. 7 is the catch-all "7+" bucket.
const CMC_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

// Human-readable labels for the legend + aria text (text present, never
// color-only, for a11y).
const SEGMENT_LABEL: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  gold: 'Multicolor',
  colorless: 'Colorless',
};

// gold/colorless have no theme token yet — tasteful literals (tune freely; see
// the sign-off notes). WUBRG colors come from COLOR_INFO[k].pip so the stacked
// segments exactly match the color donut in DeckColorPanel.
const GOLD_COLOR = '#c9a227'; // multicolor gold
const COLORLESS_COLOR = '#9aa0a6'; // colorless stone

/** Fill color for a segment / legend swatch. */
function segmentColor(k: string): string {
  if (k === 'gold') return GOLD_COLOR;
  if (k === 'colorless') return COLORLESS_COLOR;
  return COLOR_INFO[k]?.pip ?? 'var(--accent)';
}

// Bottom → top stacking order within each bar.
const SEGMENT_ORDER = ['W', 'U', 'B', 'R', 'G', 'gold', 'colorless'] as const;
type SegmentKey = (typeof SEGMENT_ORDER)[number];

type CurveMode = 'color' | 'count';

/** Category for a single card, matching the 0 / 1 / 2+ rule used upstream to
 *  build `curveByColor`. Reads `color_identity` off the carried Scryfall card;
 *  undefined (name-only tally) falls back to colorless. */
function categorize(tally: CardTally): SegmentKey {
  const ci = (tally.card?.color_identity ?? []).filter((c): c is SegmentKey =>
    (SEGMENT_ORDER as readonly string[]).includes(c)
  );
  if (ci.length === 0) return 'colorless';
  if (ci.length === 1) return ci[0];
  return 'gold';
}

export function DeckCurvePhases({
  manaCurve,
  curveByColor,
  averageCmc,
  cardsByCmc,
}: {
  manaCurve: Record<number, number>;
  /** Per-CMC color counts (7 = 7+). When present, the default "by color" mode
   *  renders stacked color segments; absent → count-only. */
  curveByColor?: Record<number, CurveColorBucket>;
  averageCmc: number;
  /** Per-CMC card lists (7 = 7+). When supplied, bars/segments become tappable
   *  → a carousel of the cards at that mana value (and color). */
  cardsByCmc?: Record<number, CardTally[]>;
}): JSX.Element {
  const carousel = useCardCarousel('Mana curve');
  const [mode, setMode] = useState<CurveMode>('color');
  // Tapping a bucket opens the grouped overview sheet (the high-level "see them
  // all" step) before the one-at-a-time carousel.
  const [groupSheet, setGroupSheet] = useState<{ title: string; tally: CardTally[] } | null>(null);

  // Open the grouped overview sheet for a set of cards (already a CardTally[]).
  const showTally = (tally: CardTally[], title: string) => {
    if (tally.length === 0) return;
    const sorted = [...tally].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    setGroupSheet({ title, tally: sorted });
  };

  // From the grouped sheet, hand a tapped card off to the detail carousel.
  const pickFromGroup = (picked: CardTally) => {
    if (!groupSheet) return;
    void carousel.open(tallyToEntries(groupSheet.tally), picked.name);
  };

  const hasColorData = useMemo(() => {
    if (!curveByColor) return false;
    return Object.values(curveByColor).some((bucket) =>
      SEGMENT_ORDER.some((k) => (bucket?.[k] ?? 0) > 0)
    );
  }, [curveByColor]);

  // Fall back to "count" if there's no per-color data to show.
  const effectiveMode: CurveMode = mode === 'color' && hasColorData ? 'color' : 'count';

  // Pacing-aware phase grades — the deck's own curve picks the target band.
  const grading = useMemo(() => gradeCurve(manaCurve), [manaCurve]);
  const phaseTotals = grading.phases;
  const total = grading.total;

  const { slots, maxCount } = useMemo(() => {
    const slots = CMC_SLOTS.map((cmc) => ({
      cmc,
      label: cmc === 7 ? '7+' : String(cmc),
      count: manaCurve[cmc] ?? 0,
    }));
    const maxCount = slots.reduce((m, s) => Math.max(m, s.count), 0);
    return { slots, maxCount };
  }, [manaCurve]);

  // Per-CMC target heights for the pacing-aware target-band overlay.
  // Maps each CMC slot to the average target count for its phase.
  const targetByCmc = useMemo<Record<number, number>>(() => {
    if (total === 0 || maxCount === 0) return {};
    return Object.fromEntries(
      phaseTotals.flatMap((phase) => {
        const avgTarget = (phase.target * total) / phase.cmcs.length;
        return phase.cmcs.map((cmc) => [cmc, avgTarget]);
      })
    );
  }, [phaseTotals, total, maxCount]);

  // Which color categories actually appear, for the legend.
  const legendKeys = useMemo<SegmentKey[]>(() => {
    if (!curveByColor) return [];
    return SEGMENT_ORDER.filter((k) => CMC_SLOTS.some((cmc) => (curveByColor[cmc]?.[k] ?? 0) > 0));
  }, [curveByColor]);

  return (
    <section className="deck-curve-phases" aria-label="Mana curve and phases">
      <div className="deck-curve-phases-head">
        <div className="deck-curve-phases-head-meta">
          <h4 className="deck-curve-phases-heading">Mana curve</h4>
          <span className="deck-curve-phases-avg">
            {averageCmc.toFixed(1)}{' '}
            <span className="deck-curve-phases-avg-label">avg mana value</span>
            <InfoTip
              label="avg mana value"
              text={
                <>
                  <span className="info-tip-lead">
                    Average card cost (the typical mana to cast a card)
                  </span>
                  <ul className="info-tip-list">
                    <li>
                      <strong>lean</strong> — cheap deck (avg under 2.8); plays out early
                    </li>
                    <li>
                      <strong>balanced</strong> — healthy mix (avg 2.8–3.5)
                    </li>
                    <li>
                      <strong>top-heavy</strong> — pricey deck (avg over 3.5); leans on big spells
                    </li>
                  </ul>
                </>
              }
            />
            {total > 0 && ` · ${avgCmcBandWord(grading.pacing)}`}
          </span>
        </div>
        {hasColorData && (
          <div
            className="deck-curve-phases-toggle"
            role="radiogroup"
            aria-label="Mana curve display mode"
          >
            <button
              type="button"
              className="deck-curve-phases-toggle-btn"
              role="radio"
              aria-checked={effectiveMode === 'color'}
              aria-pressed={effectiveMode === 'color'}
              onClick={() => setMode('color')}
            >
              By color
            </button>
            <button
              type="button"
              className="deck-curve-phases-toggle-btn"
              role="radio"
              aria-checked={effectiveMode === 'count'}
              aria-pressed={effectiveMode === 'count'}
              onClick={() => setMode('count')}
            >
              Count
            </button>
          </div>
        )}
      </div>

      {/* ── CMC histogram — stacked color segments or solid count bars ── */}
      <ul
        className="deck-curve-phases-bars"
        data-mode={effectiveMode}
        aria-label="Cards by mana value"
      >
        {slots.map((slot) => {
          const heightPct = maxCount > 0 ? (slot.count / maxCount) * 100 : 0;
          const cards = cardsByCmc?.[slot.cmc] ?? [];
          const interactive = cards.length > 0;
          const bucket = curveByColor?.[slot.cmc];

          return (
            <li key={slot.cmc} className="deck-curve-phases-bar-col">
              <span className="deck-curve-phases-bar-count">{slot.count}</span>

              <div className="deck-curve-phases-bar-track">
                {/* Target-height marker: a small dash at the pacing-aware target
                    count for this CMC slot's phase. Rendered before the bar fill
                    so it sits behind the fill in paint order. Static — no motion. */}
                {total > 0 && maxCount > 0 && targetByCmc[slot.cmc] != null && (
                  <div
                    className="deck-curve-phases-bar-target"
                    style={{ bottom: `${(targetByCmc[slot.cmc] / maxCount) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
                {effectiveMode === 'color' && bucket ? (
                  // Stacked bar. DOM order W..colorless; CSS column-reverse puts
                  // W at the baseline so the stack reads bottom→top W,U,B,R,G,
                  // gold, colorless. Each color segment is independently tappable.
                  <div className="deck-curve-phases-bar-stack" style={{ height: `${heightPct}%` }}>
                    {SEGMENT_ORDER.filter((k) => (bucket[k] ?? 0) > 0).map(
                      (segKey, idx, visible) => {
                        const segCount = bucket[segKey] ?? 0;
                        const isTop = idx === visible.length - 1;
                        const isBottom = idx === 0;
                        const segCards = interactive
                          ? cards.filter((c) => categorize(c) === segKey)
                          : [];
                        const style = {
                          flexGrow: segCount,
                          background: segmentColor(segKey),
                        } as React.CSSProperties;
                        const cls = `deck-curve-phases-seg${
                          isTop ? ' deck-curve-phases-seg-top' : ''
                        }${isBottom ? ' deck-curve-phases-seg-bottom' : ''}`;
                        const aria = `Show the ${segCount} ${SEGMENT_LABEL[segKey].toLowerCase()} ${
                          segCount === 1 ? 'card' : 'cards'
                        } at mana value ${slot.label}`;

                        return segCards.length > 0 ? (
                          <button
                            key={segKey}
                            type="button"
                            className={`${cls} deck-curve-phases-seg-btn`}
                            style={style}
                            onClick={() =>
                              showTally(
                                segCards,
                                `${SEGMENT_LABEL[segKey]} · ${slot.label} mana value`
                              )
                            }
                            aria-label={aria}
                          />
                        ) : (
                          <span key={segKey} className={cls} style={style} aria-hidden="true" />
                        );
                      }
                    )}
                  </div>
                ) : interactive ? (
                  <button
                    type="button"
                    className="deck-curve-phases-bar-fill deck-curve-phases-bar-fill-btn"
                    style={{ height: `${heightPct}%` }}
                    onClick={() => showTally(cards, `${slot.label} mana value`)}
                    aria-label={`Show the ${slot.count} cards at mana value ${slot.label}`}
                  />
                ) : (
                  <div className="deck-curve-phases-bar-fill" style={{ height: `${heightPct}%` }} />
                )}
              </div>

              <span className="deck-curve-phases-bar-label">{slot.label}</span>
            </li>
          );
        })}
      </ul>

      {effectiveMode === 'color' && legendKeys.length > 0 && (
        <ul className="deck-curve-phases-legend" aria-label="Color legend">
          {legendKeys.map((k) => (
            <li key={k} className="deck-curve-phases-legend-item">
              <span
                className="deck-curve-phases-legend-swatch"
                style={{ background: segmentColor(k) }}
                aria-hidden="true"
              />
              {SEGMENT_LABEL[k]}
            </li>
          ))}
        </ul>
      )}

      {/* ── Phase rollup with grades ── */}
      {total > 0 && (
        <div className="deck-curve-phases-grade-head">
          <span className="deck-curve-phases-grade-head-label">Curve grade by phase</span>
          <InfoTip
            label="curve grade"
            wide
            text={
              <>
                <span className="info-tip-lead">What the grade means</span>
                <ul className="info-tip-list">
                  <li>
                    Cards split by cost — <strong>Early</strong> (0–2), <strong>Mid</strong> (3–4),{' '}
                    <strong>Late</strong> (5+).
                  </li>
                  <li>The number is how many cards fall in that phase.</li>
                  <li>
                    The letter grades how close that phase is to a healthy Commander curve —{' '}
                    <strong>A</strong> is on target, <strong>F</strong> is far off.
                  </li>
                  <li>
                    A guideline, not a verdict — an off-target grade can be just what you want.
                  </li>
                </ul>
              </>
            }
          />
        </div>
      )}
      <ul className="deck-curve-phases-phases" aria-label="Curve phases">
        {phaseTotals.map((phase) => {
          const cards = phase.cmcs.flatMap((cmc) => cardsByCmc?.[cmc] ?? []);
          const interactive = cards.length > 0;
          const body = (
            <>
              <span className="deck-curve-phases-phase-label">{phase.label}</span>
              <span className="deck-curve-phases-phase-count">{phase.count}</span>
              <span
                className={`deck-curve-phases-grade deck-curve-phases-grade-${phase.grade.toLowerCase()}`}
                aria-label={`${phase.label} grade ${phase.grade}`}
              >
                {phase.grade}
              </span>
            </>
          );
          return (
            <li key={phase.key} className="deck-curve-phases-phase">
              {interactive ? (
                <button
                  type="button"
                  className="deck-curve-phases-phase-btn"
                  onClick={() => showTally(cards, `${phase.label} game`)}
                  aria-label={`Show the ${phase.count} ${phase.label}-game cards`}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      {total === 0 && <p className="deck-curve-phases-empty">No nonland cards yet.</p>}
      {groupSheet && (
        <CardGroupSheet
          title={groupSheet.title}
          tally={groupSheet.tally}
          onPick={pickFromGroup}
          onClose={() => setGroupSheet(null)}
        />
      )}
      {carousel.preview}
    </section>
  );
}
