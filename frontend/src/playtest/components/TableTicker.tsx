import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle } from 'lucide-react';
import { usePlayStore, type TickerItem } from '@/store/play';
import { paletteForIndex } from '@/lib/seat-palette';
import type { OnlineTable } from '../hooks/use-online-table';
import { useMediaQuery } from '../hooks/use-media-query';
import { GLANCE_QUERY } from './OpponentRail';
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
 * The table tier's way into the table feed: a bottom-left button in
 * PlaytestBoard's `.playtest-left-dock` column, under the mana pool and the
 * game log. It opens the log dock on its Table view (every seat's plays and
 * the chat, with the composer) rather than a panel of its own: the two used
 * to show the same feed and the same composer side by side. It stays as its
 * own button because it carries what the log's entry points don't: an unread
 * count of lines from other seats that arrived while the log was shut.
 *
 * Controlled: `open` is whether the log dock is open, so the button reads as
 * pressed whichever way the log was opened (L, the game menu, this button).
 */
export function TableTickerDock({
  onlineTable,
  open,
  onToggle,
}: Props & { open: boolean; onToggle(): void }) {
  const items = usePlayStore((s) => s.onlineTicker);
  // Seeded with the current tail so backlog already in the feed when this
  // mounts never inflates the very first badge (same reasoning as
  // TickerFlash's lastIdRef). Advances when the log closes: everything that
  // arrived while it was open was already on screen.
  const tail = items.length > 0 ? items[items.length - 1].id : 0;
  const [lastSeenId, setLastSeenId] = useState(tail);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setLastSeenId(tail);
  }

  // Zero while open, so the badge only ever counts what showed up while shut.
  const unread = open
    ? 0
    : items.filter((it) => it.id > lastSeenId && it.seat !== onlineTable.mySeat).length;

  const label = unread > 0 ? `Table log, ${unread} unread` : 'Table log';

  return (
    <button
      type="button"
      className={`table-ticker-dock__toggle${open ? ' is-open' : ''}`}
      aria-expanded={open}
      aria-label={label}
      title="Table log"
      onClick={onToggle}
    >
      <MessageCircle width={20} height={20} aria-hidden />
      {unread > 0 && (
        <span className="table-ticker-dock__badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
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
