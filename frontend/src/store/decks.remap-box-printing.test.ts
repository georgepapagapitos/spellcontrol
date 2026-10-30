/**
 * Guard: an In the box slot names an exact physical card, so `remapAllocations`
 * (every boot, every collection edit) binds it only to a copy of its own
 * printing. Odds & Ends ships Yennett #2121 in the command zone and a display
 * #1019 in the box; the name fallback gave the #1019 slot a spare #2121, so the
 * box read as a second copy of the commander.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApplyingServer } from '@/lib/sync/applying-server';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { useDecksStore, type Deck } from './decks';

vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));

const NAME = 'Yennett, Cryptic Sovereign';
const CMD = '0ba9362f-eb35-4e72-8c51-7047c0a3f648'; // SLD #2121
const DISPLAY = 'c4e4bcb1-e9c8-4b45-a780-986f7a38d199'; // SLD #1019

const copy = (copyId: string, scryfallId: string): EnrichedCard =>
  ({
    copyId,
    name: NAME,
    scryfallId,
    finish: 'foil',
    foil: true,
    purchasePrice: 1,
  }) as EnrichedCard;

const deckWithBox = (boxCopyId: string | null): Deck => ({
  id: 'd1',
  name: 'Odds & Ends',
  source: 'manual',
  format: 'commander',
  commander: { name: NAME, id: CMD } as ScryfallCard,
  partnerCommander: null,
  commanderAllocatedCopyId: 'cmd',
  partnerCommanderAllocatedCopyId: null,
  cards: [],
  sideboard: [],
  considering: [],
  extras: [
    {
      slotId: 'box',
      card: { name: NAME, id: DISPLAY } as ScryfallCard,
      allocatedCopyId: boxCopyId,
    },
  ],
  generationContext: null,
  color: '#7a8a70',
  createdAt: 0,
  updatedAt: 0,
});

const boxCopy = () => useDecksStore.getState().decks[0].extras![0].allocatedCopyId;

describe('remapAllocations: In the box keeps to its printing', () => {
  beforeEach(() => setApplyingServer(false));

  it('leaves the box slot without a copy when only the commander printing is free', () => {
    useDecksStore.setState({ decks: [deckWithBox(null)], hydrated: true });
    useDecksStore.getState().remapAllocations([copy('cmd', CMD), copy('spare', CMD)], []);
    expect(useDecksStore.getState().decks[0].commanderAllocatedCopyId).toBe('cmd');
    expect(boxCopy()).toBeNull();
  });

  it('drops a wrong-printing copy the box slot already held', () => {
    useDecksStore.setState({ decks: [deckWithBox('spare')], hydrated: true });
    useDecksStore.getState().remapAllocations([copy('cmd', CMD), copy('spare', CMD)], []);
    expect(boxCopy()).toBeNull();
  });

  it('binds the display printing when it is owned', () => {
    useDecksStore.setState({ decks: [deckWithBox(null)], hydrated: true });
    useDecksStore
      .getState()
      .remapAllocations([copy('cmd', CMD), copy('spare', CMD), copy('display', DISPLAY)], []);
    expect(boxCopy()).toBe('display');
  });
});
