import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { TaxCoins } from './TaxCoins';

interface Props {
  zones: Record<Zone, PlaytestCard[]>;
  commanderTax: Record<string, number>;
  /** The commanders whose tax rides on the command tile as coins, the same
   *  coins the table's command pile carries (see `TaxCoins`). They show while
   *  a commander is on the battlefield too, which is when the tax matters. */
  taxCards: PlaytestCard[];
  onAdjustTax(cardId: string, delta: 1 | -1): void;
  /** Cards exiled face down: one on top shows the card back, as ZonePile does. */
  hiddenIds?: ReadonlySet<string>;
  onOpenZone(zone: Zone): void;
  /**
   * Open this zone's menu. The same list of items the table tier's pile
   * menu carries, rendered by the same component as a bottom sheet — a
   * phone has no right-click, but it has no reason to be offered fewer
   * actions either. The drawer closes behind it: a sheet over a drawer is
   * two dismissals deep, and the drawer is one tap to reopen.
   */
  onMenu(zone: Zone): void;
}

interface ZoneEntry {
  key: Zone;
  label: string;
  cards: PlaytestCard[];
  peek: 'top' | 'back';
}

export function MobileZonesPanel({
  zones,
  commanderTax,
  taxCards,
  onAdjustTax,
  hiddenIds,
  onOpenZone,
  onMenu,
}: Props) {
  const [open, setOpen] = useState(false);
  // Per-zone map of a top-card id whose image failed, so a new top card
  // always gets a fresh chance to load (mirrors ZonePile).
  const [erroredIds, setErroredIds] = useState<Partial<Record<Zone, string>>>({});

  // The two zones the phone's corner row has no width for. The library and
  // the graveyard stand on the felt beside the hand (PlaytestBoard `piles`),
  // because they are the two you touch every turn; these two are a tap away
  // instead of a scroll away, which is the trade a 400px screen forces.
  const entries: ZoneEntry[] = [
    { key: 'exile', label: 'Exile', cards: zones.exile, peek: 'top' },
    { key: 'command', label: 'Command', cards: zones.command, peek: 'top' },
  ];

  return (
    <>
      <button
        type="button"
        className={`playtest-zones-tab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={open ? 'Hide exile and the command zone' : 'Show exile and the command zone'}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? 'Hide' : 'Exile / Command'}</span>
      </button>

      {open && (
        <div className="playtest-zones-panel" role="region" aria-label="Exile and the command zone">
          {entries.map((e) => {
            const top = e.cards[e.cards.length - 1];
            return (
              <div key={e.key} className="playtest-zone-tile">
                <div className="playtest-zone-tile__head">
                  <span className="playtest-zone-tile__name">
                    {e.label} ({e.cards.length})
                  </span>
                  {e.key === 'command' && (
                    <TaxCoins
                      cards={taxCards}
                      commanderTax={commanderTax}
                      onAdjust={onAdjustTax}
                      placement="inline"
                    />
                  )}
                  <button
                    type="button"
                    className="playtest-zone-tile__kebab"
                    aria-haspopup="menu"
                    aria-label={`${e.label} actions`}
                    onClick={() => {
                      setOpen(false);
                      onMenu(e.key);
                    }}
                  >
                    <MoreVertical width={16} height={16} strokeWidth={2} aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  className="playtest-zone-tile__body"
                  onClick={() => {
                    setOpen(false);
                    onOpenZone(e.key);
                  }}
                >
                  {e.cards.length === 0 ? (
                    <span className="playtest-zone-tile__empty">No cards</span>
                  ) : e.peek === 'top' &&
                    top?.imageUrl &&
                    top.id !== erroredIds[e.key] &&
                    !hiddenIds?.has(top.id) ? (
                    <img
                      src={top.imageUrl}
                      alt={top.name}
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      onError={() => setErroredIds((prev) => ({ ...prev, [e.key]: top.id }))}
                    />
                  ) : (
                    <div className="playtest-zone-tile__back" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
