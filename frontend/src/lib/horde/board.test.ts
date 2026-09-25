import { describe, it, expect } from 'vitest';
import { createPlaytestState } from '@/lib/playtest';
import type { PlaytestCard, PlaytestState } from '@/lib/playtest';
import { createHordeBoard, dealDueBosses } from './board';
import { buildHordeLibrary } from './library';
import { resolveHordeSettings, type HordeLevel } from './settings';
import { ZOMBIE_HORDE_FIXTURE } from './deck.fixtures';

const LEVELS: HordeLevel[] = ['casual', 'standard', 'brutal'];
const SEEDS = Array.from({ length: 50 }, (_, i) => i);

describe('createHordeBoard', () => {
  it('keeps the dealt library in order (never reshuffles) across levels, survivor counts and seeds', () => {
    for (const level of LEVELS) {
      for (let survivors = 1; survivors <= 4; survivors++) {
        const settings = resolveHordeSettings(level, survivors);
        for (const seed of SEEDS) {
          const built = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, seed);
          const board = createHordeBoard(built.library, built.bosses, built.seed);

          expect(board.zones.library.map((c) => c.id)).toEqual(built.library.map((c) => c.id));
          expect(board.zones.command.map((c) => c.id)).toEqual(built.bosses.map((c) => c.id));
          expect(board.zones.hand).toEqual([]);

          if (settings.safeZone !== 'off') {
            const fraction = settings.safeZone === 'full' ? 0.2 : 0.13;
            const windowSize = Math.round(board.zones.library.length * fraction);
            const safeWindow = board.zones.library.slice(0, windowSize);
            expect(safeWindow.some((c) => ZOMBIE_HORDE_FIXTURE.lateGame.includes(c.name))).toBe(
              false
            );
          }
        }
      }
    }
  });
});

function boss(id: string, name: string): PlaytestCard {
  return { id, name, typeLine: 'Legendary Creature — Boss', power: '5', toughness: '5' };
}

/** A board whose library is `size` plain cards, with `bosses` in the command
 *  zone — everything `dealDueBosses` reads (`zones.library.length`,
 *  `zones.command`, `battlefield`) without needing a real deal. */
function boardWithLibrarySize(size: number, bosses: PlaytestCard[]): PlaytestState {
  const base = createPlaytestState({ library: [], command: bosses, seed: 1, openingHandSize: 0 });
  const library = Array.from({ length: size }, (_, i): PlaytestCard => ({
    id: `lib-${i}`,
    name: 'Filler',
  }));
  return { ...base, zones: { ...base.zones, library } };
}

describe('dealDueBosses', () => {
  it('deals a boss once the library has passed its tick, even when a reveal (not damage) moved it (E436)', () => {
    const start = boardWithLibrarySize(20, [boss('boss-1', 'Grave Titan')]);
    // A reveal shrinks the library past the 0.5 tick with no damage call.
    const afterReveal: PlaytestState = {
      ...start,
      zones: { ...start.zones, library: start.zones.library.slice(11) },
    };
    const result = dealDueBosses(afterReveal, 20, [0.5, 1], []);
    expect(result.crossed).toEqual([0]);
    expect(result.bossesEntered).toEqual([{ name: 'Grave Titan', tick: 0.5 }]);
    expect(result.board.battlefield.some((b) => b.card.id === 'boss-1')).toBe(true);
    expect(result.board.zones.command).toHaveLength(0);
  });

  it('deals every tick a single change crosses at once, in tick order', () => {
    const start = boardWithLibrarySize(20, [boss('boss-1', 'First'), boss('boss-2', 'Second')]);
    const emptied: PlaytestState = { ...start, zones: { ...start.zones, library: [] } };
    const result = dealDueBosses(emptied, 20, [0.5, 1], []);
    expect(result.crossed).toEqual([0, 1]);
    expect(result.bossesEntered.map((b) => b.name)).toEqual(['First', 'Second']);
    expect(result.board.battlefield.map((b) => b.card.id)).toEqual(['boss-1', 'boss-2']);
  });

  it('never re-deals an already-crossed tick', () => {
    const start = boardWithLibrarySize(20, [boss('boss-1', 'First')]);
    const emptied: PlaytestState = { ...start, zones: { ...start.zones, library: [] } };
    const result = dealDueBosses(emptied, 20, [0.5], [0]);
    expect(result.crossed).toEqual([0]);
    expect(result.bossesEntered).toEqual([]);
    expect(result.board).toBe(emptied);
  });

  it('still marks a tick crossed when no boss is left to deal, but deals nothing', () => {
    const start = boardWithLibrarySize(20, []);
    const emptied: PlaytestState = { ...start, zones: { ...start.zones, library: [] } };
    const result = dealDueBosses(emptied, 20, [0.5, 1], []);
    expect(result.crossed).toEqual([0, 1]);
    expect(result.bossesEntered).toEqual([]);
    expect(result.board.battlefield).toEqual([]);
  });

  it('is a no-op when no tick is newly due', () => {
    const start = boardWithLibrarySize(20, [boss('boss-1', 'First')]);
    const result = dealDueBosses(start, 20, [0.5, 1], []);
    expect(result).toEqual({ board: start, crossed: [], bossesEntered: [] });
  });
});
