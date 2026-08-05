import { useMemo, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { normalizeForSearch } from '@/lib/normalize-search';
import { SearchPill } from '@/components/SearchPill';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS, destinationKey } from '../lib/zones';

interface Props {
  zone: Zone;
  cards: PlaytestCard[];
  onClose(): void;
  onMove(cardId: string, to: Zone | 'battlefield', toIndex?: number): void;
  onShuffleAfter?(): void;
}

interface ViewerDestination {
  key: Zone | 'battlefield';
  label: string;
  toIndex?: number;
}

// ZoneViewerModal's destination list extends the shared MOVE_DESTINATIONS with
// 'battlefield' (between 'hand' and 'graveyard'), since cards in a zone can be
// played directly onto the battlefield.
const DESTINATIONS: ViewerDestination[] = [
  MOVE_DESTINATIONS[0], // hand
  { key: 'battlefield', label: 'Battlefield' },
  ...MOVE_DESTINATIONS.slice(1), // graveyard, exile, library (top/bottom), command
];

export function ZoneViewerModal({ zone, cards, onClose, onMove, onShuffleAfter }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const nq = normalizeForSearch(filter);
    if (!nq) return cards;
    return cards.filter((c) => normalizeForSearch(c.name).includes(nq));
  }, [cards, filter]);

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
          <h2 className="card-picker-title playtest-zone-title">{zone}</h2>
          <SearchPill
            value={filter}
            onChange={setFilter}
            placeholder={`Search ${zone}…`}
            ariaLabel={`Search ${zone}`}
            autoFocus
          />
        </div>
        {visible.length === 0 ? (
          <p className="playtest-zone-empty">No cards.</p>
        ) : (
          <ul className="playtest-zone-grid">
            {visible.map((c) => (
              <ZoneCard
                key={c.id}
                card={c}
                destinations={DESTINATIONS.filter((d) => d.key !== zone)}
                onMove={onMove}
              />
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

interface ZoneCardProps {
  card: PlaytestCard;
  destinations: ViewerDestination[];
  onMove(cardId: string, to: Zone | 'battlefield', toIndex?: number): void;
}

/**
 * One grid tile. Split out (rather than inlined in the `.map`) so each
 * card's broken-image fallback is local state on its own instance — and so
 * `content-visibility: auto` (set in CSS on `.playtest-zone-card`) can skip
 * layout/paint for the ~90-card case entirely off-screen without a
 * virtualization library.
 */
function ZoneCard({ card: c, destinations, onMove }: ZoneCardProps) {
  const [imgError, setImgError] = useState(false);
  return (
    <li className="playtest-zone-card">
      {c.imageUrl && !imgError ? (
        <img
          src={c.imageUrl}
          alt={c.name}
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="playtest-zone-card__placeholder">{c.name}</div>
      )}
      <div className="playtest-zone-card__name">{c.name}</div>
      <div className="playtest-zone-card__actions">
        {destinations.map((d) => (
          <button
            key={destinationKey(d)}
            type="button"
            onClick={() => onMove(c.id, d.key, d.toIndex)}
            className="playtest-zone-card__action"
          >
            → {d.label}
          </button>
        ))}
      </div>
    </li>
  );
}
