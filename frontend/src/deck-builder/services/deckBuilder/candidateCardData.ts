/**
 * Card data for the cards the manual-deck analysis suggests, resolved once
 * from Scryfall (batched, cache-backed) and kept on the persisted rows.
 *
 * EDHREC cardlist rows carry no price, mana value, type or rarity (E126
 * dropped their prices). Two consumers need them long after the analysis ran:
 *  - the Cost and Optimize engines (`enrichRecommendationPrices`), which price
 *    and type the recommendation pool;
 *  - Coach's settings check (lib/coach/deck-settings-fit.ts), which hides a
 *    move that breaks the deck's price cap, budget or rarity cap and so needs
 *    the incoming card's price and rarity at render time
 *    (`stampCandidateCardData`). Gap rows reached the feed with `price: null`
 *    and no rarity; a one-away combo's missing piece had nothing at all.
 *
 * Best-effort throughout: a card that doesn't resolve keeps what it had, and
 * the settings check treats unknown data as allowed.
 */
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import {
  getCardPrice,
  getCardsByNames,
  getFrontFaceTypeLine,
} from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/cards/card-text';
import { logger } from '@/lib/util/logger';
import { alwaysProducedMana } from '@/lib/mana-sim/unconditional-mana';
import type { OptimizeCard, RecommendedCard } from './deckAnalyzer';

const RECOMMENDATION_SUPERTYPE = /^(Legendary|Basic|Snow|Tribal|Kindred|World|Ongoing)\s+/i;

/** First non-supertype word of a front-face type line ("Creature", "Land", …). */
function derivePrimaryType(typeLine: string): string {
  let t = typeLine.split('—')[0].trim();
  while (RECOMMENDATION_SUPERTYPE.test(t)) t = t.replace(RECOMMENDATION_SUPERTYPE, '');
  return t.split(/\s+/)[0] ?? '';
}

/** Name → card, by full name and by front face, lowercased. */
function byLowerName(cards: Map<string, ScryfallCard>): Map<string, ScryfallCard> {
  const out = new Map<string, ScryfallCard>();
  for (const c of cards.values()) {
    out.set(c.name.toLowerCase(), c);
    if (c.name.includes(' // ')) out.set(frontFaceName(c.name).toLowerCase(), c);
  }
  return out;
}

/**
 * EDHREC cardlist cards carry no price / cmc / primary_type — Scryfall fills
 * those only in the generator path, never in the manual-editor analysis. Left
 * unenriched, the Cost optimizer's candidate pool has no prices (→ zero swap
 * rows) and Optimize's curve-fill + cost confidence bands degrade (cmc
 * undefined → cmcDelta = Infinity). Backfill the gaps from Scryfall in place —
 * one batched, cache-backed `/cards/collection` call. Best-effort: on failure
 * the recommendations are left as-is (the prior behavior).
 */
export async function enrichRecommendationPrices(recs: RecommendedCard[]): Promise<void> {
  const need = recs.filter(
    (r) =>
      r.price == null ||
      r.cmc == null ||
      !r.primaryType ||
      r.primaryType === 'Unknown' ||
      // Lands need producedColors so the budget land-fixing floor can compare
      // candidates (the EDHREC pool doesn't carry it).
      (!r.producedColors && (r.primaryType ?? '').includes('Land'))
  );
  if (need.length === 0) return;
  try {
    const byName = byLowerName(
      await getCardsByNames(
        need.map((r) => r.name),
        undefined,
        undefined,
        { priceTail: false }
      )
    );
    for (const r of recs) {
      const c = byName.get(r.name.toLowerCase());
      if (!c) continue;
      if (r.cmc == null && c.cmc != null) r.cmc = c.cmc;
      if (!r.primaryType || r.primaryType === 'Unknown') {
        const pt = derivePrimaryType(getFrontFaceTypeLine(c));
        if (pt) r.primaryType = pt;
      }
      if (r.price == null) {
        const usd = c.prices?.usd ?? c.prices?.usd_foil ?? undefined;
        if (usd) r.price = usd;
      }
      // Backfill land color-fixing for the budget land-swap floor. A land whose
      // produced_mana is known and colorless (Karn's Bastion) records [] rather
      // than nothing: "unknown" passes the floor, so it was offered as the
      // cheaper swap for a tri-land.
      if (!r.producedColors && getFrontFaceTypeLine(c).toLowerCase().includes('land')) {
        const made = alwaysProducedMana(c.oracle_text, c.produced_mana);
        const colors = [...new Set((made ?? []).filter((m) => 'WUBRG'.includes(m)))];
        if (colors.length > 0 || made) r.producedColors = colors;
      }
    }
  } catch (err) {
    logger.warn('[CommanderDeckAnalysis] Recommendation price enrichment failed:', err);
  }
}

/** USD price and rarity of a card Coach may suggest whose row carries neither. */
export interface SuggestionCardData {
  price: string | null;
  rarity?: string;
  /** Its play rate on this commander's EDHREC page; absent when it isn't there. */
  inclusion?: number;
}

interface StampableRow {
  price?: string | null;
  rarity?: string;
}

export interface CandidateSources {
  gaps?: readonly GapAnalysisCard[];
  additions?: readonly OptimizeCard[];
  synergy?: readonly SynergySuggestion[];
  /** Names with no row of their own to stamp (a one-away combo's missing piece). */
  loose?: readonly string[];
  /** This commander's page, for the loose names' play rate. */
  inclusionOf?: (name: string) => number | undefined;
}

/**
 * Stamp price and rarity onto every candidate row, in place, and return the
 * same data for the loose names (persisted as `suggestionCards`).
 */
export async function stampCandidateCardData(
  sources: CandidateSources,
  resolveCards: (names: string[]) => Promise<Map<string, ScryfallCard>>
): Promise<Record<string, SuggestionCardData>> {
  const entries: [string, StampableRow][] = [
    ...(sources.gaps ?? []).map((g): [string, StampableRow] => [g.name, g]),
    ...(sources.additions ?? []).map((a): [string, StampableRow] => [a.name, a]),
    ...(sources.synergy ?? []).map((s): [string, StampableRow] => [s.cardName, s]),
  ];
  const loose = [...new Set(sources.loose ?? [])];
  const names = [...new Set([...entries.map(([name]) => name), ...loose])];
  if (names.length === 0) return {};
  const cards = await resolveCards(names);
  const byName = byLowerName(cards);
  const find = (name: string) => cards.get(name) ?? byName.get(name.toLowerCase());
  for (const [name, row] of entries) {
    const card = find(name);
    if (!card) continue;
    const price = getCardPrice(card, 'USD');
    if (row.price == null && price != null) row.price = price;
    if (card.rarity) row.rarity = card.rarity;
  }
  const out: Record<string, SuggestionCardData> = {};
  for (const name of loose) {
    const card = find(name);
    if (!card) continue;
    const inclusion = sources.inclusionOf?.(name);
    out[name] = { price: getCardPrice(card, 'USD'), rarity: card.rarity };
    if (inclusion !== undefined) out[name].inclusion = inclusion;
  }
  return out;
}
