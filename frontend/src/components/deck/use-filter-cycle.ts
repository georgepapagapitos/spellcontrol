import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useRegisterShortcuts, isTypingTarget } from '@/components/app-shell/shortcut-registry';
import { COACH_SHORTCUTS, type FilterId } from './coach-feed-filters';

/**
 * The Coach feed's `f` key: cycles the filter chips that have rows. Registers
 * the feed's shortcuts too. The key listener reads the chip list through a ref
 * so it doesn't re-register on every render; the ref is synced in an effect
 * (writing refs during render is flagged by react-hooks/refs).
 */
export function useFilterCycle(
  cyclable: FilterId[],
  setActiveFilter: Dispatch<SetStateAction<FilterId>>
): void {
  useRegisterShortcuts('Coach', COACH_SHORTCUTS);
  const cyclableRef = useRef<FilterId[]>(['all']);
  useEffect(() => {
    cyclableRef.current = cyclable;
  }, [cyclable]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const filters = cyclableRef.current;
      if (filters.length === 0) return;
      setActiveFilter((curr) => {
        const idx = filters.indexOf(curr);
        return filters[(idx + 1) % filters.length];
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setActiveFilter]);
}
