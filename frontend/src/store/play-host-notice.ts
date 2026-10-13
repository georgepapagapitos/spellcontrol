import type { GameState } from '@spellcontrol/game-core';
import { useAuth } from './auth';
import { toast } from './toasts';

const LAST_HOST_KEY = 'sc-play-last-host';
/** Games remembered at once; the oldest fall off so the map can't grow without bound. */
const LAST_HOST_LIMIT = 20;

function readLastHosts(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(LAST_HOST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string | null>) : {};
  } catch {
    return {};
  }
}

function writeLastHost(code: string, host: string | null): void {
  try {
    const all = readLastHosts();
    delete all[code];
    all[code] = host;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - LAST_HOST_LIMIT))) delete all[k];
    localStorage.setItem(LAST_HOST_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the notice is a courtesy, never block the table on it */
  }
}

/**
 * Tell a seated player once when the host changes (E430 handover, E451
 * takeover). The claimant hears "You're the host now."; a returning old host
 * hears who took over; everyone else hears who the host is now. The baseline
 * is the host this device last saw for the game: the in-memory `before` when
 * we have it, else a small per-game record in localStorage that survives a
 * reload. A game this device never saw has no baseline, so it stays silent.
 */
export function announceHostChange(fresh: GameState, before?: GameState | null): void {
  const me = useAuth.getState().user?.id;
  const known = before && before.code === fresh.code ? before.hostUserId : undefined;
  const last = known !== undefined ? known : readLastHosts()[fresh.code];
  if (last !== fresh.hostUserId) writeLastHost(fresh.code, fresh.hostUserId);
  const host = fresh.hostUserId;
  if (!me || last === undefined || last === host || host === null) return;
  if (host === me) {
    toast.show({ message: "You're the host now.", tone: 'info' });
    return;
  }
  const seated = fresh.players.some((p) => p.userId === me);
  if (!seated && last !== me) return;
  const name = fresh.players.find((p) => p.userId === host)?.name ?? 'Someone';
  toast.show({
    message: last === me ? `${name} took over as host.` : `${name} is the host now.`,
    tone: 'info',
  });
}
