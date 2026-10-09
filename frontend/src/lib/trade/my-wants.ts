import { useMemo } from 'react';
import { isTrackingList } from '@/lib/collection/lists';
import { useCollectionStore } from '@/store/collection';
import type { ListDef } from '@/types/index';

/** Oracle ids on the viewer's want lists. Tracking lists catalog cards the
 *  viewer owns, so they are never wants (the same rule the trade radar uses). */
export function wantedOracleIds(lists: readonly ListDef[]): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    if (isTrackingList(list)) continue;
    for (const entry of list.entries) if (entry.oracleId) out.add(entry.oracleId);
  }
  return out;
}

/**
 * What the viewer is looking for, or undefined when they are looking for
 * nothing, so a browser offers no "On my wants" chip that could only say 0.
 */
export function useMyWants(): ReadonlySet<string> | undefined {
  const lists = useCollectionStore((s) => s.lists);
  return useMemo(() => {
    const wants = wantedOracleIds(lists);
    return wants.size > 0 ? wants : undefined;
  }, [lists]);
}
