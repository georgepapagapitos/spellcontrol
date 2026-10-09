import type { ManaColor, PlaytestState, Zone } from '@/lib/playtest';
import type { MulliganType } from '@spellcontrol/game-core';

// Module-level constants, types and small helpers that PlaytestBoard used to
// declare above its component. Nothing here reads React or the DOM beyond
// localStorage.

/** The table's mulligan rule, said once in the opening-hand takeover. Same
 *  three variants as the lobby's own picker (`MULLIGAN_TYPES`). */
export const MULLIGAN_TABLE_NOTE: Record<MulliganType, string> = {
  commander: 'Table rule: the first mulligan is free.',
  london: 'Table rule: London mulligans.',
  free: 'Table rule: free mulligans. Nothing goes to the bottom.',
};

export type ViewerMode = { zone: Zone } | null;
export type ContextState = { cardId: string; x: number; y: number } | null;
/** The hand-card menu, which also serves a commander in the command zone. */
export type HandMenuState = {
  cardId: string;
  x: number;
  y: number;
  zone?: 'hand' | 'command';
} | null;

// Backfill for a session snapshot saved before the mana pool existed —
// `state.manaPool` is optional for exactly that reason (see types.ts).
export const ZERO_MANA_POOL: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** Desktop-density card box — matches playtest.css's base `--pt-card-w`/
 *  `--pt-card-h`. Used only as a fallback when the battlefield hasn't
 *  mounted yet (can't read the live custom property). */
export const FALLBACK_CARD_W = 90;
export const FALLBACK_CARD_H = 126;
/** Near-top-left placement used when a drop lands on the battlefield but
 *  dnd-kit couldn't report a translated rect (e.g. a keyboard-sensor drop) —
 *  the fraction-space analogue of the old fixed `x: 40, y: 40` pixel default. */
/** Stable empty roster: a fresh `[]` per render would re-run every memo that
 *  depends on the opponent list on every render of a solo board. */
export const NO_OPPONENTS: readonly [] = [];

export const FALLBACK_DROP_POS = { x: 0.05, y: 0.05 };

/** B6-16: the desktop keydown handler below is the actual implementation —
 *  this just makes those shortcuts discoverable via the app's `?` overlay. */
/** What the binding table doesn't own: two keys that open menus, not actions,
 *  and the wheel gesture that sizes the cards. */
export const FIXED_SHORTCUTS = [
  { keys: ['Shift+Enter'], description: 'Open the focused card’s menu' },
  { keys: ['Shift+F10'], description: 'Open the table menu' },
  { keys: ['Ctrl+Scroll'], description: 'Bigger or smaller cards' },
];

/** Which pile or hand a card that is off the battlefield sits in. */
export function zoneOfCard(zones: PlaytestState['zones'], cardId: string): Zone | undefined {
  return (Object.keys(zones) as Zone[]).find((z) => zones[z].some((c) => c.id === cardId));
}

export function parseDraggable(
  id: string
): { source: 'bf' | 'hand' | 'zone'; cardId: string } | null {
  const m = /^(bf|hand|zone):(.+)$/.exec(id);
  if (!m) return null;
  return { source: m[1] as 'bf' | 'hand' | 'zone', cardId: m[2] };
}

// ── Card size (wide tier) ───────────────────────────────────────────────────

const ZOOM_KEY = 'playtest-zoom-v1';
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;
/** Wheel travel per card-size step on ctrl + wheel: one mouse notch. */
export const WHEEL_STEP_PX = 100;

/** Within range, on the 0.1 grid the slider and the = / − keys use. */
export function clampZoom(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
}

export function readZoom(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 1;
  } catch {
    return 1;
  }
}

export function writeZoom(zoom: number): void {
  try {
    if (zoom === 1) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    // A remembered size is a convenience, never a requirement.
  }
}

// ── Hold hint ───────────────────────────────────────────────────────────────

const HOLD_HINT_KEY = 'spellcontrol:playtest:hold-hint-seen';

export function readHoldHintSeen(): boolean {
  try {
    return localStorage.getItem(HOLD_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeHoldHintSeen(): void {
  try {
    localStorage.setItem(HOLD_HINT_KEY, '1');
  } catch {
    // Blocked storage: the hint goes for this session and shows again next.
  }
}
