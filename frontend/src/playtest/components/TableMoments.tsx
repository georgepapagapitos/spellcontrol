import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayStore } from '@/store/play';
import { paletteForIndex } from '@/lib/seat-palette';
import { haptics } from '@/lib/haptics';
import { useEscapeKey } from '@/lib/use-escape-key';
import { SealBurst } from '@/components/shared/SealBurst';
import type { OnlineTable } from '../hooks/use-online-table';
import './TableMoments.css';

/** "Your turn" auto-dismiss — long enough to register, short enough to never
 *  linger over the board. The CSS lifecycle animation in TableMoments.css is
 *  hand-timed to match this exactly; change both together. */
const YOUR_TURN_MS = 2000;
/** Win ceremony auto-dismiss — longer than the turn moment since there's a
 *  name to read; still transient, and tap-anywhere/✕ both close it early. */
const WIN_CEREMONY_MS = 5000;

interface Props {
  onlineTable: OnlineTable;
}

/**
 * The online table's two "big beat" moments — turn arriving at YOUR seat,
 * and the game ending — both gated on `OnlineTable` being linked (solo
 * playtest never mounts this at all). An opponent seat becoming active gets
 * the quieter rail-chip sweep instead (`OpponentRail.tsx`'s own edge
 * detection); this component only ever announces MY turn and the table's
 * outcome. Both moments portal to `<body>` — `PlaytestBoard` mounts inside
 * the battlefield's `container-type: inline-size` box (see its own doc
 * comment), which would otherwise clip a `position: fixed` overlay to that
 * box instead of the viewport.
 */
export function TableMoments({ onlineTable }: Props) {
  return (
    <>
      <YourTurnMoment activeSeat={onlineTable.activeSeat} mySeat={onlineTable.mySeat} />
      <WinCeremony />
    </>
  );
}

function YourTurnMoment({ activeSeat, mySeat }: { activeSeat: number | null; mySeat: number }) {
  const [visible, setVisible] = useState(false);
  // Edge-triggered on `activeSeat` CHANGING to mySeat — mirrors
  // PlaytestBoard's `tableDefeatedTurn` transition guard. The ref starts at
  // the current value, so mount (and a reconnect refresh landing on the
  // same seat) never fires; only a genuine change does.
  const prevActiveSeatRef = useRef(activeSeat);
  useEffect(() => {
    const prev = prevActiveSeatRef.current;
    prevActiveSeatRef.current = activeSeat;
    if (activeSeat === prev || activeSeat !== mySeat) return;
    haptics.success();
    setVisible(true);
    const t = setTimeout(() => setVisible(false), YOUR_TURN_MS);
    return () => clearTimeout(t);
  }, [activeSeat, mySeat]);

  if (!visible) return null;
  const palette = paletteForIndex(mySeat);
  return createPortal(
    // Announced (role="status"), never blocking (pointer-events: none in
    // CSS), auto-dismissing — the stronger of the two turn-pass beats, but
    // still just a notification, never a modal.
    <div
      className="table-moment"
      role="status"
      style={{
        ['--opp-base' as never]: palette.base,
        ['--opp-edge' as never]: palette.edge,
      }}
    >
      <span className="table-moment__dot" aria-hidden="true" />
      Your turn
    </div>,
    document.body
  );
}

interface Ceremony {
  winnerName: string | null;
  colors: string[];
}

function WinCeremony() {
  const online = usePlayStore((s) => s.online);
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);
  const [closing, setClosing] = useState(false);
  // Transition-edge only: a reload straight into an already-finished game
  // seeds this ref with 'finished' on mount, so it never fires. If the table
  // resets and later finishes again, `online.status` genuinely revisits
  // 'active'/'lobby' first, so the next finish legitimately re-fires — same
  // reasoning as PlaytestBoard's `tableDefeatedTurn` ref.
  const prevStatusRef = useRef(online?.status);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function beginClose() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    // Reduced motion: `.table-win-backdrop`'s exit `animation` is disabled in
    // CSS, so `animationend` (what actually unmounts, below) would never
    // fire — close immediately instead of leaving the ceremony stuck open
    // forever. Same reasoning as `useSheetExit`'s own reduced-motion branch.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setCeremony(null);
      return;
    }
    setClosing(true);
  }

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = online?.status;
    if (!online || online.status !== 'finished' || prev === 'finished') return;
    const winner = online.players.find((p) => p.seat === online.winnerSeat) ?? null;
    haptics.success();
    setClosing(false);
    setCeremony({ winnerName: winner?.name ?? null, colors: winner?.colorIdentity ?? [] });
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setClosing(true);
    }, WIN_CEREMONY_MS);
  }, [online]);

  useEffect(
    () => () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    []
  );

  useEscapeKey(beginClose, ceremony !== null);

  if (!ceremony) return null;

  return createPortal(
    <div
      className={`table-win-backdrop${closing ? ' is-closing' : ''}`}
      // "Tap anywhere" dismisses — the panel below has no interactive
      // content besides the explicit ✕, so a tap on it simply bubbles here.
      onClick={beginClose}
      onAnimationEnd={(e) => {
        if (e.animationName === 'table-win-fall') setCeremony(null);
      }}
    >
      <div className="table-win-ceremony" role="status">
        <SealBurst colors={ceremony.colors} compact />
        <p className="table-win-ceremony__title">
          {ceremony.winnerName ? `${ceremony.winnerName} wins` : 'Game over'}
        </p>
        <button
          type="button"
          className="table-win-ceremony__close"
          onClick={beginClose}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>,
    document.body
  );
}
