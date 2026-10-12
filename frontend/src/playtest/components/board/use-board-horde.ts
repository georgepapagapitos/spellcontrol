import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayStore } from '@/store/play';
import { useOnlineHorde } from '../../hooks/use-online-horde';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { Rect } from '../../lib/auto-place';
import { measureHordeRect } from '../../lib/horde-view';
import { usePlaytestStore } from '../../store';

/**
 * Solo Horde (E387 PR 5) — see lib/horde-solo.ts and horde-view.ts. Never
 * exists at an online table (gated at every render site), so these reads cost
 * nothing there beyond the subscription itself.
 */
export function useSoloHorde() {
  const horde = usePlaytestStore((s) => s.horde);
  const hordeLoad = usePlaytestStore((s) => s.hordeLoad);
  const disarmHorde = usePlaytestStore((s) => s.disarmHorde);
  const startHordeTurn = usePlaytestStore((s) => s.startHordeTurn);
  const confirmHordeReveal = usePlaytestStore((s) => s.confirmHordeReveal);
  const [showHordeSetup, setShowHordeSetup] = useState(false);
  // The card menu and damage sheet ONLY ever render at the board, never inside
  // `HordeHalf`/`HordeBand` — see `HordeOverlays`'s own doc comment for why
  // (a `filter` on the half's container quietly trapped their fixed-position
  // overlay to the felt's own box).
  const [hordeCardMenuId, setHordeCardMenuId] = useState<string | null>(null);
  const [hordeDamageOpen, setHordeDamageOpen] = useState(false);
  const hordeFeltRef = useRef<HTMLDivElement>(null);
  // Visible whenever there is a fight to show OR one is mid (re-)load — the
  // Reset "Play again" path re-arms the same settings, and the half/band
  // must show a loading line rather than blink away and back (design point 9).
  const hordeVisible = horde !== null || hordeLoad.status !== 'idle';
  return {
    horde,
    hordeLoad,
    disarmHorde,
    startHordeTurn,
    confirmHordeReveal,
    showHordeSetup,
    setShowHordeSetup,
    hordeCardMenuId,
    setHordeCardMenuId,
    hordeDamageOpen,
    setHordeDamageOpen,
    hordeFeltRef,
    hordeVisible,
  };
}

/**
 * A horde at an online table (E387 online co-op, lane F2): replays the
 * table's horde log and adds the team-turn surface. Non-null exactly when
 * this seat's game is a horde game — every render site gates on it the same
 * way solo Horde gates on `horde !== null`.
 */
export function useBoardOnlineHorde(
  onlineTable: OnlineTable | null,
  isNarrow: boolean,
  hordeFeltRef: React.RefObject<HTMLDivElement | null>
) {
  const navigate = useNavigate();
  // The horde felt's live box, for `useOnlineHorde`'s `autoPlace` calls —
  // measured on mount and on resize/layout-mode changes (isNarrow swaps
  // which component owns `hordeFeltRef`), never on every render.
  const [onlineHordeRect, setOnlineHordeRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!onlineTable) return;
    const measure = () =>
      setOnlineHordeRect(hordeFeltRef.current ? measureHordeRect(hordeFeltRef.current) : null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [onlineTable, isNarrow, hordeFeltRef]);
  const onlineHorde = useOnlineHorde(onlineTable, onlineHordeRect);
  // A Horde table the host has sent back to the lobby (Rematch) is set up in
  // the lobby, not on the board: both the host and every survivor go there,
  // the way a table that hasn't started never shows the board at all.
  const hordeTableBackInLobby = usePlayStore(
    (s) => s.online?.format === 'horde' && s.online.status === 'lobby'
  );
  useEffect(() => {
    if (onlineTable && hordeTableBackInLobby) navigate('/play/online');
  }, [onlineTable, hordeTableBackInLobby, navigate]);
  return { onlineHorde, isOnlineHordeTable: onlineHorde !== null };
}
