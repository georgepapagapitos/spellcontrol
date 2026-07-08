import type { GameFormat } from './game-state';

/**
 * The Play tab's local/online game formats — single source of truth so a
 * game night's optional format field (and the "Start game" seed) can reuse
 * the same ids/labels instead of inventing a second list. Lives here (not in
 * PlayPage.tsx) so components/play/GameNights.tsx and pages/GameNightView.tsx
 * can import it without a circular import with PlayPage.
 */
export interface FormatOption {
  value: GameFormat;
  label: string;
  defaultLife: number;
  cmdDmg: boolean;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'commander', label: 'Commander', defaultLife: 40, cmdDmg: true },
  { value: 'brawl', label: 'Brawl', defaultLife: 25, cmdDmg: false },
  { value: 'standard', label: 'Standard', defaultLife: 20, cmdDmg: false },
  { value: 'modern', label: 'Modern', defaultLife: 20, cmdDmg: false },
  { value: 'pioneer', label: 'Pioneer', defaultLife: 20, cmdDmg: false },
  { value: 'legacy', label: 'Legacy', defaultLife: 20, cmdDmg: false },
  { value: 'vintage', label: 'Vintage', defaultLife: 20, cmdDmg: false },
  { value: 'pauper', label: 'Pauper', defaultLife: 20, cmdDmg: false },
  { value: 'casual', label: 'Casual', defaultLife: 20, cmdDmg: false },
];

/** The local game setup's player-count ceiling (also the "Start game" seed cap). */
export const MAX_LOCAL_PLAYERS = 6;
export const MIN_LOCAL_PLAYERS = 2;

/** Display label for a stored format id, or the raw value if it's unknown. */
export function gameFormatLabel(format: string | null): string | null {
  if (!format) return null;
  return FORMAT_OPTIONS.find((f) => f.value === format)?.label ?? format;
}
