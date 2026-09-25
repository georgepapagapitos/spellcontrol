import {
  applyAction,
  createPlaytestState,
  type PlaytestCard,
  type PlaytestState,
} from '@/lib/playtest';
import { autoPlace, type Rect } from '@/playtest/lib/auto-place';
import type { HordeBossArrival } from './turn';

/**
 * The horde's board at the start of a game: the dealt library IN ORDER
 * (index 0 = top), bosses in the command zone. `createPlaytestState` always
 * shuffles `init.library` (every other caller wants that); an empty library
 * sidesteps the shuffle, and the safe-zone-dealt order from
 * `buildHordeLibrary` is set afterward untouched (E432).
 */
export function createHordeBoard(
  library: PlaytestCard[],
  bosses: PlaytestCard[],
  seed: number
): PlaytestState {
  const board = createPlaytestState({ library: [], command: bosses, seed, openingHandSize: 0 });
  return { ...board, zones: { ...board.zones, library: [...library] } };
}

/**
 * Deals every boss whose tick the library has passed and that hasn't been
 * dealt yet — whatever moved the library there, damage or the horde's own
 * reveal (E436). `crossed` are tick indexes already dealt; ticks are dealt in
 * order, each moving `board.zones.command[0]` to the battlefield the same
 * way the damage path always has. A tick with no boss left to deal still
 * counts as crossed, so it's never retried.
 */
export function dealDueBosses(
  board: PlaytestState,
  librarySizeAtStart: number,
  bossTicks: readonly number[],
  crossed: readonly number[],
  rect?: Rect | null
): { board: PlaytestState; crossed: number[]; bossesEntered: HordeBossArrival[] } {
  if (librarySizeAtStart <= 0) return { board, crossed: [...crossed], bossesEntered: [] };
  const fractionGone = (librarySizeAtStart - board.zones.library.length) / librarySizeAtStart;
  const due = bossTicks
    .map((tick, i) => ({ tick, i }))
    .filter(({ tick, i }) => !crossed.includes(i) && fractionGone >= tick)
    .sort((a, b) => a.tick - b.tick);

  if (due.length === 0) return { board, crossed: [...crossed], bossesEntered: [] };

  let nextBoard = board;
  const bossesEntered: HordeBossArrival[] = [];
  const nextCrossed = [...crossed];
  for (const { tick, i } of due) {
    nextCrossed.push(i);
    const boss = nextBoard.zones.command[0];
    if (!boss) continue;
    const { x, y } = autoPlace(boss, nextBoard.battlefield, rect);
    nextBoard = applyAction(nextBoard, { type: 'MOVE_TO_BATTLEFIELD', cardId: boss.id, x, y });
    bossesEntered.push({ name: boss.name, tick });
  }
  return { board: nextBoard, crossed: nextCrossed, bossesEntered };
}
