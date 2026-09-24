/**
 * Horde mode difficulty presets (see docs/board.json E-horde / PR series).
 *
 * The horde is a self-running deck: no hand, no lands, no decisions. A
 * `HordeLevel` picks the shape of the fight (life pool, library size, setup
 * turns, how fast the horde reveals cards, when bosses show up, how gentle
 * the opening draws are) for a given survivor count; `overrides` is the
 * "Customise" panel layered on top.
 */

export type HordeLevel = 'casual' | 'standard' | 'brutal';

export type RevealMode =
  /** Reveal until the first nontoken card, inclusive — one wave. */
  | { kind: 'until-nontoken' }
  /** That same wave, repeated `perTurn` times each horde turn. */
  | { kind: 'waves'; perTurn: number }
  /** Waves per horde turn, cycling through `pattern` by horde-turn index. */
  | { kind: 'waves-pattern'; pattern: number[] }
  /** Battle the Horde style: a flat count, +1 per horde artifact if set. */
  | { kind: 'fixed'; count: number; plusPerArtifact?: boolean };

export type SafeZone = 'full' | 'reduced' | 'off';

export interface HordeSettings {
  /** 1..4. */
  survivors: number;
  /** Survivors' shared starting life. */
  life: number;
  /** Cards in this game's library — bosses are held out separately. */
  librarySize: number;
  /** Survivor turns before the horde's first turn. */
  setupTurns: number;
  reveal: RevealMode;
  /** Fractions of the library gone at which a boss enters (1 = library empty). */
  bossTicks: number[];
  safeZone: SafeZone;
}

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
