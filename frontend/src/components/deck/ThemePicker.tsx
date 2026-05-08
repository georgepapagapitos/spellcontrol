import { useEffect, useMemo, useState } from 'react';
import { fetchCommanderThemes } from '@/deck-builder/services/edhrec/client';
import type { EDHRECTheme } from '@/deck-builder/types';

const COLLAPSED_COUNT = 6;

interface ThemePickerProps {
  commanderName: string;
  selectedSlugs: Set<string>;
  onToggle: (theme: EDHRECTheme) => void;
}

export function ThemePicker({ commanderName, selectedSlugs, onToggle }: ThemePickerProps) {
  const [themes, setThemes] = useState<EDHRECTheme[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    setThemes(null);
    setShowAll(false);
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
    <ThemePickerList
      themes={themes}
      selectedSlugs={selectedSlugs}
      onToggle={onToggle}
      showAll={showAll}
      setShowAll={setShowAll}
    />
  );
}

function ThemePickerList({
  themes,
  selectedSlugs,
  onToggle,
  showAll,
  setShowAll,
}: {
  themes: EDHRECTheme[];
  selectedSlugs: Set<string>;
  onToggle: (theme: EDHRECTheme) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
}) {
  // Always render selected themes alongside the top-N, even when their
  // deck count would normally place them below the fold. Users picking
  // a niche theme should still see it pinned in the visible row.
  const visible = useMemo(() => {
    if (showAll) return themes;
    const top = themes.slice(0, COLLAPSED_COUNT);
    const topSlugs = new Set(top.map((t) => t.slug));
    const pinned = themes.filter((t) => selectedSlugs.has(t.slug) && !topSlugs.has(t.slug));
    return [...top, ...pinned];
  }, [themes, showAll, selectedSlugs]);

  const hidden = themes.length - visible.length;

  return (
    <section className="deck-builder-section">
      <h2 className="deck-builder-section-title">Themes</h2>
      <p className="deck-builder-themes-hint">
        Pick any themes the deck should lean into. Themes guide the EDHREC card pool.
      </p>
      <div className="deck-builder-theme-chips">
        {visible.map((theme) => {
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
        {!showAll && hidden > 0 && (
          <button
            type="button"
            className="theme-chip theme-chip-more"
            onClick={() => setShowAll(true)}
          >
            Show all ({themes.length})
          </button>
        )}
        {showAll && themes.length > COLLAPSED_COUNT && (
          <button
            type="button"
            className="theme-chip theme-chip-more"
            onClick={() => setShowAll(false)}
          >
            Show fewer
          </button>
        )}
      </div>
    </section>
  );
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
