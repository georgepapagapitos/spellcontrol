/**
 * Pure view-layer helpers for the solo Horde board (E387 PR 5): status text,
 * the phone band's one-line summary, the corner meter's "next boss in N",
 * and measuring the horde felt's live box for `autoPlace`. Kept out of the
 * components so each is independently testable without rendering anything.
 */
import { attackSummary, type HordeLevel } from '@/lib/horde';
import type { Rect } from './auto-place';
import { hordeArrivesAfterTurn, isHordeTurnDue, type SoloHordeState } from './horde-solo';

export function hordeLevelLabel(level: HordeLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/** The status half of "Standard · <status>" (`.horde-table-status-line`) —
 *  also the source for the opening-hand row and the Table settings row. */
export function hordeStatusText(
  horde: Pick<SoloHordeState, 'phase' | 'outcome' | 'armedAtTurn' | 'config'>,
  playerTurn: number
): string {
  if (horde.phase === 'waiting') {
    return isHordeTurnDue(horde, playerTurn)
      ? 'Its turn comes when you pass yours'
      : `Arrives after your turn ${hordeArrivesAfterTurn(horde)}`;
  }
  if (horde.phase === 'reveal') return 'The horde reveals';
  if (horde.phase === 'combat') return 'The horde attacks';
  return horde.outcome === 'won' ? 'The horde is gone' : 'Overrun';
}

/** The phone band's collapsed one-liner. */
export function hordeBandLine(horde: SoloHordeState, playerTurn: number): string {
  const name = horde.config.hordeName;
  if (horde.phase === 'ended') {
    return `${name} · ${horde.outcome === 'won' ? 'defeated' : 'overran you'}`;
  }
  if (horde.phase === 'waiting' && !isHordeTurnDue(horde, playerTurn)) {
    return `${name} · arrives after your turn ${hordeArrivesAfterTurn(horde)}`;
  }
  const { attackers, power } = attackSummary(horde.board.battlefield);
  const left = horde.board.zones.library.length;
  return `${name} · ${left} left · ${attackers} creature${attackers === 1 ? '' : 's'} · ${power} power`;
}

/** How many cards still need to leave the library before the next
 *  not-yet-crossed `bossTicks` fraction fires — the same math as the paper
 *  table's own (unexported) `cardsUntilNextBoss` in HordeTable.tsx. */
export function cardsUntilNextBoss(
  librarySizeAtStart: number,
  remaining: number,
  bossTicks: readonly number[],
  crossed: readonly number[]
): number | null {
  const nextIndex = bossTicks.findIndex((_, i) => !crossed.includes(i));
  if (nextIndex === -1) return null;
  const nextRemaining = Math.ceil(librarySizeAtStart * (1 - bossTicks[nextIndex]));
  return Math.max(0, remaining - nextRemaining);
}

/** Reads the live battlefield box for `autoPlace` — the same reserved-
 *  fraction ponytail constants HordeTable's own `measureRect` uses (this
 *  table's own corner chrome, not the main board's). */
export function measureHordeRect(el: HTMLElement): Rect {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const cardW = parseFloat(style.getPropertyValue('--pt-card-w'));
  const cardH = parseFloat(style.getPropertyValue('--pt-card-h'));
  return {
    width: box.width,
    height: box.height,
    cardW: Number.isFinite(cardW) && cardW > 0 ? cardW : undefined,
    cardH: Number.isFinite(cardH) && cardH > 0 ? cardH : undefined,
    reservedTop: 0.18,
    reservedBottom: 0.24,
  };
}
