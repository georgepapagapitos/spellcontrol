import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export interface FilterChipDescriptor {
  id: string;
  label: string;
  onClear: () => void;
}

/**
 * Filter-facing colour names, matching the filter popovers' own option labels.
 * Deliberately not `COLOR_INFO` from binder-routing — that's the *grouping*
 * vocabulary ('C' reads "Colorless / Artifact", plus M/L/? buckets), too long
 * and too broad for a filter chip.
 */
const FILTER_COLOR_LABELS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

/** "White, Blue" for a set of WUBRG(C) filter keys. */
export function colorChipLabel(keys: Iterable<string>): string {
  return [...keys].map((k) => FILTER_COLOR_LABELS[k] ?? k).join(', ');
}

/**
 * Active-filter chip row: one chip per active filter group, × on a chip clears
 * just that slice, "Clear all" appears once more than one is active. Non-sticky
 * — it sits between the search bar and the controls row and scrolls with
 * content. Renders nothing when nothing is filtered.
 *
 * CardListTable and ListDetailView each carried a verbatim copy of this markup;
 * it now lives here so every filterable list surface (collection, lists, decks,
 * binders, combos, discover) shows the same affordance. Keeps the
 * `.collection-filter-*` class names — the CSS stays in styles/collection.css.
 */
export function FilterChipsRow({
  chips,
  onClearAll,
  children,
}: {
  chips: FilterChipDescriptor[];
  onClearAll: () => void;
  /** Extra inline actions after "Clear all" (e.g. collection's Save as binder). */
  children?: ReactNode;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="collection-filter-chips" role="group" aria-label="Active filters">
      {chips.map((chip) => (
        <span key={chip.id} className="collection-filter-chip">
          <span className="collection-filter-chip-label">{chip.label}</span>
          <button
            type="button"
            className="collection-filter-chip-clear"
            aria-label={`Remove filter: ${chip.label}`}
            onClick={chip.onClear}
          >
            <X width={12} height={12} strokeWidth={2.5} aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" className="collection-filter-chips-clear-all" onClick={onClearAll}>
          Clear all
        </button>
      )}
      {children}
    </div>
  );
}
