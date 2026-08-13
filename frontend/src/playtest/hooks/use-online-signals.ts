import { useMemo } from 'react';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';

/**
 * Whether this device holds a seat in the currently active online game — the
 * same linkage condition `useOnlineTable` derives (`online` exists AND this
 * device's `userId` matches a seated player) — re-derived here rather than
 * composed from that hook because reactions/dice need only the seat check,
 * not the board-publish side effect or opponent-roster projection it also
 * does. Returns null in solo playtest (or online but unseated), in which
 * case callers render nothing — see ActionBar/DiceRoller/TableSignals.
 */
export function useOnlineSignals() {
  const online = usePlayStore((s) => s.online);
  const onlineSignal = usePlayStore((s) => s.onlineSignal);
  const sendSignal = usePlayStore((s) => s.sendSignal);
  const userId = useAuth((s) => s.user?.id ?? null);

  const mySeat = useMemo(() => {
    if (!online || userId == null) return null;
    return online.players.find((p) => p.userId === userId)?.seat ?? null;
  }, [online, userId]);

  return useMemo(() => {
    if (!online || mySeat == null) return null;
    return { online, mySeat, onlineSignal, sendSignal };
  }, [online, mySeat, onlineSignal, sendSignal]);
}
