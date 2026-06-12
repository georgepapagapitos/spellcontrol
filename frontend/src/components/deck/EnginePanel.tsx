import './EnginePanel.css';
import { type JSX, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { OwnershipBadge } from './OwnershipBadge';
import type { SynergyAnalysis, SynergyAxisView } from '@/deck-builder/services/synergy/analysis';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import { useCardCarousel } from './useCardCarousel';
import { useCardThumb } from '@/lib/card-thumbs';
import { StackedBar } from '../shared/MeterBar';

export interface EnginePanelProps {
  analysis: SynergyAnalysis;
  /** Card names the player already owns — surfaces an "Owned" badge. */
  ownedNames?: Set<string>;
  /** Add a single suggested card by name. */
  onAdd: (cardName: string) => void | Promise<void>;
  /** Names currently being added (disables their button). */
  addingNames?: Set<string>;
  /**
   * Diagnostics-only mode: render just the headline + per-axis balance bars +
   * warnings, omitting the off-meta suggestion rows. Used on the Power tab,
   * where the bars are the gameplan diagnostic; the suggestion *rows* now live
   * in the Coach tab's unified feed (see CoachFeed), so all "add a card"
   * prescription stays in one place.
   */
  showSuggestions?: boolean;
}

/**
 * A producer↔payoff balance bar for one axis. Bar length is proportional to
 * the axis's weight (its producer+payoff card count) on a scale shared across
 * all displayed axes (`maxTotal`), so a 3-card fringe theme no longer paints
 * the same full-width bar as the 20-card primary engine.
 */
function AxisBalance({ axis, maxTotal }: { axis: SynergyAxisView; maxTotal: number }): JSX.Element {
  return (
    <li className="engine-axis">
      <div className="engine-axis-head">
        <span className="engine-axis-label">{axis.label}</span>
        <span className="engine-axis-counts">
          <span className="is-prod">{axis.producers} producers</span>
          {' / '}
          <span className="is-pay">{axis.payoffs} payoffs</span>
        </span>
      </div>
      {/* Decorative (aria-hidden via the primitive) — the colored counts above
          already convey this to AT; the inter-segment divider gives a non-color
          cue for the producer/payoff split. */}
      <StackedBar
        className="engine-axis-bar"
        max={maxTotal}
        segments={[
          { key: 'producers', value: axis.producers, color: 'var(--accent)' },
          { key: 'payoffs', value: axis.payoffs, color: 'var(--success, #2f7d4f)' },
        ]}
      />
    </li>
  );
}

function SuggestionTile({
  suggestion,
  owned,
  adding,
  onAdd,
  onPreview,
}: {
  suggestion: SynergySuggestion;
  owned: boolean;
  adding: boolean;
  onAdd: () => void;
  onPreview: () => void;
}): JSX.Element {
  const sideWord = suggestion.side === 'payoff' ? 'payoff' : 'producer';
  // Resolve the suggestion's CDN art by name (cached + batched); the art box
  // shows its own placeholder background until it lands.
  const thumb = useCardThumb(suggestion.cardName);
  return (
    <li className="engine-suggestion">
      <button
        type="button"
        className="engine-suggestion-art"
        onClick={onPreview}
        aria-label={`Preview ${suggestion.cardName}`}
      >
        {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" />}
      </button>
      <button
        type="button"
        className="engine-suggestion-body"
        onClick={onPreview}
        aria-label={`Preview ${suggestion.cardName}`}
      >
        <span className="engine-suggestion-name">{suggestion.cardName}</span>
        <span className="engine-suggestion-reason">
          Adds a {sideWord} — {suggestion.reason}
        </span>
        <span className="engine-suggestion-meta">
          {suggestion.inclusion != null
            ? `In ${Math.round(suggestion.inclusion)}% of decks`
            : 'Off-meta'}
          <OwnershipBadge owned={owned} />
        </span>
      </button>
      <button
        type="button"
        className="engine-suggestion-add"
        onClick={onAdd}
        disabled={adding}
        aria-label={`Add ${suggestion.cardName}`}
      >
        <Plus width={14} height={14} aria-hidden />
        {adding ? 'Adding…' : 'Add'}
      </button>
    </li>
  );
}

export function EnginePanel({
  analysis,
  ownedNames,
  onAdd,
  addingNames,
  showSuggestions = true,
}: EnginePanelProps): JSX.Element {
  const owned = ownedNames ?? new Set<string>();
  const adding = addingNames ?? new Set<string>();

  const carousel = useCardCarousel('Engine suggestions');

  // Every suggestion (in render order) becomes a carousel slot, labeled with its
  // inclusion. Tapping any tile opens the shared CardPreview carousel at that card.
  const previewEntries = useMemo(
    () =>
      analysis.suggestions.map((s) => ({
        name: s.cardName,
        label: s.inclusion != null ? `In ${Math.round(s.inclusion)}% of decks` : 'Off-meta',
      })),
    [analysis.suggestions]
  );

  // Group suggestions by axis label so each gap reads as a section.
  const groups = useMemo(() => {
    const map = new Map<string, SynergySuggestion[]>();
    for (const s of analysis.suggestions) {
      const bucket = map.get(s.axisLabel);
      if (bucket) bucket.push(s);
      else map.set(s.axisLabel, [s]);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [analysis.suggestions]);

  // Only show axes the deck actually engages with (has at least one card).
  const axes = analysis.axes.filter((a) => a.producers + a.payoffs > 0);
  // Shared scale for the balance bars — the busiest axis spans the full track.
  const maxAxisTotal = axes.reduce((m, a) => Math.max(m, a.producers + a.payoffs), 0);

  return (
    <section className="engine-panel" aria-label="Deck engine analysis">
      <p className="engine-headline">{analysis.headline}</p>

      {axes.length > 0 && (
        <ul className="engine-axes">
          {axes.map((a) => (
            <AxisBalance key={a.axis} axis={a} maxTotal={maxAxisTotal} />
          ))}
        </ul>
      )}

      {analysis.warnings.length > 0 && (
        <ul className="engine-warnings">
          {analysis.warnings.map((w) => (
            <li key={w} className="engine-warning">
              {w}
            </li>
          ))}
        </ul>
      )}

      {showSuggestions &&
        (groups.length > 0 ? (
          <div className="engine-suggestions">
            <h3 className="engine-suggestions-title">Off-meta cards that fill your gaps</h3>
            {groups.map((group) => (
              <div key={group.label} className="engine-suggestion-group">
                <h4 className="engine-suggestion-group-label">{group.label}</h4>
                <ul className="engine-suggestion-list">
                  {group.items.map((s) => (
                    <SuggestionTile
                      key={s.cardName}
                      suggestion={s}
                      owned={owned.has(s.cardName)}
                      adding={adding.has(s.cardName)}
                      onAdd={() => onAdd(s.cardName)}
                      onPreview={() => void carousel.open(previewEntries, s.cardName)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="engine-empty">
            No off-meta suggestions right now — your engine looks balanced, or no clear engine was
            detected.
          </p>
        ))}

      {showSuggestions && carousel.preview}
    </section>
  );
}
