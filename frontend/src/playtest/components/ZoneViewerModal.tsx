import { useMemo, useState } from 'react';
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
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    let pool = cards;
    if (topN != null) pool = ordered ? cards.slice(0, topN) : cards.slice(-topN);
    const q = filter.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((c) => c.name.toLowerCase().includes(q));
  }, [cards, filter, topN, ordered]);

  const titleLabel = topN != null ? `Top ${topN} of ${zone}` : zone;

  return (
    <div className="playtest-modal" role="dialog" aria-modal="true" aria-label={`${zone} viewer`}>
      <div className="playtest-modal__backdrop" onClick={onClose} />
      <div className="playtest-modal__panel">
        <div className="playtest-modal__header">
          <h2>{titleLabel}</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {topN == null && (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${zone}…`}
            className="playtest-modal__search"
            autoFocus
          />
        )}
        {visible.length === 0 ? (
          <p className="playtest-modal__empty">No cards.</p>
        ) : (
          <ul className="playtest-modal__grid">
            {visible.map((c) => (
              <li key={c.id} className="playtest-modal__card">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt={c.name} draggable={false} />
                ) : (
                  <div className="playtest-modal__placeholder">{c.name}</div>
                )}
                <div className="playtest-modal__card-name">{c.name}</div>
                <div className="playtest-modal__actions">
                  {DESTINATIONS.filter((d) => d.key !== zone).map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => onMove(c.id, d.key)}
                      className="playtest-modal__action"
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
          <div className="playtest-modal__footer">
            <button type="button" onClick={onShuffleAfter}>
              Shuffle {zone} and close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
