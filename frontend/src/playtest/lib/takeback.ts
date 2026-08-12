/**
 * Takeback UX plumbing — the visible half of the multiplayer takeback
 * system. Builds on `@/lib/playtest/rewind`'s classifier without touching
 * it (that module is tested and landed; this one owns only the experience).
 *
 * `rewind.ts`'s `classifyAction` covers every `PlaytestAction` type, but
 * `game-log.ts` deliberately keeps several of them — taps, stickers,
 * counters, repositions, flips — out of the human-readable journal (see
 * game-log.test.ts: "does not log per-card taps, stickers, counters, or
 * repositions"). That journal is therefore NOT a 1:1 mirror of the
 * reducer's `state.past` undo stack, so it can't be the source of truth for
 * "how many steps are reachable" — undercounting there would mean this
 * control mis-describes (or mis-gates) the exact "tap something by
 * accident" case the feature exists for. `store.ts` instead maintains
 * `rewindTrail`, a parallel array aligned 1:1 with `state.past` (same
 * push/pop/reset lifecycle as the existing `resistancePast`), and this
 * module walks THAT.
 */
import { walkRewindable, type RewindVerdict } from '@/lib/playtest/rewind';

export interface RewindTrailEntry {
  verdict: RewindVerdict;
  reason: string;
  /** Human summary for this exact push — the game-log text it produced, or
   *  a Resistance response's own announcement. Null for the action types
   *  game-log.ts deliberately keeps out of the journal (see module doc). */
  summary: string | null;
}

export function trailEntry(
  classification: { verdict: RewindVerdict; reason: string },
  summary: string | null
): RewindTrailEntry {
  return { verdict: classification.verdict, reason: classification.reason, summary };
}

export type TakebackMode = 'ask' | 'free' | 'off';
export const TAKEBACK_MODES: readonly TakebackMode[] = ['ask', 'free', 'off'];

export const TAKEBACK_MODE_LABEL: Record<TakebackMode, string> = {
  ask: 'Ask',
  free: 'Free',
  off: 'Off',
};

export const TAKEBACK_MODE_DESCRIPTION: Record<TakebackMode, string> = {
  ask: 'Steps the table already saw need everyone’s OK before they’re taken back.',
  free: 'Trusted table — those steps apply the moment you take them back, no asking. Hidden information is still never returned to anyone.',
  off: 'No takebacks at all this game.',
};

const TAKEBACK_MODE_KEY = 'spellcontrol:playtest:takebackMode';

/** Device preference — same storage pattern as `loadFreeMulligan` /
 *  `loadLastResistanceLevel` (see store.ts / lib/resistance.ts). */
export function loadTakebackMode(): TakebackMode {
  try {
    const raw = localStorage.getItem(TAKEBACK_MODE_KEY);
    return raw === 'ask' || raw === 'free' || raw === 'off' ? raw : 'ask';
  } catch {
    return 'ask';
  }
}

export function saveTakebackMode(mode: TakebackMode): void {
  try {
    localStorage.setItem(TAKEBACK_MODE_KEY, mode);
  } catch {
    /* best-effort — storage unavailable/full */
  }
}

export interface TakebackReadout {
  /** What the very next takeback would be. 'none' means there is nothing to
   *  take back at all (a fresh game, or every reachable step already spent). */
  verdict: RewindVerdict | 'none';
  /** How many steps are reachable before hitting `boundary` (or the whole trail). */
  stepsAvailable: number;
  /** The wall, when there is one — the nearest-to-now `locked` entry. */
  boundary: RewindTrailEntry | null;
  /** The single next entry a takeback attempt would act on. */
  next: RewindTrailEntry | null;
}

export function readTakeback(trail: readonly RewindTrailEntry[]): TakebackReadout {
  // `trail` is newest-first (matches state.past/resistancePast's own
  // prepend convention) but `walkRewindable` expects oldest-first (matches
  // gameLog's append order) — reverse for the walk. Entry identity is
  // preserved, so `walk.boundary`/`trail[0]` below still point at the same
  // objects either way.
  const walk = walkRewindable([...trail].reverse());
  const verdict: RewindVerdict | 'none' =
    walk.stepsAvailable === 0
      ? walk.boundary
        ? 'locked'
        : 'none'
      : walk.firstConsentIndex === 0
        ? 'consent'
        : 'free';
  return {
    verdict,
    stepsAvailable: walk.stepsAvailable,
    boundary: walk.boundary,
    next: walk.stepsAvailable > 0 ? (trail[0] ?? null) : null,
  };
}

/** Grace window before a still-`pending` cross-seat request past its
 *  `expiresAt` is treated as locally expired even with no terminal frame
 *  from the server — native long-poll can drop a frame outright, which
 *  would otherwise strand the consent prompt or the requester's banner
 *  forever. Shared by `use-takeback.ts` (requester side) and
 *  `TakebackConsentPrompt.tsx` (approver side) so the two don't drift. */
export const TAKEBACK_EXPIRY_GRACE_MS = 2000;

export type TakebackPlan = 'apply' | 'request' | 'blocked';

/**
 * The single enforcement point for "a table setting can never bypass a
 * locked wall". `locked` (and `none`, nothing to act on) return `blocked`
 * unconditionally, before `mode` is even consulted — no other branch in
 * this function can reach `apply`/`request` for them, regardless of mode.
 */
export function resolveTakebackPlan(
  verdict: RewindVerdict | 'none',
  mode: TakebackMode,
  online: boolean
): TakebackPlan {
  if (verdict === 'locked' || verdict === 'none') return 'blocked';
  if (mode === 'off') return 'blocked';
  if (verdict === 'free') return 'apply';
  // consent
  if (!online) return 'apply'; // nobody to ask
  return mode === 'free' ? 'apply' : 'request';
}

const GENERIC_UNTRACKED_SUMMARY = 'a quick adjustment (tap, counter, sticker, or reposition)';

/** Human text for what a takeback of `entry` would undo — falls back to a
 *  generic phrase for the action types the visible journal omits (see the
 *  module doc); never invents specifics it doesn't have. */
export function takebackSummary(entry: RewindTrailEntry | null): string | null {
  if (!entry) return null;
  return entry.summary ?? GENERIC_UNTRACKED_SUMMARY;
}
