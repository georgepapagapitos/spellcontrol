import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { PRESET_COLORS } from '../lib/preset-colors';

interface Props {
  value: string;
  onChange: (hex: string) => void;
  /** Optional aria-label for the radiogroup. */
  ariaLabel?: string;
}

export function ColorPicker({ value, onChange, ariaLabel }: Props) {
  // Radios group by shared `name`, so each mounted picker needs its own —
  // two pickers on one page (binder color + list color) would otherwise be
  // one group and deselect each other.
  const groupName = useId();
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
      {/* Native radios, not `role="radio"` buttons: they carry exclusivity,
          arrow-key nav and a single group tab stop for free. As ARIA-only
          buttons this group announced "radio group, 1 of N" and then ignored
          the arrow keys, and every swatch was its own tab stop.
          The custom-color control stays a <button> — it opens a panel, it
          isn't one of the mutually exclusive values. */}
      <fieldset className="color-picker" aria-label={ariaLabel}>
        {PRESET_COLORS.map((c) => (
          <label key={c.hex} className="color-swatch-option" title={c.name}>
            <input
              type="radio"
              name={groupName}
              checked={value === c.hex}
              onChange={() => {
                onChange(c.hex);
                setShowCustom(false);
              }}
              aria-label={c.name}
            />
            <span
              className={`color-swatch${value === c.hex ? ' selected' : ''}`}
              style={{ background: c.hex }}
            />
          </label>
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
      </fieldset>
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
