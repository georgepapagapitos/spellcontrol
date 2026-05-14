import { Plus } from 'lucide-react';
import { useState } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { PRESET_COLORS } from '../lib/preset-colors';

interface Props {
  value: string;
  onChange: (hex: string) => void;
  /** Optional aria-label for the radiogroup. */
  ariaLabel?: string;
}

export function ColorPicker({ value, onChange, ariaLabel }: Props) {
  const isCustom = !PRESET_COLORS.some((c) => c.hex === value);
  const [showCustom, setShowCustom] = useState(isCustom);
  // Sync the panel open when the value transitions to an off-preset hex (e.g.
  // the parent loads a saved custom color). Done as a render-phase compare to
  // avoid the cascading-render lint of doing setState inside useEffect.
  const [prevIsCustom, setPrevIsCustom] = useState(isCustom);
  if (isCustom !== prevIsCustom) {
    setPrevIsCustom(isCustom);
    if (isCustom) setShowCustom(true);
  }

  return (
    <div className="color-picker-wrapper">
      <div className="color-picker" role="radiogroup" aria-label={ariaLabel}>
        {PRESET_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={value === c.hex}
            className={`color-swatch${value === c.hex ? ' selected' : ''}`}
            style={{ background: c.hex }}
            onClick={() => {
              onChange(c.hex);
              setShowCustom(false);
            }}
            title={c.name}
            aria-label={c.name}
          />
        ))}
        <button
          type="button"
          className={`color-swatch color-swatch-custom${isCustom ? ' selected' : ''}`}
          style={isCustom ? { background: value } : undefined}
          onClick={() => setShowCustom((v) => !v)}
          aria-expanded={showCustom}
          aria-label="Custom color"
          title="Custom color"
        >
          <Plus
            className="color-swatch-custom-icon"
            width={14}
            height={14}
            strokeWidth={2}
            aria-hidden
          />
        </button>
      </div>
      {showCustom && (
        <div className="color-picker-custom-panel">
          <HexColorPicker color={value} onChange={onChange} />
          <div className="color-picker-hex-row">
            <span className="color-picker-hex-hash" aria-hidden>
              #
            </span>
            <HexColorInput
              className="color-picker-hex-input"
              color={value}
              onChange={onChange}
              prefixed={false}
              aria-label="Hex color"
            />
          </div>
        </div>
      )}
    </div>
  );
}
