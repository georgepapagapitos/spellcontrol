import type { ReactNode } from 'react';

interface SettingsSectionProps {
  /** Heading id — register in YouPage's `SECTION_HEADING_IDS` if it should
      also be a `?section=` scroll/focus target. */
  id: string;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * One `.settings-card` panel: title + optional hint + a body of rows. Wraps
 * the settings-sync.css classes so call sites stop hand-rolling the same
 * header/body markup, which is how the page's heading treatment drifted
 * (some sections went sr-only, some visible) in the first place.
 */
export function SettingsSection({ id, title, hint, children }: SettingsSectionProps) {
  return (
    <section className="settings-card" aria-labelledby={id}>
      <header className="settings-card-header">
        <h2 id={id} className="settings-card-title">
          {title}
        </h2>
        {hint && <p className="settings-card-hint">{hint}</p>}
      </header>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}
