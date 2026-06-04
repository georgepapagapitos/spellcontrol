import './EnginePanel.css';
import { useMemo, useRef, useState } from 'react';
import { Plus, ArrowDown } from 'lucide-react';
import { OwnershipBadge } from './OwnershipBadge';
import type { SynergyAnalysis, SynergyAxisView } from '@/deck-builder/services/synergy/analysis';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import { useCardCarousel } from './useCardCarousel';

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
   * in the Tune tab's "Improve the deck" lane (see ImproveLane), so all
   * "add a card" prescription stays in one place.
   */
  showSuggestions?: boolean;
}

function scryThumb(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

/** A producer↔payoff balance bar for one axis. */
function AxisBalance({ axis }: { axis: SynergyAxisView }): JSX.Element {
  const total = axis.producers + axis.payoffs || 1;
  const prodPct = Math.round((axis.producers / total) * 100);
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
      {/* Decorative — the colored counts above already convey this to AT; the
          inter-segment divider gives a non-color cue for the producer/payoff split. */}
      <div className="engine-axis-bar" aria-hidden={true}>
        <span className="engine-axis-bar-prod" style={{ width: `${prodPct}%` }} />
        <span className="engine-axis-bar-pay" style={{ width: `${100 - prodPct}%` }} />
      </div>
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
  return (
    <li className="engine-suggestion">
      <button
        type="button"
        className="engine-suggestion-art"
        onClick={onPreview}
        aria-label={`Preview ${suggestion.cardName}`}
      >
        <img
          src={scryThumb(suggestion.cardName)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => {
            // Scryfall 404 / rate-limit / offline (native WebView): drop the
            // broken-image glyph and let the art box show its placeholder.
            e.currentTarget.style.display = 'none';
          }}
        />
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

  // Refs to each suggestion group, so a lopsided-engine warning can scroll to the
  // fills for its axis. `flashAxis` briefly highlights the group it jumped to.
  const groupRefs = useRef(new Map<AxisKey, HTMLDivElement>());
  const [flashAxis, setFlashAxis] = useState<AxisKey | null>(null);
  const jumpToFixes = (axis: AxisKey): void => {
    const el = groupRefs.current.get(axis);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashAxis(axis);
    window.setTimeout(() => setFlashAxis((a) => (a === axis ? null : a)), 1600);
  };

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

  // Group suggestions by axis so each gap reads as a section (and a warning can
  // link to it). Keyed by axis label for display, but carries the axis key.
  const groups = useMemo(() => {
    const map = new Map<string, { axis: AxisKey; items: SynergySuggestion[] }>();
    for (const s of analysis.suggestions) {
      const bucket = map.get(s.axisLabel);
      if (bucket) bucket.items.push(s);
      else map.set(s.axisLabel, { axis: s.axis, items: [s] });
    }
    return Array.from(map.entries()).map(([label, g]) => ({ label, axis: g.axis, items: g.items }));
  }, [analysis.suggestions]);

  // How many in-panel fills exist per axis+side — drives the "Show N fixes" link
  // on a lopsided warning. Only meaningful when suggestions render here.
  const fixCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (showSuggestions) {
      for (const s of analysis.suggestions) {
        const k = `${s.axis}:${s.side}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [analysis.suggestions, showSuggestions]);

  const lopsided = analysis.lopsided ?? [];

  // Only show axes the deck actually engages with (has at least one card).
  const axes = analysis.axes.filter((a) => a.producers + a.payoffs > 0);

  return (
    <section className="engine-panel" aria-label="Deck engine analysis">
      <p className="engine-headline">{analysis.headline}</p>

      {axes.length > 0 && (
        <ul className="engine-axes">
          {axes.map((a) => (
            <AxisBalance key={a.axis} axis={a} />
          ))}
        </ul>
      )}

      {lopsided.length > 0 ? (
        <ul className="engine-warnings">
          {lopsided.map((w) => {
            const fixes = fixCounts.get(`${w.axis}:${w.side}`) ?? 0;
            return (
              <li key={`${w.axis}:${w.side}`} className="engine-warning">
                {w.text}
                {fixes > 0 && (
                  <button
                    type="button"
                    className="engine-warning-fix"
                    onClick={() => jumpToFixes(w.axis)}
                  >
                    Show {fixes} fix{fixes === 1 ? '' : 'es'}
                    <ArrowDown width={12} height={12} aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        analysis.warnings.length > 0 && (
          <ul className="engine-warnings">
            {analysis.warnings.map((w) => (
              <li key={w} className="engine-warning">
                {w}
              </li>
            ))}
          </ul>
        )
      )}

      {showSuggestions &&
        (groups.length > 0 ? (
          <div className="engine-suggestions">
            <h3 className="engine-suggestions-title">Off-meta cards that fill your gaps</h3>
            {groups.map((group) => (
              <div
                key={group.label}
                className={`engine-suggestion-group${flashAxis === group.axis ? ' is-flash' : ''}`}
                ref={(el) => {
                  if (el) groupRefs.current.set(group.axis, el);
                  else groupRefs.current.delete(group.axis);
                }}
              >
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
