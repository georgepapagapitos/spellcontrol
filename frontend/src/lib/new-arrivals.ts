/**
 * Per-panel "new arrivals" review (E140) — pure, synchronous computation of
 * which owned-but-not-in-deck collection cards arrived after the deck was
 * last touched, bucketed by category (classifyType) and ranked by fit.
 *
 * Deliberately store-free: callers (DeckDisplay/DeckEditorPage) hand in plain
 * arrays/maps derived from the stores, so this stays cheap to unit-test and
 * safe to import from a node-env test with no IndexedDB/store side effects.
 */
import type { ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';
import { classifyType, type TypeGroup } from './build-mana-data';
import { fitsColorIdentity } from './deck-validation';
import {
  similarityScore,
  type SubstituteCandidate,
} from '@/deck-builder/services/deckBuilder/substituteFinder';
import { getCardSubtype } from '@/deck-builder/services/tagger/client';

// ponytail: mirrors lib/allocations.ts's BASIC_LAND_NAMES verbatim rather than
// importing it — that module also exports store hooks (useDecksStore, …)
// whose eager IndexedDB-backed storage init isn't safe in a node-env test.
// Re-sync this list if the canonical one ever changes (new snow basics etc).
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

/** Minimal deck-card slot shape — structurally matches `DeckCard` (store/decks.ts)
 *  and `DeckDisplayCard`, so a real deck's `cards`/`sideboard` arrays pass in as-is. */
export interface ArrivalDeckSlot {
  card: ScryfallCard;
}

/** Minimal owned-copy shape a candidate needs — `EnrichedCard` satisfies this
 *  structurally, so the live collection array passes in with no adapter. */
export interface ArrivalCandidateCard {
  name: string;
  typeLine?: string;
  cmc?: number;
  colorIdentity?: string[];
  manaCost?: string;
  /** Import batch this physical copy came from, if any (drives acquired-at). */
  importId?: string;
  /** Quick-add/edit timestamp — the acquired-at fallback for cards with no importId. */
  updatedAt?: number;
}

export interface NewArrivalsInput {
  commander: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  cards: readonly ArrivalDeckSlot[];
  sideboard?: readonly ArrivalDeckSlot[];
  /** deck.updatedAt */
  deckUpdatedAt: number;
  /** deck.lastArrivalReviewAt — undefined before the feature has ever run for this deck. */
  lastArrivalReviewAt?: number;
  /** Every owned physical copy across the whole collection (not deck-scoped). */
  collectionCards: readonly ArrivalCandidateCard[];
  /** ImportHistory entry id -> addedAt (see store/collection.ts importHistory). */
  addedAtByImportId: ReadonlyMap<string, number>;
}

export interface ArrivalRow {
  name: string;
  card: ArrivalCandidateCard;
  /** Owned copies across every printing, deduped to this one name. */
  qty: number;
  /** Max similarity vs. the deck's same-bucket cards — ranks rows, highest first. */
  score: number;
}

export type ArrivalsByType = Partial<Record<TypeGroup, ArrivalRow[]>>;

/**
 * When a physical copy was acquired. A card with an importId uses the import
 * batch's timestamp ONLY — its own `updatedAt` gets bumped by ordinary edits
 * (printing/finish/condition changes), which must never re-flag an old card as
 * a new arrival. A card with no importId (a quick-add) falls back to its own
 * `updatedAt`.
 */
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

function bucketOf(card: ArrivalCandidateCard): TypeGroup {
  return classifyType({ type_line: card.typeLine ?? '' } as ScryfallCard);
}

/** The deck's effective color identity: commander(s)' strict identity when the
 *  deck has one, else the union of every card's own color identity (mirrors
 *  `effectiveDeckColors` in deck-validation.ts, reimplemented locally since that
 *  helper's param type requires the full `DeckCard` shape). */
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

/** How closely `candidate` fits the deck's existing same-bucket cards — max
 *  similarity vs any one of them, reusing the validated substituteFinder
 *  heuristic (same weights, same subtype/CMC-closeness inputs). */
function scoreCandidate(
  candidate: ArrivalCandidateCard,
  bucketMates: readonly ScryfallCard[]
): number {
  if (bucketMates.length === 0) return 0;
  const asSub: SubstituteCandidate = {
    name: candidate.name,
    colorIdentity: candidate.colorIdentity ?? [],
    cmc: candidate.cmc,
    typeLine: candidate.typeLine,
  };
  let best = 0;
  for (const mate of bucketMates) {
    const wantedSubtype = getCardSubtype(mate.name);
    const subtypeMatch = wantedSubtype != null && getCardSubtype(candidate.name) === wantedSubtype;
    const cmcDelta =
      mate.cmc != null && candidate.cmc != null ? Math.abs(candidate.cmc - mate.cmc) : Infinity;
    const missing: GapAnalysisCard = {
      name: mate.name,
      typeLine: mate.type_line,
      cmc: mate.cmc,
      price: null,
      inclusion: 0,
      synergy: 0,
    };
    const s = similarityScore(missing, asSub, subtypeMatch, cmcDelta);
    if (s > best) best = s;
  }
  return best;
}

/**
 * New-arrival collection cards, bucketed by category (classifyType) and ranked
 * within each bucket, for the deck-view "✦ N new" panel review (E140).
 */
export function computeNewArrivals(input: NewArrivalsInput): ArrivalsByType {
  const windowStart = Math.max(input.deckUpdatedAt, input.lastArrivalReviewAt ?? 0);
  const mainboard = input.cards.map((c) => c.card);
  const sideboard = (input.sideboard ?? []).map((c) => c.card);

  const inDeckNames = new Set<string>();
  for (const c of mainboard) inDeckNames.add(c.name.toLowerCase());
  for (const c of sideboard) inDeckNames.add(c.name.toLowerCase());
  if (input.commander) inDeckNames.add(input.commander.name.toLowerCase());
  if (input.partnerCommander) inDeckNames.add(input.partnerCommander.name.toLowerCase());

  const identity = deckIdentity(input.commander, input.partnerCommander, mainboard, sideboard);

  const deckByBucket = new Map<TypeGroup, ScryfallCard[]>();
  for (const c of [...mainboard, ...sideboard]) {
    const bucket = classifyType(c);
    const mates = deckByBucket.get(bucket);
    if (mates) mates.push(c);
    else deckByBucket.set(bucket, [c]);
  }

  // Group owned copies by name -> qty + latest acquisition + a representative
  // candidate (for the sheet's thumbnail/mana-cost render).
  const byName = new Map<string, { rep: ArrivalCandidateCard; qty: number; acquiredAt: number }>();
  for (const card of input.collectionCards) {
    if (BASIC_LAND_NAMES.has(card.name)) continue;
    if (inDeckNames.has(card.name.toLowerCase())) continue;
    const at = acquiredAt(card, input.addedAtByImportId);
    if (at <= windowStart) continue;
    if (!fitsColorIdentity(asIdentityCard(card.colorIdentity), identity)) continue;
    const existing = byName.get(card.name);
    if (existing) {
      existing.qty += 1;
      if (at > existing.acquiredAt) existing.acquiredAt = at;
    } else {
      byName.set(card.name, { rep: card, qty: 1, acquiredAt: at });
    }
  }

  const result: ArrivalsByType = {};
  for (const [name, entry] of byName) {
    const bucket = bucketOf(entry.rep);
    const score = scoreCandidate(entry.rep, deckByBucket.get(bucket) ?? []);
    const row: ArrivalRow = { name, card: entry.rep, qty: entry.qty, score };
    (result[bucket] ??= []).push(row);
  }
  for (const bucket of Object.keys(result) as TypeGroup[]) {
    result[bucket]!.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }
  return result;
}
