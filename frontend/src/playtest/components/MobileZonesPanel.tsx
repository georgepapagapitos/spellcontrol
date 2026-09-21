import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { commanderTaxAmount } from '../lib/zones';

interface Props {
  zones: Record<Zone, PlaytestCard[]>;
  commanderTax: Record<string, number>;
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

export function MobileZonesPanel({ zones, commanderTax, onOpenZone, onMenu }: Props) {
  const [open, setOpen] = useState(false);
  // Per-zone map of a top-card id whose image failed, so a new top card
  // always gets a fresh chance to load (mirrors ZonePile).
  const [erroredIds, setErroredIds] = useState<Partial<Record<Zone, string>>>({});

  const entries: ZoneEntry[] = [
    { key: 'library', label: 'Library', cards: zones.library, peek: 'back' },
    { key: 'graveyard', label: 'Graveyard', cards: zones.graveyard, peek: 'top' },
    { key: 'exile', label: 'Exile', cards: zones.exile, peek: 'top' },
    { key: 'command', label: 'Command', cards: zones.command, peek: 'top' },
  ];

  return (
    <>
      <button
        type="button"
        className={`playtest-zones-tab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={open ? 'Hide other zones' : 'Show other zones'}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? 'Hide' : 'Zones'}</span>
      </button>

      {open && (
        <div className="playtest-zones-panel" role="region" aria-label="Other zones">
          {entries.map((e) => {
            const top = e.cards[e.cards.length - 1];
            const tax = e.key === 'command' ? commanderTaxAmount(commanderTax, top?.id) : 0;
            return (
              <div key={e.key} className="playtest-zone-tile">
                <div className="playtest-zone-tile__head">
                  <span className="playtest-zone-tile__name">
                    {e.label} ({e.cards.length})
                    {tax > 0 && <span className="playtest-zone-tile__tax"> · Tax +{tax}</span>}
                  </span>
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
                  ) : e.peek === 'top' && top?.imageUrl && top.id !== erroredIds[e.key] ? (
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
