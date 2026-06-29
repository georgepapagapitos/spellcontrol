import { type JSX, useMemo, useState } from 'react';
import './PlaystyleRadar.css';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { buildAxisTally } from '@/deck-builder/services/synergy/axisTally';
import { selectRadarAxes, radarLayout } from '@/lib/playstyle-radar';
import { useCardCarousel, tallyToEntries } from './useCardCarousel';
import { CardGroupSheet } from './CardGroupSheet';
import { InfoTip } from '@/components/InfoTip';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardTally } from './useCardCarousel';
import type { AxisSummary } from '@/deck-builder/services/synergy/deckSynergy';

// ── Constants ──────────────────────────────────────────────────────────────

/** SVG canvas size — kept small so it never needs to scale down. */
const RADAR_SIZE = 280;

// ── <3-axes fallback ───────────────────────────────────────────────────────

function FewAxesFallback({ axes }: { axes: AxisSummary[] }): JSX.Element {
  return (
    <div className="playstyle-radar-few-axes">
      {axes.length > 0 ? (
        <>
          <div className="playstyle-radar-chips">
            {axes.map((a) => (
              <span key={a.axis} className="playstyle-radar-chip">
                {a.label} {a.total}
              </span>
            ))}
          </div>
          <p className="playstyle-radar-few-msg">Not enough synergy signal for a shape yet.</p>
        </>
      ) : (
        <p className="playstyle-radar-few-msg">Not enough synergy signal for a shape yet.</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * SVG playstyle radar built from the deck's live synergy analysis.
 *
 * - Computes `analyzeDeckSynergy` once (memoized on cards).
 * - Selects top-6 axes, matching EnginePanel's selection.
 * - Renders spokes, a reference ring, the value polygon, vertex dots,
 *   and real text labels (word + count) at each vertex.
 * - Each vertex is a <button> that opens `CardGroupSheet` → carousel.
 * - <3 active axes: labeled count chips + fallback message instead of polygon.
 * - One-shot polygon entrance animation, reduced-motion gated.
 */
export function PlaystyleRadar({ cards }: { cards: ScryfallCard[] }): JSX.Element {
  const carousel = useCardCarousel('Playstyle radar');
  const [activeGroup, setActiveGroup] = useState<{
    title: string;
    subtitle: string;
    tally: CardTally[];
  } | null>(null);

  // Run the synergy engine — pure, one pass, memoized on the card list
  const synergy = useMemo(() => analyzeDeckSynergy(cards), [cards]);
  const axes = useMemo(() => selectRadarAxes(synergy), [synergy]);

  const openAxis = (axis: AxisSummary) => {
    const tally = buildAxisTally(axis, cards);
    if (tally.length === 0) return;
    setActiveGroup({
      title: axis.label,
      subtitle: `${axis.producers.length} producer${axis.producers.length !== 1 ? 's' : ''} · ${axis.payoffs.length} payoff${axis.payoffs.length !== 1 ? 's' : ''}`,
      tally,
    });
  };

  const pickFromGroup = (picked: CardTally) => {
    if (!activeGroup) return;
    void carousel.open(tallyToEntries(activeGroup.tally), picked.name);
  };

  // Build aria-label sentence for the whole radar
  const ariaLabel =
    axes.length > 0
      ? `Playstyle radar: ${axes.map((a) => `${a.label} ${a.total}`).join(', ')}.`
      : 'Playstyle radar: no synergy axes detected.';

  // <3 axes → can't form a polygon
  if (axes.length < 3) {
    return (
      <div className="playstyle-radar-root">
        <FewAxesFallback axes={axes} />
        <p className="playstyle-radar-caption">
          Engine balance, not power — tap an axis to see its cards.{' '}
          <InfoTip
            label="playstyle radar"
            text="Vertices are normalized to the deck's busiest axis, so the shape shows engine balance, not absolute power. Producers feed a resource; payoffs spend it."
            wide
          />
        </p>
      </div>
    );
  }

  // Normalize values to [0..1] relative to the busiest axis
  const maxTotal = axes[0].total;
  const values = axes.map((a) => (maxTotal > 0 ? a.total / maxTotal : 0));

  const layout = radarLayout(values, RADAR_SIZE);
  const half = RADAR_SIZE / 2;

  return (
    <div className="playstyle-radar-root">
      <div className="playstyle-radar-svg-wrap">
        <svg
          className="playstyle-radar-svg"
          viewBox={`${-half} ${-half} ${RADAR_SIZE} ${RADAR_SIZE}`}
          role="img"
          aria-label={ariaLabel}
        >
          {/* ── Reference rings ── */}
          {layout && (
            <>
              <circle
                cx="0"
                cy="0"
                r={layout.referenceRadius}
                fill="none"
                stroke="var(--border)"
                strokeWidth="0.5"
              />
              <circle
                cx="0"
                cy="0"
                r={layout.outerRadius}
                fill="none"
                stroke="var(--border)"
                strokeWidth="0.5"
              />
            </>
          )}

          {/* ── Spokes ── */}
          {layout &&
            layout.spokes.map((s, i) => (
              <line
                key={i}
                x1="0"
                y1="0"
                x2={s.tip.x}
                y2={s.tip.y}
                stroke="var(--border)"
                strokeWidth="0.5"
              />
            ))}

          {/* ── Value polygon ── */}
          {layout && (
            <polygon
              className="playstyle-radar-polygon"
              points={layout.polygonPoints}
              fill="var(--accent)"
              fillOpacity="0.18"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          )}

          {/* ── Vertex dots (decorative, not interactive — buttons handle hit area) ── */}
          {layout &&
            layout.vertices.map((v, i) => (
              <circle key={i} cx={v.x} cy={v.y} r="3" fill="var(--accent)" aria-hidden="true" />
            ))}
        </svg>

        {/* ── Vertex buttons (positioned over the SVG) ── */}
        {layout &&
          axes.map((axis, i) => {
            const v = layout.vertices[i];
            const labelStr = `${axis.label} — ${axis.total} card${axis.total !== 1 ? 's' : ''}: ${axis.producers.length} producer${axis.producers.length !== 1 ? 's' : ''}, ${axis.payoffs.length} payoff${axis.payoffs.length !== 1 ? 's' : ''}. Show cards.`;
            return (
              <button
                key={axis.axis}
                type="button"
                // Centered on the label point (not edge-anchored): the layout's
                // label band keeps every point inside the wrapper, and a centered
                // box is the only anchoring that can't extend past the edge.
                className="playstyle-radar-vertex-btn"
                style={
                  {
                    '--vx': `${((v.labelX + half) / RADAR_SIZE) * 100}%`,
                    '--vy': `${((v.labelY + half) / RADAR_SIZE) * 100}%`,
                  } as React.CSSProperties
                }
                onClick={() => openAxis(axis)}
                aria-label={labelStr}
              >
                <span className="playstyle-radar-vertex-label">{axis.label}</span>
                <span className="playstyle-radar-vertex-count">{axis.total}</span>
              </button>
            );
          })}
      </div>

      {/* ── Honesty caption ── */}
      <p className="playstyle-radar-caption">
        Engine balance, not power — tap an axis to see its cards.{' '}
        <InfoTip
          label="playstyle radar"
          text="Vertices are normalized to the deck's busiest axis, so the shape shows engine balance, not absolute power. Producers feed a resource; payoffs spend it."
          wide
        />
      </p>

      {/* ── Drill-through: axis card group sheet ── */}
      {activeGroup && (
        <CardGroupSheet
          title={activeGroup.title}
          subtitle={activeGroup.subtitle}
          tally={activeGroup.tally}
          onPick={pickFromGroup}
          onClose={() => setActiveGroup(null)}
        />
      )}
      {carousel.preview}
    </div>
  );
}
