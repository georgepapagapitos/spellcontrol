// Pure helper for refresh-sld-drops.mjs: the bonus cards each Secret Lair
// Commander Deck ships beside its 100. No network, no fs.
//
// MTGJSON's compiled deck files (decks/<fileName>.json, what the product import
// reads) leave these out: Odds and Ends' foil Perplexing Chimera #7039, Goblin
// Storm's Moggcatcher #7081 and the rest live only in the upstream sealed-content
// YAML, either as a structured `card` entry or as an `other` line such as
// "foil Perplexing Chimera (7039)". The backend adds them to the product as its
// `bonus` zone (backend/src/product-map.ts withBonusCards).

/** "foil Perplexing Chimera (7039)" → finish word, name, collector number. */
const OTHER_CARD = /^(?:(foil|etched|nonfoil|non-foil)\s+)?(.+?)\s*\((\d+[a-z★]*)\)$/i;

/**
 * Bonus cards keyed by the MTGJSON deck name each product references, as
 * `[{ deck, cards: [{ name, number, foil }] }]` sorted by deck. A product with
 * no bonus card is left out; a number listed twice for one deck is kept once.
 */
export function deckBonusCards(products) {
  const byDeck = new Map();
  for (const product of Object.values(products ?? {})) {
    // A plain drop (BOX_SET) also names a "deck" for its own cards; only a
    // commander deck has a 100 that its bonus cards ride beside.
    if (product?.category !== 'DECK') continue;
    const blocks = product.contents ?? {};
    const decks = (blocks.deck ?? []).map((d) => d?.name).filter(Boolean);
    if (decks.length === 0) continue;
    const cards = [];
    for (const c of blocks.card ?? []) {
      if (String(c?.set ?? '').toLowerCase() !== 'sld' || c?.number === undefined || !c?.name)
        continue;
      cards.push({ name: c.name, number: String(c.number), foil: Boolean(c.foil || c.etched) });
    }
    for (const o of blocks.other ?? []) {
      const m = OTHER_CARD.exec(String(o?.name ?? '').trim());
      if (!m) continue; // "Coin", "10 Double Faced Tokens": not a card
      const finish = (m[1] ?? '').toLowerCase();
      cards.push({ name: m[2], number: m[3], foil: finish === 'foil' || finish === 'etched' });
    }
    if (cards.length === 0) continue;
    for (const deck of decks) {
      const list = byDeck.get(deck) ?? [];
      for (const card of cards) {
        if (!list.some((c) => c.number === card.number)) list.push(card);
      }
      byDeck.set(deck, list);
    }
  }
  return [...byDeck.entries()]
    .map(([deck, cards]) => ({ deck, cards }))
    .sort((a, b) => a.deck.localeCompare(b.deck));
}
