import { useSyncExternalStore } from 'react';
import { getPushProgress, onSyncedChange, type PushProgress } from './sync';

/**
 * Slice progress of a chunked server push (a big import saving to the
 * account), or null when none is running. Re-renders on every sync event so
 * the surface showing it advances with each /api/sync round trip.
 */
export function usePushProgress(): PushProgress | null {
  return useSyncExternalStore(onSyncedChange, getPushProgress, getPushProgress);
}
