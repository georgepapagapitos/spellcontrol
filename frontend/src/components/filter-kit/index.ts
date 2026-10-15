/**
 * The filter kit (STYLE_GUIDE § Filter kit): one control per kind of value,
 * for every filter surface. The active-filter row is the shared
 * `FilterChipsRow`, re-exported here as `ActiveFilterStrip` so a dialog
 * reaches the whole kit from one import; it needed no in-dialog variant.
 */
export { FilterChipsRow as ActiveFilterStrip } from '@/components/shared/FilterChipsRow';
export type { FilterChipDescriptor } from '@/components/shared/FilterChipsRow';
export { FilterSection } from './FilterSection';
export { ChoiceChips } from './ChoiceChips';
export type { ChoiceChipsProps, ChoiceOption } from './ChoiceChips';
export { ManaColorPicker } from './ManaColorPicker';
export type { ManaColorPickerProps } from './ManaColorPicker';
export { COLOR_MODE_LABELS, colorModeHint, colorModeOptions } from './color-modes';
export type { ColorModeKey, ColorModeOption } from './color-modes';
export { ValueStrip } from './ValueStrip';
export type { ValueStripProps } from './ValueStrip';
export { EMPTY_VALUE_STRIP, isValueStripRange, valueStripCount } from './value-strip';
export type { ValueStripChips, ValueStripRange, ValueStripValue } from './value-strip';
export { PresetRange } from './PresetRange';
export type { PresetRangeProps, PresetRangeValue, RangePreset } from './PresetRange';
export { ManaSymbolPad } from './ManaSymbolPad';
export type { ManaSymbolPadProps } from './ManaSymbolPad';
export {
  EMPTY_MANA_COST,
  PAD_SYMBOLS,
  flagOn,
  manaCostCount,
  manaCostSummary,
  toggleFlag,
} from './mana-cost';
export type { ManaCostFilter, PadSymbol } from './mana-cost';
export { ShowResultsButton } from './ShowResultsButton';
export type { ShowResultsButtonProps } from './ShowResultsButton';
