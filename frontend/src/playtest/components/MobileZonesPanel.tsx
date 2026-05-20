import { useEffect, useRef, useState } from 'react';
import type { PlaytestCard, Zone } from '@/lib/playtest';

interface Props {
  zones: Record<Zone, PlaytestCard[]>;
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

export function MobileZonesPanel({ zones, onOpenZone, onShuffleLibrary, onScry }: Props) {
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<Zone | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor]);

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
            return (
              <div key={e.key} className="playtest-zone-tile">
                <div className="playtest-zone-tile__head">
                  <span className="playtest-zone-tile__name">
                    {e.label} ({e.cards.length})
                  </span>
                  <button
                    type="button"
                    className="playtest-zone-tile__kebab"
                    aria-label={`${e.label} actions`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setMenuFor((cur) => (cur === e.key ? null : e.key));
                    }}
                  >
                    ⋮
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
                  ) : e.peek === 'top' && top?.imageUrl ? (
                    <img src={top.imageUrl} alt={top.name} draggable={false} />
                  ) : (
                    <div className="playtest-zone-tile__back" />
                  )}
                </button>
                {menuFor === e.key && (
                  <div ref={menuRef} className="playtest-zone-tile__menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        setOpen(false);
                        onOpenZone(e.key);
                      }}
                    >
                      Browse
                    </button>
                    {e.key === 'library' && (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuFor(null);
                            onShuffleLibrary();
                          }}
                        >
                          Shuffle
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuFor(null);
                            setOpen(false);
                            onScry();
                          }}
                        >
                          Scry 3
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
