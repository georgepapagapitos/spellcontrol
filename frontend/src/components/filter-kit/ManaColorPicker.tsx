import type { ColorMatchMode } from '@spellcontrol/binder-routing';
import { IconButton } from '@/components/shared/Button';
import { SegmentedControl } from '@/components/shared/form';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { COLOR_NAMES, type ColorModeOption } from './color-modes';
import './filter-kit.css';

export interface ManaColorPickerProps {
  /** The picked color keys: any of W U B R G C M. */
  colors: readonly string[];
  onColorsChange: (next: string[]) => void;
  /** Offer Multicolor (M) after Colorless. */
  includeMulticolor?: boolean;
  mode: ColorMatchMode;
  modes: ColorModeOption[];
  onModeChange: (next: ColorMatchMode) => void;
  /** Names the pip group. */
  ariaLabel?: string;
  /** Names the mode control. */
  modeAriaLabel?: string;
  /** The sentence under the mode control; build it with `colorModeHint`. */
  hint?: string;
}

const BASE = ['W', 'U', 'B', 'R', 'G', 'C'];

/**
 * The color row and its match mode: mana-font pips (the same colored `ms-cost`
 * circles as everywhere else), each a 44px toggle, then a segmented mode
 * control of real radios and an optional live hint. Which colors are exclusive
 * (Colorless clearing the rest) is the surface's call, made in
 * `onColorsChange`.
 */
export function ManaColorPicker({
  colors,
  onColorsChange,
  includeMulticolor = false,
  mode,
  modes,
  onModeChange,
  ariaLabel = 'Filter by color',
  modeAriaLabel = 'How colors match',
  hint,
}: ManaColorPickerProps) {
  const keys = includeMulticolor ? [...BASE, 'M'] : BASE;
  return (
    <div className="filter-kit-color">
      <div className="filter-kit-pips" role="group" aria-label={ariaLabel}>
        {keys.map((k) => {
          const on = colors.includes(k);
          const name = COLOR_NAMES[k];
          return (
            <IconButton
              key={k}
              className="filter-kit-pip"
              aria-pressed={on}
              label={name.charAt(0).toUpperCase() + name.slice(1)}
              icon={<ColorPip color={k} />}
              onClick={() => onColorsChange(on ? colors.filter((c) => c !== k) : [...colors, k])}
            />
          );
        })}
      </div>
      <SegmentedControl
        ariaLabel={modeAriaLabel}
        value={mode}
        options={modes}
        onChange={onModeChange}
      />
      {hint !== undefined && (
        <p className="filter-kit-hint" aria-live="polite">
          {hint}
        </p>
      )}
    </div>
  );
}
