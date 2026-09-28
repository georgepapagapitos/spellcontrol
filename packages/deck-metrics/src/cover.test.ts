import { describe, expect, it } from 'vitest';
import { pickDeckCover } from './cover';

interface Card {
  name: string;
  type_line?: string;
  prices?: { usd?: string | null };
  edhrec_rank?: number;
  image_uris?: { art_crop?: string; normal?: string };
  card_faces?: Array<{ image_uris?: { normal?: string } }>;
}

function card(name: string, over: Partial<Card> = {}): Card {
  return {
    name,
    type_line: 'Creature — Wizard',
    prices: { usd: '0.10' },
    image_uris: { art_crop: `${name}.jpg` },
    ...over,
  };
}

const slots = (...cards: Card[]) => cards.map((c) => ({ card: c }));
const times = (n: number, c: Card) => Array.from({ length: n }, () => c);

describe('pickDeckCover', () => {
  it('uses the commander when there is one', () => {
    const cmdr = card('Jace');
    const sol = card('Sol Ring', { prices: { usd: '5' } });
    expect(pickDeckCover({ commander: cmdr, cards: slots(sol) })).toBe(cmdr);
  });

  it("uses the owner's pick over the commander, matched by name across printings", () => {
    const pick = card('Tolarian Terror', { image_uris: { art_crop: 'new-printing.jpg' } });
    const deck = { commander: card('Jace'), cards: slots(pick), coverCardName: 'Tolarian Terror' };
    expect(pickDeckCover(deck)).toBe(pick);
  });

  it('can pick the partner over the commander', () => {
    const partner = card('Tymna');
    const deck = { commander: card('Thrasios'), partnerCommander: partner, coverCardName: 'Tymna' };
    expect(pickDeckCover(deck)).toBe(partner);
  });

  it('falls back to the automatic pick when the chosen card left the deck', () => {
    const only = card('Delver');
    expect(pickDeckCover({ cards: slots(only), coverCardName: 'Gone' })).toBe(only);
  });

  it("prefers the deck's 4-of over a pricier 1-of", () => {
    const terror = card('Tolarian Terror', { prices: { usd: '0.25' } });
    const pricey = card('Pricey One-of', { prices: { usd: '3' } });
    expect(pickDeckCover({ cards: slots(...times(4, terror), pricey) })).toBe(terror);
  });

  it('breaks a copies tie toward a creature over a pricier spell', () => {
    const terror = card('Tolarian Terror', {
      type_line: 'Creature — Serpent',
      prices: { usd: '0.16' },
    });
    const ponder = card('Ponder', { type_line: 'Sorcery', prices: { usd: '1.80' } });
    expect(pickDeckCover({ cards: slots(...times(4, ponder), ...times(4, terror)) })).toBe(terror);
  });

  it('breaks a copies tie by price, then by EDHREC rank', () => {
    const cheap = card('Cheap', { prices: { usd: '1' }, edhrec_rank: 1 });
    const dear = card('Dear', { prices: { usd: '2' }, edhrec_rank: 900 });
    expect(pickDeckCover({ cards: slots(cheap, dear) })).toBe(dear);
    const obscure = card('Obscure', { prices: { usd: '2' }, edhrec_rank: 900 });
    const iconic = card('Iconic', { prices: { usd: '2' }, edhrec_rank: 10 });
    expect(pickDeckCover({ cards: slots(obscure, iconic) })).toBe(iconic);
  });

  it('passes over lands while a spell has art, and basics last of all', () => {
    const fetch = card('Scalding Tarn', { type_line: 'Land', prices: { usd: '30' } });
    const bolt = card('Lightning Bolt', { type_line: 'Instant', prices: { usd: '1' } });
    expect(pickDeckCover({ cards: slots(...times(4, fetch), bolt) })).toBe(bolt);
    const island = card('Island', { type_line: 'Basic Land — Island' });
    expect(pickDeckCover({ cards: slots(...times(20, island), fetch) })).toBe(fetch);
    expect(pickDeckCover({ cards: slots(island) })).toBe(island);
  });

  it('treats a spell with a land back as a spell', () => {
    const mdfc = card('Valakut Awakening // Valakut Stoneforge', {
      type_line: 'Instant // Land',
      prices: { usd: '2' },
    });
    const shock = card('Shock', { type_line: 'Instant', prices: { usd: '1' } });
    expect(pickDeckCover({ cards: slots(shock, mdfc) })).toBe(mdfc);
  });

  it('skips cards with no art, reads a front face, and is empty for an empty deck', () => {
    const bare = card('Bare', { image_uris: undefined, prices: { usd: '50' } });
    const faced = card('Faced', {
      image_uris: undefined,
      card_faces: [{ image_uris: { normal: 'n.jpg' } }],
    });
    expect(pickDeckCover({ cards: slots(bare, faced) })).toBe(faced);
    expect(pickDeckCover({ cards: [] })).toBeUndefined();
    expect(pickDeckCover({})).toBeUndefined();
  });

  it('survives malformed JSON from storage', () => {
    const good = card('Good');
    const deck = { cards: [null, { card: 'x' }, { card: good }], commander: 7 } as never;
    expect(pickDeckCover(deck)).toBe(good);
  });
});
