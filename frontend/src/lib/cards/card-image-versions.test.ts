// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTests,
  deckPrintingIds,
  freshImageUrl,
  freshenCollectionImages,
  freshenDeckImages,
  freshenScryfallCard,
  loadImageVersions,
  setImageVersions,
} from './card-image-versions';
import type { Deck } from '@/store/decks';

// Perplexing Chimera (SLD 7039): Scryfall's first image was a phone photo of a
// foil; the scan replaced it on 2026-10-04 under stamp 1791120518.
const CHIMERA = '81cea94d-e8a2-4c88-b121-9806eb7cc210';
const url = (size: string, stamp?: number, face = 'front') =>
  `https://cards.scryfall.io/${size}/${face}/8/1/${CHIMERA}.jpg${stamp ? `?${stamp}` : ''}`;
const OLD = 1790000000;
const NEW = 1791120518;

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
});

describe('freshImageUrl', () => {
  it('moves a stored URL onto a newer stamp', () => {
    setImageVersions({ [CHIMERA]: String(NEW) });
    expect(freshImageUrl(url('normal', OLD))).toBe(url('normal', NEW));
    expect(freshImageUrl(url('art_crop', OLD))).toBe(url('art_crop', NEW));
  });

  it('adds a stamp to a URL stored without one', () => {
    setImageVersions({ [CHIMERA]: String(NEW) });
    expect(freshImageUrl(url('small'))).toBe(url('small', NEW));
  });

  // A card resolved after the swap already carries the newest stamp; an older
  // entry in the map must never pull it back onto the photo.
  it('never moves a URL backward', () => {
    setImageVersions({ [CHIMERA]: String(OLD) });
    const current = url('normal', NEW);
    expect(freshImageUrl(current)).toBe(current);
  });

  it('leaves unknown printings, other hosts and empty values alone', () => {
    setImageVersions({ [CHIMERA]: String(NEW) });
    const other =
      'https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000001.jpg?1';
    expect(freshImageUrl(other)).toBe(other);
    const elsewhere = `https://example.com/${CHIMERA}.jpg?1`;
    expect(freshImageUrl(elsewhere)).toBe(elsewhere);
    expect(freshImageUrl(undefined)).toBeUndefined();
    expect(freshImageUrl(null)).toBeNull();
  });
});

describe('setImageVersions', () => {
  it('reports a change only when a stamp moves forward, and persists it', () => {
    expect(setImageVersions({ [CHIMERA]: String(OLD) })).toBe(true);
    expect(setImageVersions({ [CHIMERA]: String(OLD) })).toBe(false);
    expect(setImageVersions({ [CHIMERA]: String(OLD - 1) })).toBe(false);
    expect(setImageVersions({ [CHIMERA]: 'not-a-number' })).toBe(false);
    expect(setImageVersions({ [CHIMERA]: String(NEW) })).toBe(true);

    _resetForTests();
    loadImageVersions();
    expect(freshImageUrl(url('normal', OLD))).toBe(url('normal', NEW));
  });

  it('survives a corrupt stored map', () => {
    localStorage.setItem('spellcontrol:card-image-versions', '{not json');
    loadImageVersions();
    expect(freshImageUrl(url('normal', OLD))).toBe(url('normal', OLD));
  });
});

describe('freshenCollectionImages', () => {
  it('rewrites every image field and keeps the array when nothing moved', () => {
    const cards = [
      { scryfallId: CHIMERA, imageSmall: url('small', OLD), imageNormal: url('normal', OLD) },
      { scryfallId: 'other', imageNormal: 'https://cards.scryfall.io/normal/front/a/b/x.jpg?1' },
    ];
    expect(freshenCollectionImages(cards)).toBe(cards);

    setImageVersions({ [CHIMERA]: String(NEW) });
    const out = freshenCollectionImages(cards);
    expect(out[0]).toEqual({
      scryfallId: CHIMERA,
      imageSmall: url('small', NEW),
      imageNormal: url('normal', NEW),
    });
    expect(out[1]).toBe(cards[1]);
    expect(freshenCollectionImages(out)).toBe(out);
  });
});

describe('freshenScryfallCard', () => {
  it('rewrites top-level image_uris without adding card_faces', () => {
    setImageVersions({ [CHIMERA]: String(NEW) });
    const card = {
      id: CHIMERA,
      image_uris: { normal: url('normal', OLD), large: url('large', OLD) },
    };
    const out = freshenScryfallCard(card);
    expect(out.image_uris).toEqual({ normal: url('normal', NEW), large: url('large', NEW) });
    expect('card_faces' in out).toBe(false);
    expect(freshenScryfallCard(out)).toBe(out);
    expect(freshenScryfallCard(null)).toBeNull();
  });

  it('rewrites both faces of a double-faced card', () => {
    setImageVersions({ [CHIMERA]: String(NEW) });
    const card = {
      id: CHIMERA,
      card_faces: [
        { image_uris: { normal: url('normal', OLD) } },
        { image_uris: { normal: url('normal', OLD, 'back') } },
      ],
    };
    const out = freshenScryfallCard(card);
    expect(out.card_faces?.map((f) => f.image_uris?.normal)).toEqual([
      url('normal', NEW),
      url('normal', NEW, 'back'),
    ]);
    expect('image_uris' in out).toBe(false);
  });
});

describe('freshenDeckImages', () => {
  const deck = (): Deck =>
    ({
      id: 'd1',
      commander: { id: CHIMERA, image_uris: { normal: url('normal', OLD) } },
      partnerCommander: null,
      cards: [{ slotId: 's1', card: { id: CHIMERA, image_uris: { normal: url('normal', OLD) } } }],
      sideboard: [],
      considering: [],
    }) as unknown as Deck;

  it('rewrites the commander and every slot, and keeps unchanged decks', () => {
    const decks = [deck()];
    expect(freshenDeckImages(decks)).toBe(decks);

    setImageVersions({ [CHIMERA]: String(NEW) });
    const out = freshenDeckImages(decks);
    expect(out[0].commander?.image_uris?.normal).toBe(url('normal', NEW));
    expect(out[0].cards[0].card.image_uris?.normal).toBe(url('normal', NEW));
    expect(out[0].cards[0].slotId).toBe('s1');
    expect(out[0].sideboard).toBe(decks[0].sideboard);
    expect(freshenDeckImages(out)).toBe(out);
  });

  it('lists every printing a deck holds once', () => {
    const d = {
      ...deck(),
      // Fixture shapes only: the id is all deckPrintingIds reads.
      partnerCommander: { id: 'p' },
      sideboard: [{ card: { id: 's' } }],
      considering: [{ card: { id: CHIMERA } }],
    } as unknown as Deck;
    expect(deckPrintingIds([d]).sort()).toEqual([CHIMERA, 'p', 's'].sort());
  });
});
