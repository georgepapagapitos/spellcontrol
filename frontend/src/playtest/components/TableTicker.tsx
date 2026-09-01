import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * The play ticker — the table's narrative feed ("Maya played Sol Ring"),
 * built from each seat's public log lines (store/play.ts `onlineTicker`;
 * visibility contract in projection.ts `toPublicTicker`). Renders in the
 * rail's slot (OpponentRail's `children`) at two densities, following the
 * rail's own gate so the two never disagree:
 *
 * - **Glance** (side rail): a persistent scrolling feed under the opponent
 *   list — the rail column has vertical slack, so the narrative is always
 *   ambient there.
 * - **Presence** (top strip): a transient one-line flash, portaled to
 *   `<body>` (same clipping reason as TableMoments) and auto-dismissing —
 *   the phone board has no axis to spend on a persistent feed, and the
 *   reviewable history lives one tap away in the Log sheet's Table tab.
 */
export function TableTicker({ onlineTable }: Props) {
  const items = usePlayStore((s) => s.onlineTicker);
  const glance = useMediaQuery(GLANCE_QUERY);
  return glance ? (
    <TickerPanel items={items} onlineTable={onlineTable} />
  ) : (
    <TickerFlash items={items} onlineTable={onlineTable} />
  );
}

function TickerPanel({ items, onlineTable }: { items: TickerItem[]; onlineTable: OnlineTable }) {
  const listRef = useRef<HTMLOListElement>(null);
  // Keep the newest line in view — the feed reads downward like a chat log.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <section className="table-ticker" aria-label="Table log">
      <h3 className="table-ticker__heading">Table log</h3>
      {items.length === 0 ? (
        <p className="table-ticker__empty">Plays and messages will appear here.</p>
      ) : (
        // role="log" = implicit polite live region: new lines are announced
        // without stealing focus, in both densities' place of one.
        <ol ref={listRef} className="table-ticker__list" role="log">
          {items.map((it) => (
            <TickerLine key={it.id} item={it} name={tickerSeatName(onlineTable, it.seat)} />
          ))}
        </ol>
      )}
      {/* Glance density only — the rail column has the vertical slack for a
          persistent composer. In presence density the ticker renders just a
          portaled transient flash with no in-flow surface to attach one to,
          so the phone's composer lives in the Log sheet's Table tab. */}
      <TableChat idPrefix="rail" />
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
