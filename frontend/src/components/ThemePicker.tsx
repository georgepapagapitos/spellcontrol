import { useEffect, useRef, useState } from 'react';
import { THEMES } from '../lib/themes';
import { useThemeStore } from '../store/theme';

export function ThemePicker({ variant = 'default' }: { variant?: 'default' | 'tab' } = {}) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  const isTab = variant === 'tab';

  return (
    <div className={`theme-picker${isTab ? ' theme-picker--tab' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={isTab ? 'mobile-tab-bar-link theme-picker-tab-trigger' : 'theme-picker-trigger'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Theme: ${active.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Swatch colors={active.swatch} />
        {isTab ? (
          <span className="mobile-tab-bar-label">Theme</span>
        ) : (
          <span className="theme-picker-trigger-label">{active.name}</span>
        )}
      </button>
      {open && (
        <ul className="theme-picker-menu" role="listbox" aria-label="Choose theme">
          {THEMES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-picker-option${t.id === theme ? ' is-active' : ''}`}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
              >
                <Swatch colors={t.swatch} />
                <span className="theme-picker-option-name">{t.name}</span>
                <span className="theme-picker-option-guild">{t.guild}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Swatch({ colors }: { colors: [string, string] }) {
  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={{ background: `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)` }}
    />
  );
}
