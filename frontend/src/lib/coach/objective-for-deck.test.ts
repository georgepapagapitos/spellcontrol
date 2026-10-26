/**
 * E1039 guard: the saved deck's objective must not wait for the live Game Changer
 * fetch. On a cold page that fetch queues on the shared Scryfall limiter behind the
 * analysis's own requests (and a 429 cooldown), and the objective's time comes out of
 * the 4 s pairing budget; it measured 14-40 s, leaving cuts with no replacement.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Deck } from '@/store/decks';
import type { CoachObjectiveEnv } from './coach-objective';

const seen: { gameChangerNames?: ReadonlySet<string> } = {};
const live = { release: (_: Set<string>) => {} };

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  // The live fetch is still in flight for the whole test.
  getGameChangerNames: () =>
    new Promise<Set<string>>((resolve) => {
      live.release = resolve;
    }),
  getGameChangerNamesNow: () => new Set(['Snapshot Game Changer']),
}));
vi.mock('./coach-objective', () => ({
  coachCombos: () => [],
  protectionSourcesFrom: () => [],
  loadCoachObjective: async (_deck: unknown, env: CoachObjectiveEnv) => {
    seen.gameChangerNames = env.gameChangerNames;
    return { ok: false, reason: 'no-page' };
  },
}));

describe('loadSourcesObjective', () => {
  it('builds the objective from the Game Changer list at hand while the live fetch is pending', async () => {
    const { loadSourcesObjective } = await import('./objective-for-deck');
    const deck = { cards: [], commander: null } as unknown as Deck;

    const result = await loadSourcesObjective({ deck, combos: null, owned: [] });

    expect(result.ok).toBe(false);
    expect(seen.gameChangerNames?.has('Snapshot Game Changer')).toBe(true);
    live.release(new Set());
  });
});
