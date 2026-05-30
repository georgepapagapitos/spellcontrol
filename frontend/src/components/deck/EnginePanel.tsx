import './EnginePanel.css';
import { useCallback, useMemo, useState } from 'react';
import type { SynergyAnalysis, SynergyAxisView } from '@/deck-builder/services/synergy/analysis';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { EnrichedCard } from '@/types';
import { CardPreview } from '@/components/CardPreview';

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
          {owned && (
            <span className="deck-analysis-suggest-owned" title="In your collection">
              Owned
            </span>
          )}
        </span>
      </button>
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

  const [previewCards, setPreviewCards] = useState<EnrichedCard[] | null>(null);
  const [previewLabels, setPreviewLabels] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Open the CardPreview carousel over every suggestion (in render order),
  // starting at the tapped card. Cards are fetched from Scryfall on demand and
  // converted to EnrichedCard; any that fail to resolve are skipped so the
  // carousel never shows a broken slot. Mirrors GapAnalysisPanel.openCarousel.
  const openCarousel = useCallback(
    async (tappedName: string) => {
      const resolved: EnrichedCard[] = [];
      const labels: string[] = [];
      for (const s of analysis.suggestions) {
        try {
          const scry = await getCardByName(s.cardName);
          if (!scry) continue;
          resolved.push(scryfallToEnrichedCard(scry));
          labels.push(s.inclusion != null ? `In ${Math.round(s.inclusion)}% of decks` : 'Off-meta');
        } catch {
          /* skip — leaves the slot out of the carousel */
        }
      }
      if (resolved.length === 0) return;
      const idx = resolved.findIndex((c) => c.name.toLowerCase() === tappedName.toLowerCase());
      setPreviewCards(resolved);
      setPreviewLabels(labels);
      setPreviewIndex(idx >= 0 ? idx : 0);
    },
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
                    onPreview={() => void openCarousel(s.cardName)}
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

      {previewCards && previewCards.length > 0 && (
        <CardPreview
          cards={previewCards}
          index={previewIndex}
          binderName="Engine suggestions"
          sectionLabels={previewLabels}
          pageNumbers={previewCards.map(() => 0)}
          totalPages={1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewCards(null)}
        />
      )}
    </section>
  );
}
