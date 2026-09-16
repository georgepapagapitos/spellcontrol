import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { FriendCard } from './cube/pool';

const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (names: string[]) => getCardsByNames(names),
}));

import { resolveFriendPreview } from './friend-preview';

function scry(over: Partial<ScryfallCard> & { id: string; name: string }): ScryfallCard {
  return {
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '1',
    rarity: 'rare',
    type_line: 'Artifact',
    cmc: 1,
    image_uris: { normal: 'n.jpg', small: 's.jpg', large: 'l.jpg', art_crop: 'a.jpg' },
    ...over,
  } as ScryfallCard;
}

function friendCard(name: string): FriendCard {
  return {
    name,
    oracleId: `o-${name}`,
    colors: [],
    colorIdentity: [],
    cmc: 1,
    typeLine: 'Artifact',
  } as FriendCard;
}

beforeEach(() => {
  getCardsByNames.mockReset();
  getCardsByNames.mockResolvedValue(new Map());
});

describe('resolveFriendPreview', () => {
  it('resolves every card by name in one batched lookup', async () => {
    getCardsByNames.mockResolvedValue(
      new Map([
        ['Sol Ring', scry({ id: 'sol-1', name: 'Sol Ring' })],
        ['Arcane Signet', scry({ id: 'sig-1', name: 'Arcane Signet' })],
      ])
    );

    const { cards } = await resolveFriendPreview([
      friendCard('Sol Ring'),
      friendCard('Arcane Signet'),
    ]);

    expect(getCardsByNames).toHaveBeenCalledTimes(1);
    expect(getCardsByNames).toHaveBeenCalledWith(['Sol Ring', 'Arcane Signet']);
    expect(cards.map((c) => c.name)).toEqual(['Sol Ring', 'Arcane Signet']);
  });

  it('maps a card to its slide THROUGH indexOf, so a dropped lookup never opens its neighbour', async () => {
    // The middle card fails to resolve. A positional index would then point
    // the third tile at the second slide — i.e. open the wrong card.
    getCardsByNames.mockResolvedValue(
      new Map([
        ['Sol Ring', scry({ id: 'sol-1', name: 'Sol Ring' })],
        ['Mana Crypt', scry({ id: 'crypt-1', name: 'Mana Crypt' })],
      ])
    );
    const tiles = [friendCard('Sol Ring'), friendCard('Nonesuch'), friendCard('Mana Crypt')];

    const { cards, indexOf } = await resolveFriendPreview(tiles);

    expect(cards).toHaveLength(2);
    expect(indexOf(tiles[2])).toBe(1);
    expect(cards[indexOf(tiles[2])].name).toBe('Mana Crypt');
    // The unresolved card reports no slide, so the caller can fall back.
    expect(indexOf(tiles[1])).toBe(-1);
  });

  it('degrades to an empty carousel when the lookup itself fails', async () => {
    // The caller toasts on this rather than opening an empty sheet.
    getCardsByNames.mockRejectedValue(new Error('offline'));

    const { cards, indexOf } = await resolveFriendPreview([friendCard('Sol Ring')]);

    expect(cards).toEqual([]);
    expect(indexOf(friendCard('Sol Ring'))).toBe(-1);
  });
});
