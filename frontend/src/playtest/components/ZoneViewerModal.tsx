import { useMemo, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { normalizeForSearch } from '@/lib/normalize-search';
import { SearchPill } from '@/components/SearchPill';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS } from '../lib/zones';

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

// ZoneViewerModal's destination list extends the shared MOVE_DESTINATIONS with
// 'battlefield' (between 'hand' and 'graveyard'), since cards in a zone can be
// played directly onto the battlefield.
const DESTINATIONS: Array<{ key: Zone | 'battlefield'; label: string }> = [
  MOVE_DESTINATIONS[0], // hand
  { key: 'battlefield', label: 'Battlefield' },
  ...MOVE_DESTINATIONS.slice(1), // graveyard, exile, library (bottom), command
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
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
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
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-zone-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${zone} viewer`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
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
