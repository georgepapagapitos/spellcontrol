import { useEffect, useState } from 'react';
import { fetchCommanderThemes } from '@/deck-builder/services/edhrec/client';
import type { EDHRECTheme } from '@/deck-builder/types';

interface ThemePickerProps {
  commanderName: string;
  selectedSlugs: Set<string>;
  onToggle: (theme: EDHRECTheme) => void;
}

export function ThemePicker({ commanderName, selectedSlugs, onToggle }: ThemePickerProps) {
  const [themes, setThemes] = useState<EDHRECTheme[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    setThemes(null);
    fetchCommanderThemes(commanderName)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
        setThemes(sorted);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [commanderName]);

  if (loading) {
    return (
      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Themes</h2>
        <p className="deck-builder-themes-status">Loading themes…</p>
      </section>
    );
  }

  if (errored || !themes || themes.length === 0) {
    return null;
  }

  return (
    <section className="deck-builder-section">
      <h2 className="deck-builder-section-title">Themes</h2>
      <p className="deck-builder-themes-hint">
        Pick any themes the deck should lean into. Themes guide the EDHREC card pool.
      </p>
      <div className="deck-builder-theme-chips">
        {themes.map((theme) => {
          const active = selectedSlugs.has(theme.slug);
          return (
            <button
              key={theme.slug}
              type="button"
              className={`theme-chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onToggle(theme)}
            >
              <span className="theme-chip-name">{theme.name}</span>
              <span className="theme-chip-count">{formatCount(theme.count)} decks</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
