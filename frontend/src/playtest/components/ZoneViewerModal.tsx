import { useMemo, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { normalizeForSearch } from '@/lib/normalize-search';
import { SearchPill } from '@/components/SearchPill';
import type { PlaytestCard, Zone } from '@/lib/playtest';

interface Props {
  zone: Zone;
  cards: PlaytestCard[];
  /** When non-null, restricts the view to the top N cards (used for scry/reveal). */
  topN?: number;
  /** True if the source zone's order matters (library top is index 0). */
  ordered?: boolean;
  onClose(): void;
  onMove(cardId: string, to: Zone | 'battlefield'): void;
  onShuffleAfter?(): void;
}

const DESTINATIONS: Array<{ key: Zone | 'battlefield'; label: string }> = [
  { key: 'hand', label: 'Hand' },
  { key: 'battlefield', label: 'Battlefield' },
  { key: 'graveyard', label: 'Graveyard' },
  { key: 'exile', label: 'Exile' },
  { key: 'library', label: 'Library (bottom)' },
  { key: 'command', label: 'Command' },
];

export function ZoneViewerModal({
  zone,
  cards,
  topN,
  ordered,
  onClose,
  onMove,
  onShuffleAfter,
}: Props) {
  useLockBodyScroll();
  useEscapeKey(onClose);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    let pool = cards;
    if (topN != null) pool = ordered ? cards.slice(0, topN) : cards.slice(-topN);
    const nq = normalizeForSearch(filter);
    if (!nq) return pool;
    return pool.filter((c) => normalizeForSearch(c.name).includes(nq));
  }, [cards, filter, topN, ordered]);

  const titleLabel = topN != null ? `Top ${topN} of ${zone}` : zone;

  return (
    <div className="card-picker-root" role="presentation" onClick={onClose}>
      <div className="card-picker-backdrop" />
      <div
        className="card-picker-sheet playtest-zone-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${zone} viewer`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title playtest-zone-title">{titleLabel}</h2>
          {topN == null && (
            <SearchPill
              value={filter}
              onChange={setFilter}
              placeholder={`Search ${zone}…`}
              ariaLabel={`Search ${zone}`}
              autoFocus
            />
          )}
        </div>
        {visible.length === 0 ? (
          <p className="playtest-zone-empty">No cards.</p>
        ) : (
          <ul className="playtest-zone-grid">
            {visible.map((c) => (
              <li key={c.id} className="playtest-zone-card">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt={c.name} draggable={false} />
                ) : (
                  <div className="playtest-zone-card__placeholder">{c.name}</div>
                )}
                <div className="playtest-zone-card__name">{c.name}</div>
                <div className="playtest-zone-card__actions">
                  {DESTINATIONS.filter((d) => d.key !== zone).map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => onMove(c.id, d.key)}
                      className="playtest-zone-card__action"
                    >
                      → {d.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {onShuffleAfter && (
          <div className="card-picker-footer">
            <button type="button" className="btn btn-primary" onClick={onShuffleAfter}>
              Shuffle {zone} and close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
