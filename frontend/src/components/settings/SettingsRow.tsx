import type { ReactNode } from 'react';

interface SettingsRowProps {
  label?: ReactNode;
  value?: ReactNode;
  /** Adds the InfoTip-spacing modifier — set when `value` renders an inline
      InfoTip trigger after its text. */
  valueWithTip?: boolean;
  hint?: ReactNode;
  /** Right-hand control(s) — a button, a Link styled as one, a status
      indicator. */
  actions?: ReactNode;
  /** Escape hatch for a row whose body isn't a plain label/value/hint triple
      (the theme swatch grid, the currency radio fieldset). */
  children?: ReactNode;
}

/** One `.settings-row`: label/value/hint text on the left, an action on the
    right. Wraps the settings-sync.css row classes — see SettingsSection. */
export function SettingsRow({
  label,
  value,
  valueWithTip,
  hint,
  actions,
  children,
}: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        {label && <div className="settings-row-label">{label}</div>}
        {value && (
          <div
            className={
              valueWithTip
                ? 'settings-row-value settings-row-value--with-tip'
                : 'settings-row-value'
            }
          >
            {value}
          </div>
        )}
        {hint && <div className="settings-row-hint">{hint}</div>}
        {children}
      </div>
      {actions}
    </div>
  );
}
