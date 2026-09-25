/**
 * Test fixture builder for a solo `SoloHordeState` — used across the horde
 * component tests. Built with the real engine (`ZOMBIE_HORDE_FIXTURE` +
 * `buildHordeLibrary` + `createPlaytestState`), never a hand-typed board, so
 * the fixture can't drift from what the real reducer produces. Mirrors
 * `lib/horde/deck.fixtures.ts`'s own naming.
 */
import { createPlaytestState } from '@/lib/playtest';
import { buildHordeLibrary, resolveHordeSettings } from '@/lib/horde';
import { ZOMBIE_HORDE_FIXTURE } from '@/lib/horde/deck.fixtures';
import type { SoloHordeState } from './horde-solo';

export function buildTestHorde(overrides: Partial<SoloHordeState> = {}): SoloHordeState {
  const settings = resolveHordeSettings('standard', 1);
  const { library, bosses, seed } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, 42);
  const board = createPlaytestState({ library, command: bosses, seed, openingHandSize: 0 });
  return {
    config: {
      hordeId: 'zombies',
      hordeName: 'Zombies',
      level: 'standard',
      overrides: {},
      settings,
    },
    board,
    librarySizeAtStart: library.length,
    bossTicksCrossed: [],
    armedAtTurn: 1,
    hordeTurn: 0,
    phase: 'waiting',
    pendingReveal: null,
    pendingAttack: null,
    attackingIds: [],
    lastDamageResult: null,
    outcome: null,
    damageTaken: 0,
    cardsMilledByDamage: 0,
    ...overrides,
  };
}
