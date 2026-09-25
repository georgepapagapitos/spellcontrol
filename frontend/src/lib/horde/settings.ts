/**
 * Horde mode difficulty presets (see docs/board.json E-horde / PR series).
 *
 * The horde is a self-running deck: no hand, no lands, no decisions. A
 * `HordeLevel` picks the shape of the fight (life pool, library size, setup
 * turns, how fast the horde reveals cards, when bosses show up, how gentle
 * the opening draws are) for a given survivor count; `overrides` is the
 * "Customise" panel layered on top.
 *
 * The settings TYPES themselves live in `@spellcontrol/game-core` (the
 * online co-op table stores a resolved `HordeSettings` in `GameState.horde`)
 * and are re-exported here under their original names so nothing else in the
 * frontend needs to change. Only the functions below are local.
 */

export type { HordeLevel, HordeSettings } from '@/lib/game-state';
import type { HordeRevealMode, HordeSafeZone, HordeLevel, HordeSettings } from '@/lib/game-state';
export type RevealMode = HordeRevealMode;
export type SafeZone = HordeSafeZone;

/** Library size by survivor count (index 0 = 1 survivor). */
const BASE_LIBRARY_SIZE = [50, 65, 80, 100];

/** Default wave pattern for `waves-pattern` reveal mode when none is given. */
export const DEFAULT_WAVE_PATTERN = [1, 2, 3, 2];

function presetFor(level: HordeLevel, survivors: number): HordeSettings {
  const baseLife = 40 + 20 * (survivors - 1);
  const baseSize = BASE_LIBRARY_SIZE[survivors - 1];

  switch (level) {
    case 'casual':
      return {
        survivors,
        life: baseLife + 10 * survivors,
        librarySize: Math.round(baseSize * 0.8),
        setupTurns: 3,
        reveal: { kind: 'until-nontoken' },
        bossTicks: [],
        safeZone: 'full',
      };
    case 'brutal':
      return {
        survivors,
        life: baseLife,
        librarySize: Math.round(baseSize * 1.2),
        setupTurns: 2,
        reveal: { kind: 'waves', perTurn: 2 },
        bossTicks: [0.25, 0.5, 0.75, 1],
        safeZone: 'off',
      };
    case 'standard':
    default:
      return {
        survivors,
        life: baseLife,
        librarySize: baseSize,
        setupTurns: 3,
        reveal: { kind: 'until-nontoken' },
        bossTicks: [0.5, 1],
        safeZone: 'reduced',
      };
  }
}

/** Resolve a level + survivor count into concrete settings, with `overrides`
 *  (the Customise panel) winning field-by-field. `survivors` is clamped to
 *  1..4 before the preset math runs. */
export function resolveHordeSettings(
  level: HordeLevel,
  survivors: number,
  overrides?: Partial<HordeSettings>
): HordeSettings {
  const n = Math.max(1, Math.min(4, Math.round(survivors)));
  return { ...presetFor(level, n), ...overrides };
}
