import './SynergyPicks.css';
import { useMemo } from 'react';
import { DeckCardRow } from './DeckCardRow';
import { useCardCarousel } from './useCardCarousel';
import {
  fromSynergySuggestion,
  sortOwnedFirst,
  type Change,
  type ChangeOwnership,
} from '@/lib/deck-change';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';

export interface SynergyPicksProps {
  /** Off-meta engine suggestions (deck.synergyAnalysis.suggestions). */
  suggestions: SynergySuggestion[];
  /** Allocation-aware ownership for a card name (owned / in-other-deck / unowned),
   *  re-derived live so the row's ownership is never stale. */
  resolveOwnership?: (name: string) => ChangeOwnership;
  /** Add a single suggested card by name (shared with the old Engine panel). */
  onAdd: (cardName: string) => void | Promise<void>;
  /** Names currently being added (disables their Add button). */
  addingNames?: Set<string>;
  /** Commander name, for the inclusion line wording. */
  commanderName?: string;
}

/**
 * The "Synergy picks" sub-view of the Tune tab's Upgrade lane — the off-meta
 * engine cards that complete a synergy axis (producers/payoffs). Relocated out
 * of the Power tab's Engine panel so all "add a card" prescription lives in
 * Tune; the Engine panel keeps only its axis-balance diagnostic bars. Rows go
 * through the shared `<DeckCardRow>` over the normalized `Change` model, so this
 * list and the card-preview can never disagree.
 */
export function SynergyPicks({
  suggestions,
  resolveOwnership,
  onAdd,
  addingNames,
  commanderName,
}: SynergyPicksProps): JSX.Element | null {
  const adding = addingNames ?? new Set<string>();
  const carousel = useCardCarousel('Synergy picks');

  // Each suggestion → a normalized Change with live, allocation-aware ownership,
  // grouped by axis so each gap reads as a labeled section (matching the old
  // Engine grouping).
  const groups = useMemo(() => {
    const map = new Map<string, Change[]>();
    for (const s of suggestions) {
      const change = fromSynergySuggestion(s, resolveOwnership?.(s.cardName) ?? 'unowned');
      const bucket = map.get(s.axisLabel);
      if (bucket) bucket.push(change);
      else map.set(s.axisLabel, [change]);
    }
    // Owned-first within each axis group (the locked default): cards you already
    // own surface above the ones you'd have to acquire.
    return Array.from(map.entries()).map(([label, changes]) => ({
      label,
      changes: sortOwnedFirst(changes),
    }));
  }, [suggestions, resolveOwnership]);

  // Carousel slots in render order, labeled with inclusion (or "Off-meta").
  const previewEntries = useMemo(
    () =>
      suggestions.map((s) => ({
        name: s.cardName,
        label: s.inclusion != null ? `In ${Math.round(s.inclusion)}% of decks` : 'Off-meta',
      })),
    [suggestions]
  );

  if (suggestions.length === 0) return null;

  return (
    <section className="synergy-picks" aria-label="Synergy picks">
      <h3 className="synergy-picks-title">Synergy picks</h3>
      <p className="synergy-picks-sub">Off-meta cards that complete your deck&rsquo;s engines.</p>
      {groups.map((group) => (
        <div key={group.label} className="synergy-picks-group">
          <h4 className="synergy-picks-group-label">{group.label}</h4>
          <ul className="synergy-picks-list">
            {group.changes.map((change) => (
              <DeckCardRow
                key={change.id}
                change={change}
                commanderName={commanderName}
                onAct={() => void onAdd(change.name)}
                acting={adding.has(change.name)}
                onPreview={() => void carousel.open(previewEntries, change.name)}
              />
            ))}
          </ul>
        </div>
      ))}
      {carousel.preview}
    </section>
  );
}
