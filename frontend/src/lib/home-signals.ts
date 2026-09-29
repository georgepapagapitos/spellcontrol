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
import type { EnrichedCard, MaterializedBinder } from '../types';
import type { ImportHistoryEntry } from './local-cards';
import { fitsColorIdentity } from './deck-validation';
import { computeDrift } from './binder-drift';
import type { ArrivalCandidateCard, ArrivalDeckSlot, NewArrivalsInput } from './new-arrivals';
import type { ArrivalWatchlists } from './arrival-watchlist';

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

/** The deck page's "N new arrivals": `computeNewArrivals`'s rows, narrowed to
 *  the names the coach wants (lib/arrival-watchlist.ts). A row is one card
 *  name however many copies you hold, so this counts names, not copies. */
function qualifyingArrivalNames(
  deck: DeckLike,
  wanted: ReadonlySet<string>,
  collectionCards: readonly ArrivalCandidateCard[],
  addedAtByImportId: ReadonlyMap<string, number>
): Set<string> {
  const ctx = buildArrivalContext(deck);
  const newest = new Map<string, number>();
  for (const card of collectionCards) {
    if (!wanted.has(card.name.toLowerCase())) continue;
    if (!isEligibleArrival(card, ctx)) continue;
    const at = acquiredAt(card, addedAtByImportId);
    if (at > (newest.get(card.name) ?? -Infinity)) newest.set(card.name, at);
  }
  const names = new Set<string>();
  for (const [name, at] of newest) if (at > ctx.windowStart) names.add(name);
  return names;
}

/**
 * Per-deck new-arrival counts for Home's deck tiles and Recently added, equal
 * to the count the deck page shows for the same deck. A deck with no recorded
 * watchlist (never opened on this browser) is skipped: Home can't narrow its
 * arrivals, and the raw count is the one that read as random. Only decks with
 * at least one qualifying arrival are returned.
 */
export function aggregateNewArrivalDecks(
  decks: Deck[],
  collectionCards: readonly ArrivalCandidateCard[],
  addedAtByImportId: ReadonlyMap<string, number>,
  watchlists: ArrivalWatchlists,
  // ponytail: 20-deck cap — a power user's older, untouched decks won't
  // surface arrivals on Home (unaffected inside the deck itself); raise this
  // if it ever undercounts in practice.
  limit = 20
): Array<{ deck: Deck; count: number }> {
  const recent = [...decks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  const out: Array<{ deck: Deck; count: number }> = [];
  for (const deck of recent) {
    const wanted = watchlists[deck.id];
    if (!wanted || wanted.size === 0) continue;
    const names = qualifyingArrivalNames(
      {
        commander: deck.commander,
        partnerCommander: deck.partnerCommander,
        cards: deck.cards,
        sideboard: deck.sideboard,
        deckUpdatedAt: deck.updatedAt,
        lastArrivalReviewAt: deck.lastArrivalReviewAt,
      },
      wanted,
      collectionCards,
      addedAtByImportId
    );
    if (names.size > 0) out.push({ deck, count: names.size });
  }
  return out;
}

// ── Binder review count ─────────────────────────────────────────────────────

/**
 * Total pending binder-review changes across every binder — the same drift
 * `BindersIndexPage`'s "N to file" chips compute per binder
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

// ── Upcoming game nights ────────────────────────────────────────────────────

/** Non-cancelled, not-yet-started game nights, soonest first. */
export function upcomingGameNights(nights: GameNight[], now = Date.now(), limit = 3): GameNight[] {
  return nights
    .filter((n) => n.cancelledAt === null && n.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, limit);
}

/** An import older than this is history, not "recently added". */
export const RECENT_IMPORT_DAYS = 30;

/**
 * Whether the latest import still says something the rest of Home doesn't:
 * it happened within the last month, and it is an ADDITION to the collection
 * rather than (nearly) the whole of it. A first import, or a re-import that
 * replaced everything, makes "Recently added · 13,557 cards" the collection's
 * own size restated beside the hero's scale line, so the band gives that slot
 * to Your cards instead (T164).
 */
export function isRecentPartialImport(
  latest: Pick<ImportHistoryEntry, 'addedAt' | 'count'> | null,
  collectionSize: number,
  now: number
): boolean {
  if (!latest) return false;
  if (now - latest.addedAt > RECENT_IMPORT_DAYS * 86_400_000) return false;
  return latest.count < collectionSize * 0.9;
}

/** The newest entry of the import history, or null. */
export function latestImport(history: ImportHistoryEntry[]): ImportHistoryEntry | null {
  return history.reduce<ImportHistoryEntry | null>(
    (best, e) => (!best || e.addedAt > best.addedAt ? e : best),
    null
  );
}
