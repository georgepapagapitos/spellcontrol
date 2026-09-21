import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';
import { usePlayStore, type TickerItem } from '@/store/play';
import { paletteForIndex } from '@/lib/seat-palette';
import type { OnlineTable } from '../hooks/use-online-table';
import { useMediaQuery } from '../hooks/use-media-query';
import { GLANCE_QUERY } from './OpponentRail';
import { TableChat } from './TableChat';
import './TableTicker.css';

/** Transient-line auto-dismiss (presence density) — long enough to read a
 *  card name, short enough that a busy turn doesn't queue a backlog. The
 *  CSS lifecycle animation is hand-timed to match; change both together. */
const FLASH_MS = 5000;

/** Display name for a feed line's seat. Exported for PlaytestLogSheet's
 *  Table tab, so the sheet and the ticker label seats identically. */
export function tickerSeatName(onlineTable: OnlineTable, seat: number): string {
  if (seat === onlineTable.mySeat) return 'You';
  return onlineTable.opponents.find((o) => o.board.seat === seat)?.name ?? `Seat ${seat + 1}`;
}

interface Props {
  onlineTable: OnlineTable;
}

/**
 * The play ticker's presence-density half — a transient one-line flash for
 * the table's narrative feed ("Maya played Sol Ring"), built from each
 * seat's public log lines (store/play.ts `onlineTicker`; visibility contract
 * in projection.ts `toPublicTicker`). Mounted in the rail's slot
 * (OpponentRail's `children`) and the grid mode's ticker dock; renders
 * nothing at glance density — that density's persistent feed now lives
 * behind `TableTickerDock`'s bottom-left toggle in the table tier's left
 * dock (see PlaytestBoard.tsx), not parked open over the felt or the rail
 * with no way to close it (#2073 — the "can't close the table log" and
 * "chat icon bottom left" reports).
 *
 * Presence (top strip / narrow tier): a transient flash, portaled to
 * `<body>` (same clipping reason as TableMoments) and auto-dismissing — the
 * phone board has no axis to spend on a persistent feed, and the reviewable
 * history lives one tap away in the Log sheet's Table tab.
 */
export function TableTicker({ onlineTable }: Props) {
  const items = usePlayStore((s) => s.onlineTicker);
  const glance = useMediaQuery(GLANCE_QUERY);
  if (glance) return null;
  return <TickerFlash items={items} onlineTable={onlineTable} />;
}

/**
 * The table tier's persistent chat/log entry point — a bottom-left button in
 * PlaytestBoard's `.playtest-left-dock` column, beside the mana pool and the
 * game log. Carries an unread count for lines that arrived while it was
 * closed (own-seat lines never count — see `TickerFlash`'s same rule) and
 * resets the moment it opens. The feed and composer are the same ones the
 * old always-open glance panel rendered; they now have a way to close.
 *
 * Dismiss follows the dock's other panel (LogDock)'s own convention rather
 * than a modal's: a close button and Escape while focus is already inside,
 * no backdrop, no click-outside, no focus trap. It's a companion panel
 * beside the felt, not a decision that should vanish because you clicked
 * the board mid-turn.
 */
export function TableTickerDock({ onlineTable }: Props) {
  const items = usePlayStore((s) => s.onlineTicker);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  // Seeded with the current tail so backlog already in the feed when this
  // mounts never inflates the very first badge (same reasoning as
  // TickerFlash's lastIdRef). Only advances on close (see `close` below) —
  // everything that arrived while the panel was open was already visible in
  // the list, so there is nothing to mark read until it shuts again.
  const [lastSeenId, setLastSeenId] = useState(() =>
    items.length > 0 ? items[items.length - 1].id : 0
  );

  function close() {
    setOpen(false);
    if (items.length > 0) setLastSeenId(items[items.length - 1].id);
  }

  // Bound to the panel's own node, not the document, so Escape closes it
  // only when focus is already inside — a keystroke aimed at the board
  // never reaches this (same technique as LogDock). Keyed on `open`: the
  // panel (and its ref target) only exists while open, so the listener has
  // to re-attach to the freshly mounted node each time rather than binding
  // once against a `null` ref before the panel ever opens; keyed on `items`
  // too so a late Escape still stamps the tail it closes against.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (items.length > 0) setLastSeenId(items[items.length - 1].id);
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [open, items]);

  // Zero while open — everything that arrives is already visible in the list
  // below — so the badge only ever counts what showed up while it was shut.
  const unread = open
    ? 0
    : items.filter((it) => it.id > lastSeenId && it.seat !== onlineTable.mySeat).length;

  const label = unread > 0 ? `Table log, ${unread} unread` : 'Table log';

  return (
    <div className="table-ticker-dock">
      {open && (
        <TickerPanel items={items} onlineTable={onlineTable} panelRef={panelRef} onClose={close} />
      )}
      <button
        type="button"
        className={`table-ticker-dock__toggle${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title="Table log"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MessageCircle width={20} height={20} aria-hidden />
        {unread > 0 && (
          <span className="table-ticker-dock__badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function TickerPanel({
  items,
  onlineTable,
  panelRef,
  onClose,
}: {
  items: TickerItem[];
  onlineTable: OnlineTable;
  /** Given by `TableTickerDock` so Escape can bind to the panel's own node. */
  panelRef?: RefObject<HTMLElement | null>;
  onClose?: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  // Keep the newest line in view — the feed reads downward like a chat log.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <section className="table-ticker" aria-label="Table log" ref={panelRef}>
      <div className="table-ticker__head">
        <h3 className="table-ticker__heading">Table log</h3>
        {onClose && (
          <button
            type="button"
            className="table-ticker__close"
            aria-label="Close table log"
            onClick={onClose}
          >
            <X width={16} height={16} aria-hidden />
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="table-ticker__empty">Plays and messages will appear here.</p>
      ) : (
        // role="log" = implicit polite live region: new lines are announced
        // without stealing focus.
        <ol ref={listRef} className="table-ticker__list" role="log">
          {items.map((it) => (
            <TickerLine key={it.id} item={it} name={tickerSeatName(onlineTable, it.seat)} />
          ))}
        </ol>
      )}
      <TableChat idPrefix="ticker-dock" />
    </section>
  );
}

/** The one place a feed line's displayed text is derived, so the panel, the
 *  phone flash, and the Log sheet's Table tab can never disagree about what
 *  a line says. */
export function tickerText(item: TickerItem): string {
  return item.kind === 'chat' ? item.text : item.entry.text;
}

export function TickerLine({ item, name }: { item: TickerItem; name: string }) {
  const palette = paletteForIndex(item.seat);
  const isChat = item.kind === 'chat';
  return (
    <li
      // Chat is marked as its own modifier rather than styled like a play
      // line: one is the app narrating verified state, the other is text a
      // player typed, and a reader has to be able to tell which they're
      // looking at (see the TickerItem doc comment). The separator after the
      // name carries that distinction for anyone who can't see the styling.
      className={isChat ? 'table-ticker__line table-ticker__line--chat' : 'table-ticker__line'}
      style={{
        ['--opp-base' as never]: palette.base,
        ['--opp-edge' as never]: palette.edge,
      }}
    >
      <span className="table-ticker__dot" aria-hidden="true" />
      <span className="table-ticker__name">{isChat ? `${name}:` : name}</span>
      <span className="table-ticker__text">{tickerText(item)}</span>
    </li>
  );
}

function TickerFlash({ items, onlineTable }: { items: TickerItem[]; onlineTable: OnlineTable }) {
  const [flash, setFlash] = useState<TickerItem | null>(null);
  // Seeded with the current tail so mount (or a reconnect's catch-up burst)
  // never replays backlog as a stream of flashes — only lines that arrive
  // while this density is live flash. Own-seat lines are skipped: you just
  // did the thing; the flash is opponent-awareness.
  const lastIdRef = useRef(items.length > 0 ? items[items.length - 1].id : 0);
  useEffect(() => {
    const lastSeen = lastIdRef.current;
    if (items.length > 0) lastIdRef.current = items[items.length - 1].id;
    const fresh = items.filter((it) => it.id > lastSeen && it.seat !== onlineTable.mySeat);
    const latest = fresh[fresh.length - 1];
    if (latest) setFlash(latest);
  }, [items, onlineTable.mySeat]);

  // The dismiss timer lives in its OWN effect, keyed on `flash` — inside the
  // items-driven effect above, that effect's own cleanup would cancel the
  // timer every time the table stays busy, pinning the flash open (the
  // use-takeback stale-approval lesson).
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  if (!flash) return null;
  const palette = paletteForIndex(flash.seat);
  return createPortal(
    // Announced (role="status"), never blocking (pointer-events: none in
    // CSS), auto-dismissing — same contract as TableMoments' "Your turn".
    <div
      className="table-ticker-flash"
      role="status"
      style={{
        ['--opp-base' as never]: palette.base,
        ['--opp-edge' as never]: palette.edge,
      }}
    >
      <span className="table-ticker__dot" aria-hidden="true" />
      <span className="table-ticker-flash__name">
        {tickerSeatName(onlineTable, flash.seat)}
        {flash.kind === 'chat' ? ':' : ''}
      </span>
      <span className="table-ticker-flash__text">{tickerText(flash)}</span>
    </div>,
    document.body
  );
}
