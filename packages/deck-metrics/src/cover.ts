// ── Deck cover ──────────────────────────────────────────────────────────────
//
// Which card's art stands for a deck: the index tile, the deck page hero, a
// published deck's tile and its link preview. One definition for the app and
// the server, so a deck never wears one face in My Decks and another on its
// public page.
//
// Cards arrive as the raw Scryfall shape, which the backend holds as opaque
// JSONB, so every field is read defensively and a malformed card is skipped
// rather than thrown on.

/** The deck slice the pick reads. `C` is the caller's card type. */
export interface DeckCoverInput<C> {
  commander?: C | null;
  partnerCommander?: C | null;
  /** One slot per physical copy, as the deck stores them. */
  cards?: ReadonlyArray<{ card: C }> | null;
  /** The owner's pick, by card name so a printing swap keeps it. */
  coverCardName?: string | null;
}

type Rec = Record<string, unknown>;

function rec(x: unknown): Rec | undefined {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : undefined;
}

function str(x: unknown): string | undefined {
  return typeof x === 'string' && x ? x : undefined;
}

function frontFace(card: Rec): Rec | undefined {
  return Array.isArray(card.card_faces) ? rec(card.card_faces[0]) : undefined;
}

/** Has something to paint: an art crop, or the normal scan an offline card
 *  derives its crop from. */
export function coverHasArt(raw: unknown): boolean {
  const card = rec(raw);
  if (!card) return false;
  const images = rec(card.image_uris) ?? rec(frontFace(card)?.image_uris);
  return !!(str(images?.art_crop) ?? str(images?.normal));
}

// The front face decides: a spell with a land on its back is still a spell.
function frontType(card: Rec): string {
  return (str(card.type_line) ?? str(frontFace(card)?.type_line) ?? '').split('//')[0];
}

function isLand(card: Rec): boolean {
  return /\bLand\b/.test(frontType(card));
}

function isThreat(card: Rec): boolean {
  return /\b(Creature|Planeswalker)\b/.test(frontType(card));
}

function isBasicLand(card: Rec): boolean {
  return /\bBasic\b/.test(str(card.type_line) ?? '');
}

function price(card: Rec): number {
  const prices = rec(card.prices);
  for (const key of ['usd', 'usd_foil', 'usd_etched', 'eur']) {
    const n = Number.parseFloat(str(prices?.[key]) ?? '');
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function rank(card: Rec): number {
  return typeof card.edhrec_rank === 'number' ? card.edhrec_rank : Infinity;
}

/**
 * The card whose art covers the deck, or undefined when nothing has art.
 *
 * 1. The owner's pick, while a card of that name is still in the deck.
 * 2. The commander, then the partner.
 * 3. The deck's signature card: most copies first (a 60-card deck's 4-of is
 *    what it is named after, and in Pauper price barely separates anything),
 *    then a creature or planeswalker over a spell (mono blue Terror runs four
 *    Ponders too, and the Terror is the deck), then price, then the more
 *    iconic card by EDHREC rank. Lands are passed
 *    over while any spell has art, since the priciest card in a Modern deck
 *    is usually a fetch land and says nothing about the deck; a basic is the
 *    last resort.
 */
export function pickDeckCover<C>(deck: DeckCoverInput<C>): C | undefined {
  const slots = Array.isArray(deck.cards) ? deck.cards : [];
  const cards = slots.map((s) => rec(s)?.card).filter((c) => coverHasArt(c)) as C[];
  const commanders = [deck.commander, deck.partnerCommander].filter((c): c is C => coverHasArt(c));

  const chosen = str(deck.coverCardName);
  if (chosen) {
    const match = [...commanders, ...cards].find((c) => rec(c)?.name === chosen);
    if (match) return match;
  }
  if (commanders.length) return commanders[0];

  const copies = new Map<string, number>();
  for (const c of cards) {
    const name = str(rec(c)?.name) ?? '';
    copies.set(name, (copies.get(name) ?? 0) + 1);
  }
  const tier = (card: Rec) => (isBasicLand(card) ? 2 : isLand(card) ? 1 : 0);

  let best: C | undefined;
  let bestKey: number[] | undefined;
  for (const c of cards) {
    const card = rec(c)!;
    const key = [
      -tier(card),
      copies.get(str(card.name) ?? '') ?? 0,
      isThreat(card) ? 1 : 0,
      price(card),
      -rank(card),
    ];
    if (!bestKey || isGreater(key, bestKey)) {
      best = c;
      bestKey = key;
    }
  }
  return best;
}

function isGreater(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
