import type { ScryfallCard } from '@/deck-builder/types';
import type { RecommendedCard } from './deckAnalyzer';
import { getCardPrice, getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import { primaryTypeOf } from '@/lib/card-matching';

/**
 * Cost optimizer — suggests cheaper, role-equivalent replacements for the most
 * expensive cards in a deck. Ported from the mtg-cdg reference's costAnalyzer,
 * adapted to SpellControl's `RecommendedCard` pool + `ScryfallCard` shape.
 *
 * The output (`CostPlan`) is **lean and persistable**: rows hold card names and
 * primitives only — never embedded `ScryfallCard`s — so a computed plan can be
 * stored on the deck in IndexedDB without bloating it. The UI re-resolves any
 * imagery it needs from the card name.
 */

export type CostConfidence = 'drop-in' | 'sidegrade' | 'budget';

export interface CostSwapRow {
  id: string; // current card name (unique within a deck list)
  currentName: string;
  currentPrice: number; // USD
  currentInclusion: number;
  currentCmc?: number;
  currentImageUrl?: string; // if cheaply available; else omit (UI falls back)
  suggestionName: string;
  suggestionPrice: number;
  suggestionInclusion: number;
  suggestionCmc?: number;
  savings: number; // currentPrice - suggestionPrice
  confidence: CostConfidence;
  category: 'spell' | 'land';
}

export interface CostPlan {
  currentTotal: number;
  minTotal: number; // total if every row applied
  spellRows: CostSwapRow[];
  landRows: CostSwapRow[];
  protectedCount: number; // commander/must-include/basic/no-price cards skipped
  /**
   * Rows dropped by `filterCostPlanByOwnership` because the user already owns a
   * usable copy (E23) — no purchase cost to trim. Optional/additive: absent on a
   * freshly-built plan, set once ownership filtering is applied at display time.
   */
  ownedSkippedCount?: number;
}

export interface BuildCostPlanOptions {
  mustIncludeNames?: Set<string>;
  excludeFromSuggestions?: Set<string>;
}

/**
 * Basic lands are protected from swap suggestions (no cheaper equivalent matters).
 * Local, non-snow set by design — not the canonical land-identity set in
 * lib/allocations (snow basics already swap-protect via other rules here).
 */
const PROTECTED_BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

/** Confidence-band constants (mirror the reference). */
export const DROP_IN_INCLUSION_BAND = 15;
export const SIDEGRADE_INCLUSION_BAND = 35;
export const DROP_IN_CMC_BAND = 1;

const CONFIDENCE_RANK: Record<CostConfidence, number> = {
  'drop-in': 0,
  sidegrade: 1,
  budget: 2,
};

/**
 * Parse a Scryfall/EDHREC price string into a finite number, defensively.
 * Strips a leading currency symbol and thousands separators; returns null on
 * anything non-finite (empty, "—", NaN, null/undefined).
 */
export function parsePrice(raw?: string | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** True when a card is a land (front-face type line includes "Land"). */
function isLandCard(card: ScryfallCard): boolean {
  const typeLine = card.type_line || (card.card_faces && card.card_faces[0]?.type_line) || '';
  return typeLine.toLowerCase().includes('land');
}

/**
 * A budget suggestion must appear in at least this % of EDHREC decks, so the
 * cutter never offers a 0%-inclusion fringe card as a "cheaper alternative".
 * ponytail: single tunable floor; raise to be pickier about suggestion quality.
 */
const MIN_SUGGESTION_INCLUSION = 1;

/** Distinct WUBRG colors a land fixes (ignores generic/colorless). */
function colorFixingCount(colors: string[] | undefined): number {
  if (!colors) return 0;
  return new Set(colors.filter((c) => 'WUBRG'.includes(c))).size;
}

/**
 * A fetchland: searches the library for a land instead of tapping for mana.
 * Matches both "basic land card" fetches and the premium dual-fetches that name
 * basic types ("a Plains or Island card") rather than the word "land".
 */
function isFetchland(card: ScryfallCard): boolean {
  return /search your library for [^.]*\b(land|plains|island|swamp|mountain|forest)\b/i.test(
    card.oracle_text ?? ''
  );
}

/**
 * Minimum color-fixing a budget land swap must preserve, so we never downgrade a
 * fetchland/dual into a basic tapland. Fetchlands produce no mana themselves but
 * fix at least two colors in practice, so they floor at 2.
 */
function landFixingFloor(card: ScryfallCard): number {
  const produced = colorFixingCount(card.produced_mana);
  return isFetchland(card) ? Math.max(2, produced) : produced;
}

interface SwapSuggestion {
  name: string;
  price: number;
  inclusion: number;
  cmc?: number;
}

/**
 * Classify how safe a swap is by comparing inclusion (popularity) and CMC.
 * - drop-in: near-identical CMC and comparably popular.
 * - sidegrade: meaningfully less popular but still a real card.
 * - budget: a large popularity drop (a budget-tier compromise).
 */
export function classifyConfidence(
  currentInclusion: number,
  currentCmc: number | undefined,
  suggestion: SwapSuggestion
): CostConfidence {
  const inclusionDelta = currentInclusion - suggestion.inclusion;
  const cmcDelta =
    currentCmc != null && suggestion.cmc != null ? Math.abs(currentCmc - suggestion.cmc) : Infinity;

  if (
    cmcDelta <= DROP_IN_CMC_BAND &&
    inclusionDelta <= DROP_IN_INCLUSION_BAND &&
    suggestion.inclusion > 0
  ) {
    return 'drop-in';
  }
  if (inclusionDelta <= SIDEGRADE_INCLUSION_BAND && suggestion.inclusion > 0) {
    return 'sidegrade';
  }
  return 'budget';
}

/**
 * From a role-matched pool, pick the single cheapest candidate strictly cheaper
 * than `currentPrice`, skipping any excluded names and price-less candidates.
 */
export function pickCheapestAlternative(
  pool: RecommendedCard[],
  currentPrice: number,
  excludeNames: Set<string>,
  minInclusion = 0
): SwapSuggestion | null {
  let best: SwapSuggestion | null = null;
  for (const cand of pool) {
    if (excludeNames.has(cand.name)) continue;
    if ((cand.inclusion ?? 0) < minInclusion) continue;
    const price = parsePrice(cand.price);
    if (price == null) continue;
    if (price >= currentPrice) continue;
    if (best && price >= best.price) continue;
    best = {
      name: cand.name,
      price,
      inclusion: cand.inclusion ?? 0,
      cmc: cand.cmc,
    };
  }
  return best;
}

/**
 * Greedily select rows (cheapest-confidence first, then largest savings) until
 * the projected total drops to or below `target`. Pure — returns the set of
 * selected row ids. Rows whose confidence tier is disabled or that the user has
 * manually excluded are skipped.
 */
export function autoCheckToTarget(
  rows: CostSwapRow[],
  currentTotal: number,
  target: number,
  enabledConfidences: Set<CostConfidence>,
  manuallyExcluded: Set<string>
): Set<string> {
  const picked = new Set<string>();
  if (currentTotal <= target) return picked;

  const ordered = [...rows].sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (c !== 0) return c;
    return b.savings - a.savings;
  });

  let total = currentTotal;
  for (const row of ordered) {
    if (total <= target) break;
    if (!enabledConfidences.has(row.confidence)) continue;
    if (manuallyExcluded.has(row.id)) continue;
    picked.add(row.id);
    total -= row.savings;
  }
  return picked;
}

function sortRows(rows: CostSwapRow[]): CostSwapRow[] {
  return rows.sort((a, b) => {
    const c = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    return c !== 0 ? c : b.savings - a.savings;
  });
}

/** Resolve a small thumbnail URL for a card, if cheaply available (else omit). */
function resolveImageUrl(card: ScryfallCard): string | undefined {
  if (card.image_uris?.small) return card.image_uris.small;
  if (card.card_faces?.[0]?.image_uris?.small) return card.card_faces[0].image_uris.small;
  // getCardImageUrl returns a placeholder for cards with no imagery — only use a real URL.
  const url = getCardImageUrl(card, 'small');
  return url.includes('00000000-0000-0000-0000-000000000000') ? undefined : url;
}

/**
 * Build a cost-optimization plan: for each non-protected deck card, the cheapest
 * role-matched (or land) alternative strictly cheaper than the current price.
 *
 * Protected (counted in `protectedCount`, never offered a swap): the
 * commander(s), must-includes, basic lands, and any card with no price.
 *
 * Pure — no I/O. Prices come from the already-resolved `ScryfallCard.prices`
 * (current cards) and `RecommendedCard.price` strings (the candidate pool).
 */
export function buildCostPlan(
  cards: ScryfallCard[],
  commanderName: string,
  partnerCommanderName: string | undefined,
  recommendations: RecommendedCard[],
  opts: BuildCostPlanOptions = {}
): CostPlan {
  const mustIncludeNames = opts.mustIncludeNames ?? new Set<string>();
  const excludeFromSuggestions = opts.excludeFromSuggestions ?? new Set<string>();

  // Bucket the candidate pool by role; collect a separate land pool by type.
  const byRole = new Map<string, RecommendedCard[]>();
  const landPool: RecommendedCard[] = [];
  for (const rec of recommendations) {
    if ((rec.primaryType ?? '').includes('Land')) landPool.push(rec);
    const key = rec.role ?? `type:${(rec.primaryType ?? 'other').toLowerCase()}`;
    const bucket = byRole.get(key);
    if (bucket) bucket.push(rec);
    else byRole.set(key, [rec]);
  }

  const inclusionByName = new Map<string, number>();
  for (const rec of recommendations) inclusionByName.set(rec.name, rec.inclusion);

  const inDeckNames = new Set(cards.map((c) => c.name));

  const spellRows: CostSwapRow[] = [];
  const landRows: CostSwapRow[] = [];
  let protectedCount = 0;
  let currentTotal = 0;

  for (const card of cards) {
    const price = parsePrice(getCardPrice(card, 'USD'));
    if (price != null) currentTotal += price;

    if (
      card.name === commanderName ||
      (partnerCommanderName && card.name === partnerCommanderName) ||
      mustIncludeNames.has(card.name) ||
      PROTECTED_BASICS.has(card.name) ||
      price == null
    ) {
      protectedCount += 1;
      continue;
    }

    const exclude = new Set<string>([card.name, ...inDeckNames, ...excludeFromSuggestions]);

    const isLand = isLandCard(card);
    let pool: RecommendedCard[];
    if (isLand) {
      // Only offer lands that preserve the current land's color fixing — never
      // downgrade a fetchland/dual into a cheaper basic tapland. Reject only
      // candidates we KNOW fix fewer colors; a candidate with no color data is
      // left in (degrade gracefully rather than dropping every land swap when
      // the pool's producedColors couldn't be resolved).
      const floor = landFixingFloor(card);
      pool =
        floor > 0
          ? landPool.filter(
              (rec) => rec.producedColors == null || colorFixingCount(rec.producedColors) >= floor
            )
          : landPool;
    } else {
      // Prefer the card's role bucket; fall back to its primary-type bucket so a
      // spell with no detected role still gets a suggestion instead of nothing.
      const roleBucket = card.deckRole ? byRole.get(card.deckRole) : undefined;
      pool = roleBucket ?? byRole.get(`type:${primaryTypeOf(card).toLowerCase()}`) ?? [];
    }

    const suggestion = pickCheapestAlternative(pool, price, exclude, MIN_SUGGESTION_INCLUSION);
    if (!suggestion) continue;

    const currentInclusion = inclusionByName.get(card.name) ?? 0;
    const confidence = classifyConfidence(currentInclusion, card.cmc, suggestion);

    const row: CostSwapRow = {
      id: card.name,
      currentName: card.name,
      currentPrice: price,
      currentInclusion,
      currentCmc: card.cmc,
      currentImageUrl: resolveImageUrl(card),
      suggestionName: suggestion.name,
      suggestionPrice: suggestion.price,
      suggestionInclusion: suggestion.inclusion,
      suggestionCmc: suggestion.cmc,
      savings: price - suggestion.price,
      confidence,
      category: isLand ? 'land' : 'spell',
    };
    if (isLand) landRows.push(row);
    else spellRows.push(row);
  }

  const allSavings = [...spellRows, ...landRows].reduce((s, r) => s + r.savings, 0);
  const minTotal = Math.max(0, currentTotal - allSavings);

  sortRows(spellRows);
  sortRows(landRows);

  return { currentTotal, minTotal, spellRows, landRows, protectedCount };
}

/**
 * Drop trim-cost suggestions for cards the user already owns and can field in
 * this deck (E23). Replacing a card you've already paid for with a cheaper one
 * saves nothing real — there's no spend to trim. Only un-owned cards (a genuine
 * purchase) or owned-but-claimed-elsewhere copies (you can't use them in *this*
 * deck without buying another) keep their cheaper-swap row.
 *
 * Applied at display time against the *live* collection + allocation state
 * rather than baked into the persisted plan, so the trim list reflects what the
 * user owns right now — buying/selling/reallocating a copy updates it without
 * waiting on a deck-edit-triggered re-analysis.
 *
 * Pure: returns a new plan with the suppressed rows removed, `minTotal`
 * recomputed against the surviving savings, and the suppressed count recorded in
 * `ownedSkippedCount`. `currentTotal` and `protectedCount` are unchanged — the
 * owned cards still sit in the deck and still cost what they cost.
 *
 * @param isOwnedAndAvailable predicate: true when the user owns a copy of
 *   `currentName` that's usable in this deck (free/unallocated or already bound
 *   here). Mirror the editor's `ownershipFor(name) === 'owned'`.
 */
export function filterCostPlanByOwnership(
  plan: CostPlan,
  isOwnedAndAvailable: (currentName: string) => boolean
): CostPlan {
  const keep = (r: CostSwapRow) => !isOwnedAndAvailable(r.currentName);
  const spellRows = plan.spellRows.filter(keep);
  const landRows = plan.landRows.filter(keep);
  const suppressed =
    plan.spellRows.length - spellRows.length + (plan.landRows.length - landRows.length);
  if (suppressed === 0) return plan;

  const savings = [...spellRows, ...landRows].reduce((s, r) => s + r.savings, 0);
  return {
    ...plan,
    spellRows,
    landRows,
    minTotal: Math.max(0, plan.currentTotal - savings),
    ownedSkippedCount: (plan.ownedSkippedCount ?? 0) + suppressed,
  };
}
