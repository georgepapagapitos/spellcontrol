import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
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

const MENU_GAP = 4;
const MENU_MARGIN = 8;

export function MobileZonesPanel({ zones, onOpenZone, onShuffleLibrary, onScry }: Props) {
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<Zone | null>(null);
  // The kebab's viewport rect, captured on open — the portaled menu is a fixed
  // overlay anchored to it (the panel itself scrolls + clips, so an in-panel
  // absolute menu got cut off for the bottom-row tiles).
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (menuRef.current?.contains(t)) return;
      // Let a kebab tap reach its own click handler (toggle/switch) instead of
      // this listener swallowing it first.
      if (t.closest?.('.playtest-zone-tile__kebab')) return;
      setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuFor(null);
    };
    // The zones drawer scrolls; the fixed menu would otherwise drift off its
    // kebab. Close on any scroll, matching the app's other anchored popovers.
    const onScroll = () => setMenuFor(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [menuFor]);

  // Measure the mounted menu and place it under the kebab, right-aligned, with
  // a flip-up when it would overflow the safe viewport (subtracts playtest
  // chrome — header is hidden in fullscreen so getSafeViewport returns 0).
  useLayoutEffect(() => {
    if (!menuFor || !anchor || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchor,
      { width: rect.width, height: rect.height },
      safe,
      'right',
      MENU_GAP
    );
    const left = placement.left ?? Math.max(MENU_MARGIN, anchor.right - rect.width);
    // computePopoverPlacement returns top or bottom (fixed); convert to a top value.
    let top: number;
    if (placement.top !== undefined) {
      top = placement.top;
    } else if (placement.bottom !== undefined) {
      top = window.innerHeight - placement.bottom - rect.height;
    } else {
      top = anchor.bottom + MENU_GAP;
    }
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [menuFor, anchor]);

  const entries: ZoneEntry[] = [
    { key: 'library', label: 'Library', cards: zones.library, peek: 'back' },
    { key: 'graveyard', label: 'Graveyard', cards: zones.graveyard, peek: 'top' },
    { key: 'exile', label: 'Exile', cards: zones.exile, peek: 'top' },
    { key: 'command', label: 'Command', cards: zones.command, peek: 'top' },
  ];

  const closePanel = () => {
    setOpen(false);
    setMenuFor(null);
  };

  return (
    <>
      <button
        type="button"
        className={`playtest-zones-tab${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label={open ? 'Hide other zones' : 'View other zones'}
        onClick={() => (open ? closePanel() : setOpen(true))}
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
                    aria-haspopup="menu"
                    aria-expanded={menuFor === e.key}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      const rect = ev.currentTarget.getBoundingClientRect();
                      setMenuFor((cur) => (cur === e.key ? null : e.key));
                      setAnchor(rect);
                      setPos(null);
                    }}
                  >
                    ⋮
                  </button>
                </div>
                <button
                  type="button"
                  className="playtest-zone-tile__body"
                  onClick={() => {
                    closePanel();
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
              </div>
            );
          })}
        </div>
      )}

      {menuFor &&
        createPortal(
          <div
            ref={menuRef}
            className="playtest-zone-tile__menu"
            role="menu"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closePanel();
                onOpenZone(menuFor);
              }}
            >
              Browse
            </button>
            {menuFor === 'library' && (
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
                    closePanel();
                    onScry();
                  }}
                >
                  Scry 3
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
