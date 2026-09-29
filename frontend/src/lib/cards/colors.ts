/**
 * Re-export shim — color grouping now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth, shared with
 * the backend's shared-binder projections). Import paths stay stable.
 */
export {
  getColorPalette,
  getColorKey,
  isLand,
  COLOR_INFO,
  COLOR_ORDER,
  colorSelectionMatches,
  type ColorMatchMode,
} from '@spellcontrol/binder-routing';
import { COLOR_INFO } from '@spellcontrol/binder-routing';

/**
 * The WUBRG+C pip row every color filter renders, in canonical Magic order.
 *
 * One list, because three popovers (decks, discover, combos) each carried a
 * byte-identical private copy — and a private copy is how a fourth surface ends
 * up spelling "Colorless" differently or dropping a color.
 */
export const FILTER_COLOR_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

/** "Mono-white", "White and blue", "White, blue and black", "Colorless". */
export function colorIdentityWords(colors: string[]): string {
  const names = colors.map((k) => (COLOR_INFO[k]?.label ?? k).toLowerCase());
  if (names.length === 0) return 'Colorless';
  if (names.length === 1) return `Mono-${names[0]}`;
  const list =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return list.charAt(0).toUpperCase() + list.slice(1);
}
