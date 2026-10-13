import { useMemo, useState } from 'react';
import { Chip } from '@/components/shared/Chip';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import type { Change } from '@/lib/coach/deck-change';
import { deriveLeanThemes, leanRank, type LeanTheme } from '@/lib/coach/lean-into';

export type LeanProfile = CommanderProfile | null;

/**
 * E260 "Lean into": themes the visible rows serve, and those rows re-ordered
 * (each with a `leanNote` naming the theme it serves) once one is chosen.

 * It never reaches the AI refine pool (its names feed hashRefineInput), so it spends no reading.
 * Themes are read from the rows the player can see, so a chip never promises
 * rows that are not there. Cuts are never offered or moved.
 */
export function useLeanInto<T extends { change: Change }>(
  rows: T[],
  isCutsLane: boolean,
  profile: LeanProfile
) {
  const [id, setId] = useState<string | null>(null);
  return useMemo(() => {
    const changes = isCutsLane ? [] : rows.map((r) => r.change);
    const themes = deriveLeanThemes(changes, profile);
    const strip = { themes, activeId: id, onChange: setId };
    const active = themes.find((t) => t.id === id);
    if (!active) return { strip, rows };
    const ranked = leanRank(rows, active.id, changes, profile);
    return {
      strip,
      rows: ranked.rows.map((r) => {
        const leanNote = ranked.notes.get(r.change.id);
        return leanNote ? { ...r, change: { ...r.change, leanNote } } : r;
      }),
    };
  }, [rows, isCutsLane, id, profile]);
}

/**
 * E260: the free "Lean into <theme>" lever on the Coach feed. Chips reuse the
 * feed's `.filter-chip`; the hint says it costs nothing (or what the chosen
 * theme did). Renders nothing when no visible row serves a theme.
 */
export function CoachLeanStrip({
  themes,
  activeId,
  onChange,
}: {
  themes: LeanTheme[];
  activeId: string | null;
  onChange: (id: string | null) => void;
}) {
  if (themes.length === 0) return null;
  const active = themes.find((t) => t.id === activeId) ?? null;
  return (
    <div className="coach-feed-lean">
      <div className="coach-feed-lean-chips" role="group" aria-label="Lean into a theme">
        <span className="coach-feed-lean-label">Lean into</span>
        {themes.map((t) => (
          <Chip
            key={t.id}
            className="filter-chip"
            pressed={activeId === t.id}
            onClick={() => onChange(activeId === t.id ? null : t.id)}
            trailing={<span className="coach-feed-chip-count">{t.count}</span>}
          >
            {t.label}
          </Chip>
        ))}
      </div>
      <p className="coach-feed-lean-hint">
        {active
          ? `${active.count} suggestion${active.count === 1 ? '' : 's'} that serve ${active.label.toLowerCase()} now come first.`
          : "Free. Re-orders this list and doesn't use an AI reading."}
      </p>
    </div>
  );
}
