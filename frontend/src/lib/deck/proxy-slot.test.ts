import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import type { EnrichedCard } from '@/types/index';
import { planProxyToggle, proxyToastMessage } from './proxy-slot';

const DRYAD = 'Dryad of the Ilysian Grove';
const copy = { copyId: 'c1', name: DRYAD, scryfallId: 'sf-thb', finish: 'nonfoil' } as EnrichedCard;

const slot = (slotId: string, allocatedCopyId: string | null, proxy?: true): DeckCard => ({
  slotId,
  card: { name: DRYAD, id: 'sf-thb' } as ScryfallCard,
  allocatedCopyId,
  ...(proxy && { proxy }),
});

const deck = (id: string, cards: DeckCard[], sideboard: DeckCard[] = []): Deck =>
  ({ id, name: `Deck ${id}`, cards, sideboard, considering: [] }) as unknown as Deck;

describe('planProxyToggle', () => {
  it('hands the copy to another deck waiting on the card', () => {
    const self = deck('self', [slot('a', null), slot('b', 'c1')]);
    const decks = [self, deck('other', [slot('o', null)])];
    const plan = planProxyToggle(self, ['a', 'b'], true, [copy], decks, []);
    expect(plan).toMatchObject({ kind: 'hand-over', slot: { slotId: 'b' } });
    expect(proxyToastMessage(plan!)).toBe(
      `${DRYAD} is a proxy here. Your copy moved to Deck other.`
    );
  });

  it('just frees the copy when no deck is waiting', () => {
    const self = deck('self', [slot('b', 'c1')]);
    const plan = planProxyToggle(self, ['b'], true, [copy], [self], []);
    expect(plan).toMatchObject({ kind: 'mark', freed: true });
    expect(proxyToastMessage(plan!)).toBe(`${DRYAD} is a proxy here. Your copy is free.`);
    const unbound = deck('self', [slot('u', null)]);
    const bare = planProxyToggle(unbound, ['u'], true, [], [unbound], []);
    expect(proxyToastMessage(bare!)).toBe(`${DRYAD} is a proxy here.`);
  });

  it('unmarks a slot in any zone and binds a free copy if there is one', () => {
    const self = deck('self', [], [slot('p', null, true)]);
    const plan = planProxyToggle(self, ['p'], false, [copy], [self], []);
    expect(plan).toMatchObject({ kind: 'unmark', copyId: 'c1' });
    expect(proxyToastMessage(plan!)).toBe(`Using your copy of ${DRYAD}`);
    const none = planProxyToggle(self, ['p'], false, [], [self], []);
    expect(proxyToastMessage(none!)).toBe(`${DRYAD} is no longer a proxy.`);
  });

  it('returns null when the row has nothing to flip', () => {
    const self = deck('self', [slot('p', null, true)]);
    expect(planProxyToggle(self, ['p'], true, [], [self], [])).toBeNull();
    expect(planProxyToggle(deck('x', [slot('u', null)]), ['u'], false, [], [], [])).toBeNull();
  });
});
