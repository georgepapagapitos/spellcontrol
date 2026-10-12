import { useCallback, useMemo, useState } from 'react';
import type { Row } from './card-list-table-config';

/**
 * Bulk selection for the collection table (E549). Keyed by row.key (the
 * grouped printing+finish key, or a copyId when grouping is off) — the same
 * identity the row template renders. Selection is a deliberate mode the user
 * opts into (toolbar toggle): rows stay clean until "Select" is on, then a
 * click toggles selection instead of opening the preview.
 */
export function useRowSelection(sorted: Row[]) {
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((key: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedRowKeys(new Set()), []);
  const [selectMode, setSelectMode] = useState(false);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  // "Select all" is scoped to the rows currently shown (post-search/filter),
  // not the whole collection — selecting things you can't see would be a
  // footgun for the bulk delete/move actions. allSelected drives the toggle
  // label so one button both selects and clears the visible set.
  const allSelected = useMemo(
    () => sorted.length > 0 && sorted.every((r) => selectedRowKeys.has(r.key)),
    [sorted, selectedRowKeys]
  );
  const selectAll = useCallback(() => {
    setSelectedRowKeys(new Set(sorted.map((r) => r.key)));
  }, [sorted]);

  // Selection copy count (for the "N rows · M copies" selection display).
  const selectedCopiesCount = useMemo(() => {
    if (selectedRowKeys.size === 0) return 0;
    return sorted.filter((r) => selectedRowKeys.has(r.key)).reduce((sum, r) => sum + r.qty, 0);
  }, [sorted, selectedRowKeys]);
  const countLabel = `${selectedRowKeys.size} ${selectedRowKeys.size === 1 ? 'row' : 'rows'} · ${selectedCopiesCount} ${selectedCopiesCount === 1 ? 'copy' : 'copies'}`;

  return {
    selectedRowKeys,
    toggleRow,
    clearSelection,
    selectMode,
    setSelectMode,
    exitSelectMode,
    allSelected,
    selectAll,
    countLabel,
  };
}
