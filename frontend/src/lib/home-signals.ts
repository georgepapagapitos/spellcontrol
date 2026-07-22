/**
 * Pure aggregation helpers for the /home dashboard's cards (social program
 * W3). Every export reads caller-supplied in-memory data (decks, collection
 * cards, materialized binders, game nights) — no fetches, no store reads —
 * so Home only ever displays signals the app already computes elsewhere,
 * never a re-capture. Deliberately store-free like `lib/new-arrivals.ts`, so
 * this stays cheap to unit-test.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { GameNight } from './game-nights-api';
import type { EnrichedCard, ListDef, MaterializedBinder } from '../types';
import type { ImportHistoryEntry } from './local-cards';
import { fitsColorIdentity } from './deck-validation';
import { computeDrift } from './binder-drift';
import { isTrackingList, ownedCountForEntry } from './lists';
import type { ArrivalCandidateCard, ArrivalDeckSlot, NewArrivalsInput } from './new-arrivals';

// ── New arrivals ─────────────────────────────────────────────────────────
// Reimplemented rather than imported from new-arrivals.ts: these are
// short-circuiting/summing variants of computeNewArrivals's inner loop that
// skip its per-candidate similarity scoring and bucket sort entirely (those
// only matter for the per-deck sheet's ranked display, never for a Home
// boolean/count). Same eligibility guards (basic-land / in-deck /
// color-identity) — keep in sync if new-arrivals.ts's guards ever change.
const BASIC_LAND_NAMES = new Set([
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

function acquiredAt(
  card: ArrivalCandidateCard,
  addedAtByImportId: ReadonlyMap<string, number>
): number {
  if (card.importId) return addedAtByImportId.get(card.importId) ?? 0;
  return card.updatedAt ?? 0;
}

/** Satisfies `fitsColorIdentity`'s ScryfallCard param with only the field it reads. */
function asIdentityCard(colorIdentity: string[] | undefined): ScryfallCard {
  return { color_identity: colorIdentity ?? [] } as ScryfallCard;
}

/** Mirrors `deckIdentity` in new-arrivals.ts. */
function deckIdentity(
  commander: ScryfallCard | null,
  partnerCommander: ScryfallCard | null | undefined,
  mainboard: readonly ScryfallCard[],
  sideboard: readonly ScryfallCard[]
): Set<string> {
  const out = new Set<string>();
  if (commander || partnerCommander) {
    for (const c of commander?.color_identity ?? []) out.add(c);
    for (const c of partnerCommander?.color_identity ?? []) out.add(c);
    return out;
  }
  for (const c of mainboard) for (const ci of c.color_identity ?? []) out.add(ci);
  for (const c of sideboard) for (const ci of c.color_identity ?? []) out.add(ci);
  return out;
}

interface DeckLike {
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  cards: readonly ArrivalDeckSlot[];
  sideboard?: readonly ArrivalDeckSlot[];
  deckUpdatedAt: number;
  lastArrivalReviewAt?: number;
}

interface ArrivalContext {
  windowStart: number;
  inDeckNames: Set<string>;
  identity: Set<string>;
}

function buildArrivalContext(input: DeckLike): ArrivalContext {
  const mainboard = input.cards.map((c) => c.card);
  const sideboard = (input.sideboard ?? []).map((c) => c.card);

  const inDeckNames = new Set<string>();
  for (const c of mainboard) inDeckNames.add(c.name.toLowerCase());
  for (const c of sideboard) inDeckNames.add(c.name.toLowerCase());
  if (input.commander) inDeckNames.add(input.commander.name.toLowerCase());
  if (input.partnerCommander) inDeckNames.add(input.partnerCommander.name.toLowerCase());

  return {
    windowStart: Math.max(input.deckUpdatedAt, input.lastArrivalReviewAt ?? 0),
    inDeckNames,
    identity: deckIdentity(input.commander, input.partnerCommander, mainboard, sideboard),
  };
}

function isEligibleArrival(card: ArrivalCandidateCard, ctx: ArrivalContext): boolean {
  if (BASIC_LAND_NAMES.has(card.name)) return false;
  if (ctx.inDeckNames.has(card.name.toLowerCase())) return false;
  if (!fitsColorIdentity(asIdentityCard(card.colorIdentity), ctx.identity)) return false;
  return true;
}

/**
 * Short-circuiting variant of `computeNewArrivals`: same eligibility guards,
 * but returns on the first qualifying acquisition instead of scoring and
 * bucketing every candidate — all a Home card needs is a boolean.
 */
export function hasNewArrivals(input: NewArrivalsInput): boolean {
  const ctx = buildArrivalContext(input);
  for (const card of input.collectionCards) {
    if (!isEligibleArrival(card, ctx)) continue;
    if (acquiredAt(card, input.addedAtByImportId) > ctx.windowStart) return true;
  }
  return false;
}

/** Cap on per-deck sample names fed into Home's overlapping thumb fan — a
 *  handful is plenty of visual variety; the card itself dedupes/caps the
 *  combined fan across decks at 5. */
const MAX_SAMPLE_NAMES = 3;

/** Same byName grouping as `computeNewArrivals`, summed to a qty instead of
 *  built into ranked `ArrivalRow`s — plus the qualifying names themselves
 *  (most-recently-acquired first), so Home's thumb fan has real card art to
 *  resolve instead of just a count. */
function qualifyingArrivals(
  deck: DeckLike,
  collectionCards: readonly ArrivalCandidateCard[],
  addedAtByImportId: ReadonlyMap<string, number>
): { qty: number; sampleNames: string[] } {
  const ctx = buildArrivalContext(deck);
  const byName = new Map<string, { qty: number; acquiredAt: number }>();
  for (const card of collectionCards) {
    if (!isEligibleArrival(card, ctx)) continue;
    const at = acquiredAt(card, addedAtByImportId);
    const existing = byName.get(card.name);
    if (existing) {
      existing.qty += 1;
      if (at > existing.acquiredAt) existing.acquiredAt = at;
    } else {
      byName.set(card.name, { qty: 1, acquiredAt: at });
    }
  }
  let qty = 0;
  const qualifying: Array<{ name: string; acquiredAt: number }> = [];
  for (const [name, entry] of byName) {
    if (entry.acquiredAt <= ctx.windowStart) continue;
    qty += entry.qty;
    qualifying.push({ name, acquiredAt: entry.acquiredAt });
  }
  qualifying.sort((a, b) => b.acquiredAt - a.acquiredAt);
  return { qty, sampleNames: qualifying.slice(0, MAX_SAMPLE_NAMES).map((q) => q.name) };
}

/**
 * New-arrival counts for the most recently updated decks, for Home's deck
 * cards. Reuses the same eligibility guards as `hasNewArrivals`, summed to a
 * per-deck qty instead of short-circuited to a boolean. Only decks with at
 * least one qualifying arrival are returned.
 */
export function aggregateNewArrivalDecks(
  decks: Deck[],
  collectionCards: readonly ArrivalCandidateCard[],
  addedAtByImportId: ReadonlyMap<string, number>,
  // ponytail: 20-deck cap — a power user's older, untouched decks won't
  // surface arrivals on Home (unaffected inside the deck itself); raise this
  // if it ever undercounts in practice.
  limit = 20
): Array<{ deck: Deck; count: number; sampleNames: string[] }> {
  const recent = [...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  const out: Array<{ deck: Deck; count: number; sampleNames: string[] }> = [];
  for (const deck of recent) {
    const { qty, sampleNames } = qualifyingArrivals(
      {
        commander: deck.commander,
        partnerCommander: deck.partnerCommander,
        cards: deck.cards,
        sideboard: deck.sideboard,
        deckUpdatedAt: deck.updatedAt,
        lastArrivalReviewAt: deck.lastArrivalReviewAt,
      },
      collectionCards,
      addedAtByImportId
    );
    if (qty > 0) out.push({ deck, count: qty, sampleNames });
  }
  return out;
}

// ── Binder review count ─────────────────────────────────────────────────────

/**
 * Total pending binder-review changes across every binder — the same drift
 * `BindersIndexPage`'s "N to review" chips compute per binder
 * (`computeDrift(b, cards, importHistory)`, summing `added.length +
 * removed.length` for every reviewed binder), collapsed to one number for
 * Home's badge instead of a per-binder `Map`.
 */
export function aggregateBinderReviewCount(
  materialized: MaterializedBinder[],
  cards: EnrichedCard[],
  importHistory: ImportHistoryEntry[]
): number {
  let total = 0;
  for (const b of materialized) {
    const drift = computeDrift(b, cards, importHistory);
    if (!drift.neverReviewed) total += drift.added.length + drift.removed.length;
  }
  return total;
}

// ── Trade targets ────────────────────────────────────────────────────────

/** One want-list card the owner is short on, for Home's trade-targets card. */
export interface TradeTargetRow {
  name: string;
  /** Static want lists that name it, in list order, deduped. */
  listNames: string[];
  /** Copies still needed: quantity wanted minus copies owned, summed across lists. */
  shortfall: number;
  /** Lowest target price set on any matching entry, if any entry has one. */
  targetPrice?: number;
  /** Currency of the winning `targetPrice`, as entered — never converted. */
  currency?: 'USD' | 'EUR';
}

/**
 * Static want-list entries the owner doesn't have enough copies of yet, for
 * Home's trade-targets card. Tracking lists (catalogues of owned cards) and
 * dynamic lists (`rule` set — `entries` is empty by construction) are
 * skipped, same as `buildTradeRadar` (trade-radar.ts). One row per distinct
 * card name (case-insensitive); shortfall summed across every list that
 * wants it, and the lowest `targetPrice` set on any matching entry wins
 * (with its currency) — same lowest-price aggregation as `buildTradeRadar`,
 * just against the owner's own shortfall instead of a friend's stock.
 * Sorted: entries with a target price first, then alphabetically.
 */
export function aggregateTradeTargets(lists: ListDef[], owned: EnrichedCard[]): TradeTargetRow[] {
  const rows = new Map<string, TradeTargetRow>();
  for (const list of lists) {
    if (isTrackingList(list)) continue;
    if (list.rule) continue; // dynamic list — entries are empty by construction
    for (const entry of list.entries) {
      const shortfall = Math.max(0, entry.quantity - ownedCountForEntry(entry, owned));
      if (shortfall === 0) continue;
      const key = entry.name.toLowerCase();
      const existing = rows.get(key);
      if (existing) {
        existing.shortfall += shortfall;
        if (!existing.listNames.includes(list.name)) existing.listNames.push(list.name);
        if (
          entry.targetPrice !== undefined &&
          (existing.targetPrice === undefined || entry.targetPrice < existing.targetPrice)
        ) {
          existing.targetPrice = entry.targetPrice;
          existing.currency = entry.currency;
        }
      } else {
        rows.set(key, {
          name: entry.name,
          listNames: [list.name],
          shortfall,
          targetPrice: entry.targetPrice,
          currency: entry.targetPrice !== undefined ? entry.currency : undefined,
        });
      }
    }
  }
  return [...rows.values()].sort((a, b) => {
    if ((a.targetPrice !== undefined) !== (b.targetPrice !== undefined)) {
      return a.targetPrice !== undefined ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

// ── Upcoming game nights ────────────────────────────────────────────────────

/** Non-cancelled, not-yet-started game nights, soonest first. */
export function upcomingGameNights(nights: GameNight[], now = Date.now(), limit = 3): GameNight[] {
  return nights
    .filter((n) => n.cancelledAt === null && n.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, limit);
}
