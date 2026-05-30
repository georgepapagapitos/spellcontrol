import { useCallback, useMemo, useState } from 'react';
import type { OptimizeCard, OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';

/** A group checkbox is on (all selected), off (none), or mixed (some). */
export type TriState = boolean | 'mixed';

export interface OptimizePlanTotals {
  /** Checked removals. */
  cutCount: number;
  /** Checked additions. */
  addCount: number;
  /** currentSize − checked cuts + checked adds. */
  projectedSize: number;
  /** round(Σ inclusion(checked adds) − Σ inclusion(checked cuts)). */
  scoreDelta: number;
  /** Σ price(checked adds) − Σ price(checked cuts), or null when no price parses. */
  priceDelta: number | null;
}

export interface UseOptimizePlanResult {
  /** Names of removals currently checked (will be cut). */
  checkedRemovalNames: string[];
  /** Names of additions currently checked (will be added). */
  checkedAdditionNames: string[];
  /** Aggregate plan math. */
  totals: OptimizePlanTotals;
  /** Whether a single removal/addition is checked. */
  isRemovalChecked: (name: string) => boolean;
  isAdditionChecked: (name: string) => boolean;
  /** Tri-state for an arbitrary group of removal/addition names. */
  removalGroupState: (names: string[]) => TriState;
  additionGroupState: (names: string[]) => TriState;
  /** Toggle a single card on its side. */
  toggle: (side: OptimizeSide, name: string) => void;
  /** Toggle a whole group: select all if not fully selected, else deselect all. */
  toggleGroup: (side: OptimizeSide, names: string[]) => void;
  /** Check (true) or uncheck (false) every card on a side. */
  setAll: (side: OptimizeSide, checked: boolean) => void;
}

export type OptimizeSide = 'remove' | 'add';

/** OptimizeCard.price is a free-form string ("1.23", "$4.50", or absent).
 *  Parse defensively — strip anything that isn't a number/dot, then guard NaN. */
function parsePrice(price: string | undefined): number | null {
  if (!price) return null;
  const cleaned = price.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function triStateFor(names: string[], unchecked: Set<string>): TriState {
  if (names.length === 0) return false;
  let uncheckedHere = 0;
  for (const name of names) if (unchecked.has(name)) uncheckedHere += 1;
  if (uncheckedHere === 0) return true;
  if (uncheckedHere === names.length) return false;
  return 'mixed';
}

/** Selection model over an OptimizeSwaps. Default: every card checked.
 *  Selection is tracked as an "unchecked" set per side so newly-arriving
 *  cards default to checked. Pure logic — no store/network access. */
export function useOptimizePlan(swaps: OptimizeSwaps, currentSize: number): UseOptimizePlanResult {
  const { removals, additions } = swaps;

  const [uncheckedRemovals, setUncheckedRemovals] = useState<Set<string>>(() => new Set());
  const [uncheckedAdditions, setUncheckedAdditions] = useState<Set<string>>(() => new Set());

  const checkedRemovals = useMemo(
    () => removals.filter((c) => !uncheckedRemovals.has(c.name)),
    [removals, uncheckedRemovals]
  );
  const checkedAdditions = useMemo(
    () => additions.filter((c) => !uncheckedAdditions.has(c.name)),
    [additions, uncheckedAdditions]
  );

  const checkedRemovalNames = useMemo(() => checkedRemovals.map((c) => c.name), [checkedRemovals]);
  const checkedAdditionNames = useMemo(
    () => checkedAdditions.map((c) => c.name),
    [checkedAdditions]
  );

  const totals = useMemo<OptimizePlanTotals>(() => {
    const sumInclusion = (cards: OptimizeCard[]) =>
      cards.reduce((acc, c) => acc + (c.inclusion ?? 0), 0);

    let cutPrice = 0;
    let addPrice = 0;
    let anyPrice = false;
    for (const c of checkedRemovals) {
      const p = parsePrice(c.price);
      if (p != null) {
        cutPrice += p;
        anyPrice = true;
      }
    }
    for (const c of checkedAdditions) {
      const p = parsePrice(c.price);
      if (p != null) {
        addPrice += p;
        anyPrice = true;
      }
    }

    return {
      cutCount: checkedRemovals.length,
      addCount: checkedAdditions.length,
      projectedSize: currentSize - checkedRemovals.length + checkedAdditions.length,
      scoreDelta: Math.round(sumInclusion(checkedAdditions) - sumInclusion(checkedRemovals)),
      priceDelta: anyPrice ? addPrice - cutPrice : null,
    };
  }, [checkedRemovals, checkedAdditions, currentSize]);

  const isRemovalChecked = useCallback(
    (name: string) => !uncheckedRemovals.has(name),
    [uncheckedRemovals]
  );
  const isAdditionChecked = useCallback(
    (name: string) => !uncheckedAdditions.has(name),
    [uncheckedAdditions]
  );

  const removalGroupState = useCallback(
    (names: string[]) => triStateFor(names, uncheckedRemovals),
    [uncheckedRemovals]
  );
  const additionGroupState = useCallback(
    (names: string[]) => triStateFor(names, uncheckedAdditions),
    [uncheckedAdditions]
  );

  const toggle = useCallback((side: OptimizeSide, name: string) => {
    const setter = side === 'remove' ? setUncheckedRemovals : setUncheckedAdditions;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (side: OptimizeSide, names: string[]) => {
      const setter = side === 'remove' ? setUncheckedRemovals : setUncheckedAdditions;
      const unchecked = side === 'remove' ? uncheckedRemovals : uncheckedAdditions;
      const fullyChecked = names.every((n) => !unchecked.has(n));
      setter((prev) => {
        const next = new Set(prev);
        // If every card in the group is already checked, deselect them all;
        // otherwise (none or some) select the whole group.
        if (fullyChecked) for (const n of names) next.add(n);
        else for (const n of names) next.delete(n);
        return next;
      });
    },
    [uncheckedRemovals, uncheckedAdditions]
  );

  const setAll = useCallback(
    (side: OptimizeSide, checked: boolean) => {
      const cards = side === 'remove' ? removals : additions;
      const setter = side === 'remove' ? setUncheckedRemovals : setUncheckedAdditions;
      setter(checked ? new Set() : new Set(cards.map((c) => c.name)));
    },
    [removals, additions]
  );

  return {
    checkedRemovalNames,
    checkedAdditionNames,
    totals,
    isRemovalChecked,
    isAdditionChecked,
    removalGroupState,
    additionGroupState,
    toggle,
    toggleGroup,
    setAll,
  };
}
