import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckFormat } from '@/deck-builder/types';

/**
 * Discover filter state, round-tripped through the URL (`useSearchParams`) so
 * a filtered Discover view is shareable/back-navigable — see
 * `w2-discover-filters-sort`. Mirrors the query params `w2-discover-listing-
 * api`'s `GET /api/discover/decks` already accepts (`routes/discover.ts`).
 */
export type DiscoverBudgetKey = 'under50' | '50to150' | '150to400' | '400plus';

export interface DiscoverFilters {
  commander: string | null;
  format: DeckFormat | null;
  /** Sorted ascending, deduped. */
  brackets: number[];
  /** Canonical W/U/B/R/G/C order, deduped. */
  colors: string[];
  budget: DiscoverBudgetKey | null;
}

export const NO_DISCOVER_FILTERS: DiscoverFilters = {
  commander: null,
  format: null,
  brackets: [],
  colors: [],
  budget: null,
};

/** Canonical order for the colors filter — matches the popover's own render order. */
export const DISCOVER_COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

const VALID_BUDGETS = new Set<DiscoverBudgetKey>(['under50', '50to150', '150to400', '400plus']);
const VALID_COLORS = new Set<string>(DISCOVER_COLOR_ORDER);

/** Malformed/unknown query values fall back to "no filter" rather than throwing. */
export function parseDiscoverFiltersFromSearchParams(params: URLSearchParams): DiscoverFilters {
  const commander = params.get('commander')?.trim() || null;

  const formatRaw = params.get('format');
  const format = formatRaw && formatRaw in DECK_FORMAT_CONFIGS ? (formatRaw as DeckFormat) : null;

  const brackets = [
    ...new Set(
      (params.get('bracket') ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5)
    ),
  ].sort((a, b) => a - b);

  const colorSet = new Set(
    (params.get('colors') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((c) => VALID_COLORS.has(c))
  );
  const colors = DISCOVER_COLOR_ORDER.filter((c) => colorSet.has(c));

  const budgetRaw = params.get('budget');
  const budget =
    budgetRaw && VALID_BUDGETS.has(budgetRaw as DiscoverBudgetKey)
      ? (budgetRaw as DiscoverBudgetKey)
      : null;

  return { commander, format, brackets, colors, budget };
}

export function discoverFiltersToSearchParams(filters: DiscoverFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.commander) params.set('commander', filters.commander);
  if (filters.format) params.set('format', filters.format);
  if (filters.brackets.length > 0) params.set('bracket', filters.brackets.join(','));
  if (filters.colors.length > 0) params.set('colors', filters.colors.join(','));
  if (filters.budget) params.set('budget', filters.budget);
  return params;
}
