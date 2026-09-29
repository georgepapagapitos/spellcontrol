import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckCard } from '@/store/decks';
import type { EnrichedCard } from '@/types';
import {
  buildProxyTiles,
  cardFaces,
  chunkPages,
  isMissingSlot,
  proxySlots,
  retryUrl,
  selectProxyCards,
  TILES_PER_PAGE,
} from './proxy-sheet';

function card(name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    name,
    image_uris: { large: `https://cards.scryfall.io/large/${name}.jpg` },
    ...extra,
  } as unknown as ScryfallCard;
}

function slot(name: string, allocatedCopyId: string | null = null): DeckCard {
  return { slotId: `${name}-${Math.random()}`, card: card(name), allocatedCopyId };
}

const dfc = card('Delver of Secrets // Insectile Aberration', {
  image_uris: undefined,
  card_faces: [
    {
      name: 'Delver of Secrets',
      type_line: 'Creature',
      image_uris: { large: 'front.jpg' },
    },
    {
      name: 'Insectile Aberration',
      type_line: 'Creature',
      image_uris: { large: 'back.jpg' },
    },
  ],
} as Partial<ScryfallCard>);

const collection = new Map([['owned-1', { copyId: 'owned-1' } as unknown as EnrichedCard]]);

const baseDeck = {
  commander: card('Krenko, Mob Boss'),
  partnerCommander: null,
  commanderAllocatedCopyId: 'owned-1',
  partnerCommanderAllocatedCopyId: null,
  cards: [
    slot('Sol Ring'),
    slot('Goblin Guide', 'owned-1'),
    slot('Mountain'),
    slot('Arcane Signet'),
  ],
  sideboard: [slot('Pyroblast')],
};

describe('proxySlots', () => {
  it('puts commanders first, then the mainboard by name, and the sideboard only when asked', () => {
    expect(proxySlots(baseDeck, false).map((s) => s.card.name)).toEqual([
      'Krenko, Mob Boss',
      'Arcane Signet',
      'Goblin Guide',
      'Mountain',
      'Sol Ring',
    ]);
    expect(proxySlots(baseDeck, true).map((s) => s.card.name)).toContain('Pyroblast');
  });

  it('includes a partner with its own allocation', () => {
    const deck = {
      ...baseDeck,
      partnerCommander: card('Thrasios'),
      partnerCommanderAllocatedCopyId: 'gone',
      cards: [],
    };
    const slots = proxySlots(deck, false);
    expect(slots.map((s) => s.card.name)).toEqual(['Krenko, Mob Boss', 'Thrasios']);
    expect(slots[1].allocatedCopyId).toBe('gone');
  });

  it('treats a missing sideboard as empty', () => {
    const deck = { ...baseDeck, sideboard: undefined as unknown as DeckCard[] };
    expect(proxySlots(deck, true)).toHaveLength(5);
  });
});

describe('isMissingSlot', () => {
  it('matches the deck view: only a slot bound to a copy the collection holds is owned', () => {
    expect(isMissingSlot({ card: card('A'), allocatedCopyId: 'owned-1' }, collection)).toBe(false);
    expect(isMissingSlot({ card: card('A'), allocatedCopyId: 'gone' }, collection)).toBe(true);
    expect(isMissingSlot({ card: card('A'), allocatedCopyId: null }, collection)).toBe(true);
  });
});

describe('selectProxyCards', () => {
  const slots = proxySlots(baseDeck, false);

  it('prints only the missing copies, skipping basics', () => {
    const names = selectProxyCards(slots, { scope: 'missing', skipBasics: true }, collection).map(
      (c) => c.name
    );
    expect(names).toEqual(['Arcane Signet', 'Sol Ring']);
  });

  it('counts an unowned commander as missing', () => {
    const deck = { ...baseDeck, commanderAllocatedCopyId: null };
    const names = selectProxyCards(
      proxySlots(deck, false),
      { scope: 'missing', skipBasics: true },
      collection
    ).map((c) => c.name);
    expect(names[0]).toBe('Krenko, Mob Boss');
  });

  it('prints the whole deck, basics too when not skipped', () => {
    const names = selectProxyCards(slots, { scope: 'deck', skipBasics: false }, collection).map(
      (c) => c.name
    );
    expect(names).toEqual([
      'Krenko, Mob Boss',
      'Arcane Signet',
      'Goblin Guide',
      'Mountain',
      'Sol Ring',
    ]);
  });

  it('keeps one entry per copy, so a 4-of prints four times', () => {
    const deck = { ...baseDeck, commander: null, cards: [1, 2, 3, 4].map(() => slot('Opt')) };
    const cards = selectProxyCards(
      proxySlots(deck, false),
      { scope: 'deck', skipBasics: true },
      collection
    );
    expect(cards).toHaveLength(4);
  });
});

describe('cardFaces', () => {
  it('prints both faces of a double-faced card, back after front', () => {
    expect(cardFaces(dfc)).toEqual([
      { name: 'Delver of Secrets', back: false, imageUrl: 'front.jpg' },
      { name: 'Insectile Aberration', back: true, imageUrl: 'back.jpg' },
    ]);
  });

  it('prints a split or adventure card once, off its single image', () => {
    const split = card('Fire // Ice', {
      card_faces: [
        { name: 'Fire', type_line: 'Instant' },
        { name: 'Ice', type_line: 'Instant' },
      ],
    } as Partial<ScryfallCard>);
    expect(cardFaces(split)).toEqual([
      {
        name: 'Fire // Ice',
        back: false,
        imageUrl: 'https://cards.scryfall.io/large/Fire // Ice.jpg',
      },
    ]);
  });

  it('falls back to the first face image, or none', () => {
    const faceOnly = card('X', {
      image_uris: undefined,
      card_faces: [{ name: 'X', type_line: 'Creature', image_uris: { large: 'x.jpg' } }],
    } as Partial<ScryfallCard>);
    expect(cardFaces(faceOnly)[0].imageUrl).toBe('x.jpg');
    expect(cardFaces(card('Y', { image_uris: undefined }))[0].imageUrl).toBeUndefined();
  });
});

describe('buildProxyTiles', () => {
  it('expands faces in order with unique keys', () => {
    const tiles = buildProxyTiles([card('Opt'), dfc, card('Opt')]);
    expect(tiles.map((t) => t.name)).toEqual([
      'Opt',
      'Delver of Secrets',
      'Insectile Aberration',
      'Opt',
    ]);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(4);
  });
});

describe('chunkPages', () => {
  it('splits into pages of nine, the last one partial', () => {
    const pages = chunkPages(Array.from({ length: 20 }, (_, i) => i));
    expect(TILES_PER_PAGE).toBe(9);
    expect(pages.map((p) => p.length)).toEqual([9, 9, 2]);
    expect(chunkPages([])).toEqual([]);
  });
});

describe('retryUrl', () => {
  it('leaves the first attempt alone and busts the cache after', () => {
    expect(retryUrl('https://x/a.jpg?123', 0)).toBe('https://x/a.jpg?123');
    expect(retryUrl('https://x/a.jpg?123', 2)).toBe('https://x/a.jpg?123&retry=2');
    expect(retryUrl('https://x/a.jpg', 1)).toBe('https://x/a.jpg?retry=1');
  });
});
