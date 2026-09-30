import { useThemeStore } from '@/store/theme';
import { THEMES } from '@/lib/account/themes';
import { TypeSetPicker } from '@/components/settings/TypeSetPicker';
import { SettingsSection } from '@/components/settings/SettingsSection';

/** Colour theme and type set: the two looks of the whole app, on this device. */
export function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <>
      <SettingsSection id="settings-appearance-title" title="Theme">
        <fieldset className="settings-theme-grid" aria-label="Choose theme">
          {THEMES.map((t) => (
            <label
              key={t.id}
              className={`settings-theme-option${t.id === theme ? ' is-active' : ''}`}
            >
              <input
                type="radio"
                name="theme"
                value={t.id}
                checked={t.id === theme}
                onChange={() => setTheme(t.id)}
                className="settings-theme-radio"
              />
              <span
                className="settings-theme-swatch"
                aria-hidden="true"
                style={{
                  background: `linear-gradient(135deg, ${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 100%)`,
                }}
              />
              <span className="settings-theme-name">{t.name}</span>
              <span className="settings-theme-guild">{t.guild}</span>
            </label>
          ))}
        </fieldset>
      </SettingsSection>

      <SettingsSection id="settings-typeface-title" title="Typeface">
        <TypeSetPicker />
      </SettingsSection>
    </>
  );
}
