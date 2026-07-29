import { useEffect, useMemo, useState } from 'react';
import { fetchCommanderThemes } from '@/deck-builder/services/edhrec/client';
import type { EDHRECTheme } from '@/deck-builder/types';

const COLLAPSED_COUNT = 6;
const EXPAND_STEP = 8;

interface ThemePickerProps {
  commanderName: string;
  selectedSlugs: Set<string>;
  onToggle: (theme: EDHRECTheme) => void;
}

export function ThemePicker({ commanderName, selectedSlugs, onToggle }: ThemePickerProps) {
  const [themes, setThemes] = useState<EDHRECTheme[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [visibleCount, setVisibleCount] = useState(COLLAPSED_COUNT);
  // Bumped by Retry to re-run the fetch effect. EDHREC is a third-party
  // service and this is its only failure surface here.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!cancelled) {
        setLoading(true);
        setErrored(false);
        setThemes(null);
        setVisibleCount(COLLAPSED_COUNT);
      }
      try {
        const list = await fetchCommanderThemes(commanderName);
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
        setThemes(sorted);
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [commanderName, reloadKey]);

  if (loading) {
    return (
      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Themes</h2>
        <p className="deck-builder-themes-status">Loading themes…</p>
      </section>
    );
  }

  // A failed fetch used to render nothing at all, so the Themes section simply
  // vanished — indistinguishable from "this commander has no themes", with no
  // way to try again. An empty result still renders nothing, because that IS
  // the honest empty state.
  if (errored) {
    return (
      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Themes</h2>
        <p className="deck-builder-themes-status">
          Couldn’t load themes.{' '}
          <button
            type="button"
            className="deck-builder-themes-retry"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </p>
      </section>
    );
  }

  if (!themes || themes.length === 0) {
    return null;
  }

  return (
    <ThemePickerList
      themes={themes}
      selectedSlugs={selectedSlugs}
      onToggle={onToggle}
      visibleCount={visibleCount}
      setVisibleCount={setVisibleCount}
    />
  );
}

function ThemePickerList({
  themes,
  selectedSlugs,
  onToggle,
  visibleCount,
  setVisibleCount,
}: {
  themes: EDHRECTheme[];
  selectedSlugs: Set<string>;
  onToggle: (theme: EDHRECTheme) => void;
  visibleCount: number;
  setVisibleCount: (updater: (prev: number) => number) => void;
}) {
  // Always render selected themes alongside the top-N, even when their
  // deck count would normally place them below the fold. Users picking
  // a niche theme should still see it pinned in the visible row.
  const visible = useMemo(() => {
    const top = themes.slice(0, visibleCount);
    const topSlugs = new Set(top.map((t) => t.slug));
    const pinned = themes.filter((t) => selectedSlugs.has(t.slug) && !topSlugs.has(t.slug));
    return [...top, ...pinned];
  }, [themes, visibleCount, selectedSlugs]);

  const remaining = Math.max(0, themes.length - visibleCount);
  const nextStep = Math.min(EXPAND_STEP, remaining);

  return (
    <section className="deck-builder-section">
      <h2 className="deck-builder-section-title">Themes</h2>
      <p className="deck-builder-themes-hint">
        {selectedSlugs.size === 0
          ? "No theme selected — we'll build from this commander's overall top cards."
          : 'Pick any themes the deck should lean into. Themes guide the EDHREC card pool.'}
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
              <span className="theme-chip-name card-name-chip-text" title={theme.name}>
                {theme.name}
              </span>
              <span className="theme-chip-count">{formatCount(theme.count)} decks</span>
            </button>
          );
        })}
        {remaining > 0 && (
          <button
            type="button"
            className="theme-chip theme-chip-more"
            onClick={() => setVisibleCount((prev) => prev + EXPAND_STEP)}
          >
            Show {nextStep} more ({remaining} left)
          </button>
        )}
        {visibleCount > COLLAPSED_COUNT && (
          <button
            type="button"
            className="theme-chip theme-chip-more"
            onClick={() => setVisibleCount(() => COLLAPSED_COUNT)}
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
