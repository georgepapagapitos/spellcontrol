import { useState } from 'react';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import type { PlaytestCard, Zone } from '@/lib/playtest';
import { commanderTaxAmount } from '../lib/zones';

interface Props {
  zones: Record<Zone, PlaytestCard[]>;
  commanderTax: Record<string, number>;
  onOpenZone(zone: Zone): void;
  onShuffleLibrary(): void;
  onScry(): void;
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
  onOpenZone,
  onShuffleLibrary,
  onScry,
}: Props) {
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
        aria-label={open ? 'Hide other zones' : 'View other zones'}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? 'Hide' : 'Zones'}</span>
      </button>

      {open && (
        <div className="playtest-zones-panel" role="region" aria-label="Other zones">
          {entries.map((e) => {
            const top = e.cards[e.cards.length - 1];
            const tax = e.key === 'command' ? commanderTaxAmount(commanderTax, top?.id) : 0;
            // Browse and Scry dismiss the whole drawer; Shuffle keeps it open.
            const items: OverflowMenuItem[] = [
              {
                label: 'Browse',
                onClick: () => {
                  setOpen(false);
                  onOpenZone(e.key);
                },
              },
              ...(e.key === 'library'
                ? [
                    { label: 'Shuffle', onClick: () => onShuffleLibrary() },
                    {
                      label: 'Scry 3',
                      onClick: () => {
                        setOpen(false);
                        onScry();
                      },
                    },
                  ]
                : []),
            ];
            return (
              <div key={e.key} className="playtest-zone-tile">
                <div className="playtest-zone-tile__head">
                  <span className="playtest-zone-tile__name">
                    {e.label} ({e.cards.length})
                    {tax > 0 && <span className="playtest-zone-tile__tax"> · Tax +{tax}</span>}
                  </span>
                  <OverflowMenu
                    items={items}
                    ariaLabel={`${e.label} actions`}
                    triggerClassName="playtest-zone-tile__kebab"
                    panelClassName="playtest-zone-menu-popover"
                  />
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
