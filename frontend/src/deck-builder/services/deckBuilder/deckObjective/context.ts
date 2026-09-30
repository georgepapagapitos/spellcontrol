/**
 * Builds an ObjectiveContext: fills defaults, derives the page statistics the
 * quality prior reads, and memoizes every per-card read (facts, quality, mana
 * classification) so a local search that scores thousands of neighbouring
 * decks pays for each card once.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { getByCardName } from '@/lib/cards/card-text';
import { classifyManaCard, maskOf, type ManaCard } from '@/lib/mana-sim';
import { extractCardFacts } from '@/deck-builder/services/cardFacts/extract';
import {
  getCardFacts,
  type CardFacts,
  type FactsInputCard,
} from '@/deck-builder/services/cardFacts';
import { isExtraTurn } from '@/deck-builder/services/tagger/client';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { isMassLandDenialFloor, isStaxPiece } from '../bracketEstimator';
import { readSynergy } from '../synergyLift';
import { readFacts } from './factsReading';
import {
  TERM_KEYS,
  type CardQuality,
  type EdhrecRow,
  type ObjectiveContext,
  type ObjectiveContextInput,
  type TermKey,
} from './types';

/**
 * Every term is scaled into card-equivalents by its own constants (see each
 * term's file), so the prior weight of every term is 1. `weights` in the
 * context input multiplies these.
 */
export const DEFAULT_WEIGHTS: Readonly<Record<TermKey, number>> = Object.freeze(
  Object.fromEntries(TERM_KEYS.map((k) => [k, 1])) as Record<TermKey, number>
);

/** Fixed goldfish seed: every deck scored in one context sees the same shuffles. */
export const DEFAULT_SIM_SEED = 20260929;
/**
 * 4,000 games (130-180 ms per deck, most of a score's time). The mana term
 * is the only source of seed noise in the total. Measured as the standard
 * deviation, over five seeds, of the mana term's treatment − baseline delta:
 *
 * - 15 standard-panel pairs, library in name order: 0.39 card-equivalents at
 *   1,000 games, 0.19 at 4,000 (a card between the two swapped names moves,
 *   so the two decks share no shuffles);
 * - all 59 E509 + E510 pairs at 4,000 games: 0.238 in name order, 0.155 with
 *   the library in the deck's slot order and a per-game seed (terms/mana.ts,
 *   mana-sim's gameSeed), which gives a 1:1 swap common random numbers.
 */
export const DEFAULT_SIM_GAMES = 4000;

/**
 * Off-page read. A card absent from the page is played below the page's
 * floor by this commander's players; that is the evidence. But the page is
 * shaped by what people own, not only by what is good (Mox Diamond is off
 * most pages because it costs hundreds of dollars), so the read climbs part
 * of the way toward what cards of the same GLOBAL Commander popularity earn
 * ON this page:
 *
 *   q = floor + OFF_PAGE_TRUST × max(0, rankPeers − floor)
 *
 * where rankPeers is the median inclusion of the OFF_PAGE_PEERS on-page cards
 * nearest in log EDHREC rank (Scryfall's `edhrec_rank`, popularity across all
 * Commander decks). Half-way on purpose: the page's own silence is real
 * evidence, and a card is never read as 0 just for being absent.
 *
 * (The first cut used CubeCobra Elo peers. That read is not monotone in
 * Commander power: on Krenko's page, Mox Diamond, Elo 1838, read 9.1% and
 * Aetherjacket, Elo 1271, read 9.3%. Global EDHREC rank orders the two the
 * way the format does.)
 */
export const OFF_PAGE_TRUST = 0.5;

/**
 * Price-adjusted play rate: what STRONGER decks of this commander play.
 *
 * A page's inclusion averages every deck built for the commander, most of
 * them on a budget, so a premium card reads low for its price, not its power
 * (Smothering Tithe 23% on Edgar Markov's page, The One Ring 9%). The same
 * commander's bracket-4 ("optimized") page says how far: fit over 17
 * commanders (the LIVE_GEN panel's, 4,222 cards on both pages, 2026-09-29),
 *
 *   optimized% ≈ PRICE_A × page% + PRICE_B × page% × log10(1 + price)
 *
 * a = 0.788, b = 0.467; the price slope b/a is 0.59 (bootstrap over
 * commanders 0.49-0.76). Held out one commander at a time, the price term
 * beat a uniform rescaling on 17 of 17, cutting squared error 39% overall.
 * So a card's quality is its page rate scaled by PRICE_A + PRICE_B ×
 * log10(1 + price): Tithe reads 33% on Edgar, Cordial Vampire stays 82%, and a
 * $1 card keeps about its page rate. Capped at 1. Budget and collection
 * builds are unaffected where it matters: the budget constraint and the
 * ownership term price the card; this term only says what it is worth.
 *
 * (The first proposal was a blend with a commander-independent prior, the
 * page inclusion of cards of similar global EDHREC rank. Against the same
 * bracket-4 pages its best weight was −0.04, 95% CI −0.08 to 0.00: stronger
 * decks do not drift toward format-wide popularity, they drift toward price.)
 */
export const PRICE_A = 0.788;
export const PRICE_B = 0.467;
export const OFF_PAGE_PEERS = 25;
/** Floor used when a context has no page rows at all (a fallback pile). */
export const EMPTY_PAGE_FLOOR_PCT = 1;

const BASIC_NAMES = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
  'Snow-Covered Plains',
  'Snow-Covered Island',
  'Snow-Covered Swamp',
  'Snow-Covered Mountain',
  'Snow-Covered Forest',
  'Snow-Covered Wastes',
]);

export function isBasicLand(card: ScryfallCard): boolean {
  return BASIC_NAMES.has(card.name) || /\bBasic\b/.test(frontTypeLine(card));
}

export function frontTypeLine(card: ScryfallCard): string {
  return card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
}

export function isLandCard(card: ScryfallCard): boolean {
  return /\bLand\b/.test(frontTypeLine(card));
}

/** The Scryfall fields the facts extractor reads. */
export function toFactsInput(card: ScryfallCard): FactsInputCard {
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    layout: card.layout,
    type_line: card.type_line,
    mana_cost: card.mana_cost,
    oracle_text: card.oracle_text,
    keywords: card.keywords,
    loyalty: card.loyalty,
    power: card.power,
    toughness: card.toughness,
    cmc: card.cmc,
    card_faces: card.card_faces?.map((f) => ({
      name: f.name,
      type_line: f.type_line,
      mana_cost: f.mana_cost,
      oracle_text: f.oracle_text,
      loyalty: f.loyalty,
      power: f.power,
      toughness: f.toughness,
    })),
  };
}

/** Facts from the loaded snapshot, else extracted from the card's own text. */
export function defaultFactsOf(card: ScryfallCard): CardFacts {
  return getCardFacts(card) ?? extractCardFacts(toFactsInput(card));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The E510 synergy strength of a row, or null when the row carries no synergy. */
function strengthOf(row: EdhrecRow): number | null {
  const reading = readSynergy({
    inclusion: row.inclusion,
    synergy: row.synergy,
    potential_decks: row.potential_decks,
    num_decks: row.num_decks,
  });
  return reading ? reading.strength : null;
}

function round(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function createObjectiveContext(input: ObjectiveContextInput): ObjectiveContext {
  const weights = { ...DEFAULT_WEIGHTS };
  for (const [k, v] of Object.entries(input.weights ?? {})) {
    if (v !== undefined && (TERM_KEYS as readonly string[]).includes(k)) weights[k as TermKey] = v;
  }

  // ── Page statistics ─────────────────────────────────────────────────────
  const rows = [...input.edhrec.values()].filter(
    (r) => Number.isFinite(r.inclusion) && r.inclusion > 0
  );
  const pageFloorPct = rows.length
    ? Math.min(...rows.map((r) => r.inclusion))
    : EMPTY_PAGE_FLOOR_PCT;

  // On-page cards with a global rank, sorted by log rank, for the off-page
  // peer median.
  const peers: Array<{ at: number; inclusion: number }> = [];
  if (input.globalRank) {
    for (const [name, row] of input.edhrec) {
      const rank = getByCardName(input.globalRank, name);
      if (rank && rank > 0 && row.inclusion > 0)
        peers.push({ at: Math.log(rank), inclusion: row.inclusion });
    }
    peers.sort((a, b) => a.at - b.at || a.inclusion - b.inclusion);
  }
  const rankPeerInclusion = (rank: number): number | null => {
    if (peers.length < OFF_PAGE_PEERS) return null;
    const at = Math.log(rank);
    // The OFF_PAGE_PEERS nearest: expand a window around the insertion point.
    let lo = 0;
    let hi = peers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (peers[mid].at < at) lo = mid + 1;
      else hi = mid;
    }
    let left = lo - 1;
    let right = lo;
    const picked: number[] = [];
    while (picked.length < OFF_PAGE_PEERS) {
      const dl = left >= 0 ? at - peers[left].at : Infinity;
      const dr = right < peers.length ? peers[right].at - at : Infinity;
      if (dl <= dr) picked.push(peers[left--].inclusion);
      else picked.push(peers[right++].inclusion);
    }
    return median(picked);
  };

  // ── Memoized per-card reads, keyed by name (a name is one card) ─────────
  const factsOf = input.factsOf ?? defaultFactsOf;
  const factsCache = new Map<string, CardFacts>();
  // Every term reads facts the card's own text bears out (factsReading.ts).
  const cachedFacts = (card: ScryfallCard): CardFacts => {
    let f = factsCache.get(card.name);
    if (!f) {
      f = readFacts(card, factsOf(card));
      factsCache.set(card.name, f);
    }
    return f;
  };

  const currency = input.customization.currency ?? 'USD';
  const priceFactor = (card: ScryfallCard): { f: number; usd: number | null } => {
    const price = parseFloat(getCardPrice(card, currency) ?? '');
    const usd = Number.isFinite(price) && price > 0 ? price : null;
    return { f: PRICE_A + PRICE_B * Math.log10(1 + (usd ?? 0)), usd };
  };
  const priced = (pct: number, card: ScryfallCard) => {
    const { f, usd } = priceFactor(card);
    const q = Math.min(1, (pct / 100) * f);
    return { q, text: usd === null ? 'no price' : `${usd.toFixed(2)} ${currency}` };
  };

  const qualityCache = new Map<string, CardQuality>();
  const qualityOf = (card: ScryfallCard): CardQuality => {
    const hit = qualityCache.get(card.name);
    if (hit) return hit;
    let read: CardQuality;
    const row = getByCardName(input.edhrec, card.name);
    if (isBasicLand(card)) {
      read = { q: 0, source: 'basic', inclusionPct: null, strength: null, note: 'basic land' };
    } else if (row && row.inclusion > 0) {
      const { q, text } = priced(row.inclusion, card);
      read = {
        q,
        source: 'page',
        inclusionPct: row.inclusion,
        strength: strengthOf(row),
        note: `${round(row.inclusion)}% of this page's decks, ${round(q * 100)}% price-adjusted (${text})`,
      };
    } else {
      const rank =
        card.edhrec_rank ??
        (input.globalRank ? getByCardName(input.globalRank, card.name) : undefined);
      const peer = rank && rank > 0 ? rankPeerInclusion(rank) : null;
      const pct =
        peer == null
          ? pageFloorPct
          : pageFloorPct + OFF_PAGE_TRUST * Math.max(0, peer - pageFloorPct);
      const { q, text } = priced(pct, card);
      read = {
        q,
        source: 'off-page',
        inclusionPct: null,
        strength: null,
        note:
          peer == null
            ? `off-page: read at the page floor, ${round(pageFloorPct)}%, ${round(q * 100)}% price-adjusted (${text})`
            : `off-page: read at ${round(pct)}% (page floor ${round(pageFloorPct)}%, on-page cards near its EDHREC rank ${rank} average ${round(peer)}%), ${round(q * 100)}% price-adjusted (${text})`,
      };
    }
    qualityCache.set(card.name, read);
    return read;
  };

  const identity = maskOf([...input.colorIdentity]);
  const manaCache = new Map<string, ManaCard>();
  const manaCardOf = (card: ScryfallCard): ManaCard => {
    let m = manaCache.get(card.name);
    if (!m) {
      m = classifyManaCard(card, identity);
      manaCache.set(card.name, m);
    }
    return m;
  };

  const roleCache = new Map<string, string | null>();
  const inputRoleOf = input.roleOf;
  const roleOf = inputRoleOf
    ? (card: ScryfallCard): string | null => {
        let r = roleCache.get(card.name);
        if (r === undefined) {
          r = inputRoleOf(card);
          roleCache.set(card.name, r);
        }
        return r;
      }
    : undefined;

  return {
    ...input,
    roleOf,
    factsOf: cachedFacts,
    weights,
    tags: {
      isExtraTurn: input.tags?.isExtraTurn ?? ((n) => isExtraTurn(n)),
      isMassLandDenial: input.tags?.isMassLandDenial ?? ((n) => isMassLandDenialFloor(n)),
      isStaxPiece: input.tags?.isStaxPiece ?? ((n) => isStaxPiece(n)),
    },
    gameChangerNames: input.gameChangerNames ?? new Set(HARDCODED_GAME_CHANGERS),
    pageFloorPct,
    qualityOf,
    manaCardOf,
    sim: {
      games: input.manaSim?.games ?? DEFAULT_SIM_GAMES,
      seed: input.manaSim?.seed ?? DEFAULT_SIM_SEED,
    },
  };
}
