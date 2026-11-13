// @vitest-environment happy-dom
/**
 * The command zone has no deck slot, so its ⋮ menu had no Edit printing: a
 * commander saved as the default printing could not be moved to the copy you
 * own (2026-11-13). The seat is addressed by COMMANDER_SEAT / PARTNER_SEAT.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types/index';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { useToastsStore } from '@/store/toasts';
import { setApplyingServer } from '@/lib/sync/applying-server';
import { COMMANDER_SEAT, PARTNER_SEAT } from '@/lib/deck/deck-seat';
import { useDeckPrintingEdits } from './use-deck-printing-edits';

vi.mock('@/lib/sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
  persistCubesState: vi.fn().mockResolvedValue(undefined),
}));

const print = (id: string, name = 'Queen Marchesa') =>
  ({ id, name, oracle_id: `o-${name}`, color_identity: ['W', 'B', 'R'] }) as ScryfallCard;
const DEFAULT = print('default-print');
const SLD = print('sld-2688');
const copy = (copyId: string, scryfallId: string, name = 'Queen Marchesa') =>
  ({ copyId, name, scryfallId, finish: 'nonfoil' }) as EnrichedCard;
const mySld = copy('my-sld', 'sld-2688');
const myOther = copy('my-default', 'default-print');

const makeDeck = (over: Partial<Deck>): Deck => ({
  id: 'd1',
  name: 'Queen Marchesa',
  source: 'generated',
  format: 'commander',
  commander: DEFAULT,
  partnerCommander: null,
  commanderAllocatedCopyId: 'my-default',
  partnerCommanderAllocatedCopyId: null,
  cards: [],
  sideboard: [],
  considering: [],
  generationContext: null,
  color: '#7a8a70',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const current = () => useDecksStore.getState().decks[0];
const hook = (cards: EnrichedCard[]) =>
  renderHook(() =>
    useDeckPrintingEdits({
      deck: current(),
      collectionCards: cards,
      executeReallocation: vi.fn(),
      applyDonorOutcome: vi.fn(),
    })
  ).result;

beforeEach(() => {
  setApplyingServer(false);
  useCubeStore.setState({ saved: [] });
  useToastsStore.setState({ toasts: [] });
});

describe('Edit printing on the command zone', () => {
  it('moves the commander to the printing you own and binds that copy', () => {
    useDecksStore.setState({ decks: [makeDeck({})] });
    const r = hook([mySld, myOther]);
    act(() => r.current.setEditingSlot({ slotId: COMMANDER_SEAT, card: DEFAULT }));
    act(() => r.current.handleEditConfirm({ card: SLD, finish: 'nonfoil' } as never));
    expect(current().commander?.id).toBe('sld-2688');
    expect(current().commanderAllocatedCopyId).toBe('my-sld');
    expect(current().cards).toEqual([]);
  });

  it('a printing you do not own leaves the commander unbound, never bound to another printing', () => {
    useDecksStore.setState({ decks: [makeDeck({})] });
    const r = hook([myOther]);
    act(() => r.current.setEditingSlot({ slotId: COMMANDER_SEAT, card: DEFAULT }));
    act(() => r.current.handleEditConfirm({ card: SLD, finish: 'nonfoil' } as never));
    expect(current().commander?.id).toBe('sld-2688');
    expect(current().commanderAllocatedCopyId).toBeNull();
  });

  it('edits the partner seat on its own', () => {
    const partner = print('p-default', 'Tymna the Weaver');
    const partnerSld = print('p-sld', 'Tymna the Weaver');
    useDecksStore.setState({ decks: [makeDeck({ partnerCommander: partner })] });
    const r = hook([myOther, copy('my-tymna', 'p-sld', 'Tymna the Weaver')]);
    act(() => r.current.setEditingSlot({ slotId: PARTNER_SEAT, card: partner }));
    act(() => r.current.handleEditConfirm({ card: partnerSld, finish: 'nonfoil' } as never));
    expect(current().partnerCommander?.id).toBe('p-sld');
    expect(current().partnerCommanderAllocatedCopyId).toBe('my-tymna');
    expect(current().commander?.id).toBe('default-print');
  });
});
