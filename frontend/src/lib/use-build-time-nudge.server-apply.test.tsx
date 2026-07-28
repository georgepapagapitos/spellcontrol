// @vitest-environment happy-dom
//
// Separate file from use-build-time-nudge.test.tsx on purpose: that file
// mocks './sync' outright (to dodge an unrelated dynamic-import/act() test
// flake — see its own comment), which would make a "real server-apply"
// assertion here meaningless. This file mocks only the network edge
// (./auth-api) and drives the actual startSync -> applyServerRows ->
// rehydrateStoresFromIdb pipeline, exactly like sync.test.ts's own E177
// token test — not a hand-mocked stand-in for "a server write happened".
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

vi.mock('./auth-api', () => ({
  pullSync: vi.fn(),
  pushSync: vi.fn(),
}));
vi.mock('./platform', () => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));

import { startSync, stopSyncAndWipeLocal } from './sync';
import { pullSync, pushSync } from './auth-api';
import * as estore from './entity-store';
import * as queue from './mutation-queue';
import * as cardPrices from './card-prices';
import { useDecksStore, getLocalMutationToken } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';
import { useBuildTimeNudge } from './use-build-time-nudge';

const mockPull = pullSync as unknown as ReturnType<typeof vi.fn>;
const mockPush = pushSync as unknown as ReturnType<typeof vi.fn>;

function combos(over: Partial<ComboMatchResponse> = {}): ComboMatchResponse {
  return { inDeck: [], oneAway: [], almostInCollection: [], ...over };
}

beforeEach(async () => {
  vi.clearAllMocks();
  estore._resetDbPromiseForTests();
  queue._resetDbPromiseForTests();
  cardPrices._resetForTests();
  localStorage.clear();
  await estore.wipeAll();
  await queue.clear();
  mockPull.mockResolvedValue({ rows: [], cursor: 0, hasMore: false });
  mockPush.mockResolvedValue({ applied: [], cursor: 0 });
});

afterEach(async () => {
  cleanup();
  await stopSyncAndWipeLocal();
});

describe('useBuildTimeNudge — real server-apply path (E177 token guard)', () => {
  it('does not fire when a pulled deck row (applyServerRows -> rehydrateStoresFromIdb) supplies the winning data, with no local mutation since baseline', async () => {
    // 1) A first real pull creates the deck, mirroring sync.test.ts's own
    // "does not bump the local-mutation token" test.
    mockPull.mockResolvedValueOnce({
      rows: [
        {
          kind: 'deck',
          id: 'd-server',
          data: {
            id: 'd-server',
            source: 'manual',
            commander: { name: 'Kess, Dissident Mage' },
            cards: [],
          },
          rev: 1,
          deletedAt: null,
        },
      ],
      cursor: 1,
      hasMore: false,
    });
    await startSync('user-1');
    expect(useDecksStore.getState().decks.some((d) => d.id === 'd-server')).toBe(true);
    expect(getLocalMutationToken('d-server')).toBe(0);

    // 2) Arm the hook for a card the user was about to add locally — but
    // never actually add it. The baseline token is snapshotted here.
    const { result, rerender } = renderHook(
      (p: Parameters<typeof useBuildTimeNudge>[0]) => useBuildTimeNudge(p),
      {
        initialProps: {
          deckId: 'd-server',
          deck: useDecksStore.getState().decks.find((d) => d.id === 'd-server') ?? null,
          comboData: null as ComboMatchResponse | null,
          mainboardTarget: 99,
        },
      }
    );
    act(() => result.current.notifyMainboardAdd("Thassa's Oracle"));
    const baselineToken = getLocalMutationToken('d-server');

    // 3) A SECOND real pull — another device's edit lands via the real
    // sync pipeline, coincidentally supplying a card + a win condition that
    // would satisfy the hook's signal if it were misattributed to the local
    // arm above. This is the exact shape of the false positive E177 exists
    // to prevent.
    mockPull.mockResolvedValueOnce({
      rows: [
        {
          kind: 'deck',
          id: 'd-server',
          data: {
            id: 'd-server',
            source: 'manual',
            commander: { name: 'Kess, Dissident Mage' },
            cards: [{ slotId: 's1', card: { name: "Thassa's Oracle", id: 'sf-1' } }],
            winConditions: {
              primary: {
                category: 'alt-win',
                label: 'Alt win',
                summary: 'Win by emptying your library.',
                evidence: ["Thassa's Oracle"],
                score: 10,
              },
              secondary: [],
              noClearWinCondition: false,
            },
          },
          rev: 2,
          deletedAt: null,
        },
      ],
      cursor: 2,
      hasMore: false,
    });
    await act(async () => {
      await startSync('user-1');
    });

    // The real pipeline actually applied the new data...
    const settled = useDecksStore.getState().decks.find((d) => d.id === 'd-server');
    expect(settled?.winConditions?.primary?.category).toBe('alt-win');
    // ...but never through touch() — the guard's premise.
    expect(getLocalMutationToken('d-server')).toBe(baselineToken);

    const combo = combos();
    rerender({ deckId: 'd-server', deck: settled ?? null, comboData: combo, mainboardTarget: 99 });

    expect(result.current.nudge).toBeNull();
  });
});
