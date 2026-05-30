import './EnginePanel.css';
import { useMemo } from 'react';
import type { SynergyAnalysis, SynergyAxisView } from '@/deck-builder/services/synergy/analysis';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';

export interface EnginePanelProps {
  analysis: SynergyAnalysis;
  /** Card names the player already owns — surfaces an "Owned" badge. */
  ownedNames?: Set<string>;
  /** Add a single suggested card by name. */
  onAdd: (cardName: string) => void | Promise<void>;
  /** Names currently being added (disables their button). */
  addingNames?: Set<string>;
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
      <div className="engine-axis-bar" aria-hidden>
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
}: {
  suggestion: SynergySuggestion;
  owned: boolean;
  adding: boolean;
  onAdd: () => void;
}): JSX.Element {
  const sideWord = suggestion.side === 'payoff' ? 'payoff' : 'producer';
  return (
    <li className="engine-suggestion">
      <span className="engine-suggestion-art">
        <img src={scryThumb(suggestion.cardName)} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="engine-suggestion-body">
        <span className="engine-suggestion-name" title={suggestion.cardName}>
          {suggestion.cardName}
        </span>
        <span className="engine-suggestion-reason">
          Adds a {sideWord} — {suggestion.reason}
        </span>
        <span className="engine-suggestion-meta">
          {suggestion.inclusion != null
            ? `In ${Math.round(suggestion.inclusion)}% of decks`
            : 'Off-meta'}
          {owned && (
            <span className="deck-analysis-suggest-owned" title="In your collection">
              Owned
            </span>
          )}
        </span>
      </span>
      <button
        type="button"
        className="engine-suggestion-add"
        onClick={onAdd}
        disabled={adding}
        aria-label={`Add ${suggestion.cardName}`}
      >
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
}: EnginePanelProps): JSX.Element {
  const owned = ownedNames ?? new Set<string>();
  const adding = addingNames ?? new Set<string>();

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

      {analysis.warnings.length > 0 && (
        <ul className="engine-warnings">
          {analysis.warnings.map((w) => (
            <li key={w} className="engine-warning">
              {w}
            </li>
          ))}
        </ul>
      )}

      {groups.length > 0 ? (
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
      )}
    </section>
  );
}
