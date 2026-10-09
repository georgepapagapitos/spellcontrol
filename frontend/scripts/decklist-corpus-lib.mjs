// Pure parts of the decklist corpus (E516): no network, no fs. The fetch and
// fit scripts (decklist-corpus.mjs, deck-objective-fit.mjs) import these, and
// decklist-corpus-lib.test.mjs pins them.
//
// A corpus deck is { source, commander, partner?, bracket, weight, cards }:
// `cards` is [{ name, qty }] for the 99 (or fewer, when a source is
// incomplete). No user identity is ever stored: sources that name a pilot or
// an owner have that field dropped at the parse step.

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Straighten curly apostrophes, the way the rest of the pipeline keys names. */
export const straight = (name) => name.replace(/[‘’]/g, "'").trim();

/** Collapse repeated names into [{ name, qty }], first-seen order. */
export function tally(names) {
  const m = new Map();
  for (const raw of names) {
    const name = straight(raw);
    if (name) m.set(name, (m.get(name) ?? 0) + 1);
  }
  return [...m].map(([name, qty]) => ({ name, qty }));
}

/** Total copies in a [{ name, qty }] list. */
export const countCards = (cards) => cards.reduce((s, c) => s + c.qty, 0);

/**
 * An EDHREC average-deck payload as a corpus deck, or null when it is a stub.
 * `payload.deck.cards` is { <Type>: [[name, qty], ...] }; the commander rides
 * in `payload.deck.commander`. Weight 1: the page is a mean of real decks.
 */
export function edhrecAverageDeck(payload, { bracket = 0 } = {}) {
  const grouped = payload?.deck?.cards;
  const commanders = payload?.deck?.commander;
  if (!grouped || typeof grouped !== 'object' || Array.isArray(grouped)) return null;
  if (!Array.isArray(commanders) || commanders.length === 0) return null;
  const cards = [];
  for (const rows of Object.values(grouped)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (Array.isArray(row) && typeof row[0] === 'string' && Number.isFinite(row[1]))
        cards.push({ name: straight(row[0]), qty: row[1] });
    }
  }
  if (countCards(cards) < 90) return null;
  const numDecks = payload?.container?.json_dict?.card?.num_decks ?? 0;
  return {
    source: 'edhrec-average',
    commander: straight(commanders[0]),
    partner: commanders[1] ? straight(commanders[1]) : null,
    bracket,
    weight: 1,
    numDecks,
    cards,
  };
}

/**
 * Tournament weight by bracket: cEDH lists skew a bracket-1-to-3 page, so
 * below bracket 4 they count a fraction of a normal deck; at 4+ they count in
 * full. Applied when the fit reads the corpus.
 */
export const TOURNAMENT_WEIGHT_BELOW_4 = 0.25;
export function tournamentWeight(bracket) {
  return bracket >= 4 ? 1 : TOURNAMENT_WEIGHT_BELOW_4;
}

/**
 * EDHTop16 entries (graphql `entries { commander { name } maindeck { name } }`)
 * as corpus decks. The pilot, the standing's player and the decklist URL are
 * not read. `maindeck` lists each name once, so basics lose their counts;
 * `padBasics` is filled in by the caller once color identity is known.
 */
export function edhtop16Decks(tournament) {
  const out = [];
  for (const e of tournament.entries ?? []) {
    const cmdr = e?.commander?.name;
    const main = e?.maindeck;
    if (!cmdr || !Array.isArray(main) || main.length < 60) continue;
    const parts = cmdr.split(' / ').length > 1 ? cmdr.split(' / ') : [cmdr];
    out.push({
      source: 'edhtop16',
      commander: straight(parts[0]),
      partner: parts[1] ? straight(parts[1]) : null,
      bracket: 5,
      weight: tournamentWeight(5),
      standing: e.standing ?? null,
      eventSize: tournament.size ?? null,
      cards: tally(main.map((c) => c.name)),
    });
  }
  return out;
}

/** A stable key for a deck's card list, to drop exact duplicates across events. */
export function deckKey(deck) {
  return [deck.commander, ...deck.cards.map((c) => `${c.qty}${c.name}`).sort()].join('|');
}

export function dedupeDecks(decks) {
  const seen = new Set();
  return decks.filter((d) => {
    const k = deckKey(d);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Unordered card pair counts over decks (each deck counts a pair once), for
 * the E517 co-occurrence artifact: { cards: [names], deckCount, pairs: [[i, j, n]] }.
 * `minDecks` drops cards seen in fewer decks, `minPair` drops rare pairs.
 */
export function cooccurrence(decks, { minDecks = 3, minPair = 2 } = {}) {
  const perCard = new Map();
  for (const d of decks) {
    for (const n of new Set(d.cards.map((c) => c.name))) perCard.set(n, (perCard.get(n) ?? 0) + 1);
  }
  const cards = [...perCard]
    .filter(([, n]) => n >= minDecks)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([n]) => n);
  const index = new Map(cards.map((n, i) => [n, i]));
  const pair = new Map();
  for (const d of decks) {
    const ids = [
      ...new Set(d.cards.map((c) => index.get(c.name)).filter((i) => i !== undefined)),
    ].sort((a, b) => a - b);
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        const k = ids[a] * 65536 + ids[b];
        pair.set(k, (pair.get(k) ?? 0) + 1);
      }
  }
  const pairs = [...pair]
    .filter(([, n]) => n >= minPair)
    .map(([k, n]) => [Math.floor(k / 65536), k % 65536, n]);
  return {
    cards,
    deckCounts: cards.map((n) => perCard.get(n)),
    deckCount: decks.length,
    pairs,
  };
}

/**
 * Choose `k` swaps for a deck: each takes a removable card out and a
 * plausible same-role candidate in. Pure; the caller supplies reads.
 *
 *   removable  [{ name, role, incl }]   non-land, non-commander deck cards
 *   candidates [{ name, role, incl }]   page cards not in the deck, in identity
 *   mode       'random'   weighted by inclusion (plausible, may be a downgrade)
 *              'matched'  inclusion within `band` points of the card it replaces,
 *                         so the quality prior can't decide the pair alone
 *
 * "Same role" is `role` equality (null matches null). Returns
 * [{ out, in }] with distinct cards on both sides; fewer than `k` when the
 * pool runs dry.
 */
export function chooseSwaps({ removable, candidates, k, mode, rand, band = 5 }) {
  const outs = [...removable];
  for (let i = outs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [outs[i], outs[j]] = [outs[j], outs[i]];
  }
  const taken = new Set();
  const swaps = [];
  for (const out of outs) {
    if (swaps.length >= k) break;
    let pool = candidates.filter((c) => !taken.has(c.name) && c.role === out.role);
    if (mode === 'matched') {
      const near = pool.filter((c) => Math.abs(c.incl - out.incl) <= band);
      if (near.length === 0) continue;
      pool = near;
    }
    if (pool.length === 0) continue;
    let pick;
    if (mode === 'matched') {
      pick = pool[Math.floor(rand() * pool.length)];
    } else {
      const total = pool.reduce((s, c) => s + Math.max(c.incl, 0.1), 0);
      let r = rand() * total;
      pick = pool[pool.length - 1];
      for (const c of pool) {
        r -= Math.max(c.incl, 0.1);
        if (r <= 0) {
          pick = c;
          break;
        }
      }
    }
    taken.add(pick.name);
    swaps.push({ out: out.name, in: pick.name });
  }
  return swaps;
}
