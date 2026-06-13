import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import type { PrintingSelection } from '../components/CardEditDialog';

/**
 * Best available USD price for a printing, biased by finish. Foil rows prefer
 * `usd_foil`, then etched, then plain; nonfoil rows the reverse. Returns 0 when
 * no positive, finite price is present.
 */
export function pickPrice(card: ScryfallCard, foil: boolean): number {
  const p = card.prices;
  if (!p) return 0;
  const candidates = foil ? [p.usd_foil, p.usd_etched, p.usd] : [p.usd, p.usd_etched, p.usd_foil];
  for (const raw of candidates) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Apply a printing/finish/quantity edit to a collection and return the FULL new
 * cards array. Existing copies of the edited `(scryfallId, finish)` are updated
 * in place — `copyId` preserved so any deck allocations stay bound; surplus
 * copies drop; shortfalls are filled with fresh copies that carry the original
 * source provenance. Pure: callers wrap the result with `replaceAllCards(...)`
 * (which re-runs allocation remapping) and clear the edit dialog. Shared by the
 * collection table and the binder list so the edit semantics can't drift.
 */
export function buildEditedCards(
  editingCard: EnrichedCard,
  selection: PrintingSelection,
  allCards: EnrichedCard[]
): EnrichedCard[] {
  const sc = selection.card;
  const firstFace = sc.card_faces?.[0];
  const cardFields: Partial<EnrichedCard> = {
    scryfallId: sc.id,
    name: sc.name,
    setCode: sc.set.toUpperCase(),
    setName: sc.set_name,
    collectorNumber: sc.collector_number,
    rarity: sc.rarity,
    finish: selection.finish,
    foil: selection.finish !== 'nonfoil',
    imageSmall: sc.image_uris?.small ?? firstFace?.image_uris?.small,
    imageNormal: sc.image_uris?.normal ?? firstFace?.image_uris?.normal,
    imageLarge: sc.image_uris?.large ?? firstFace?.image_uris?.large,
    imageNormalBack: sc.card_faces?.[1]?.image_uris?.normal,
    imageLargeBack: sc.card_faces?.[1]?.image_uris?.large,
    frameEffects: sc.frame_effects,
    fullArt: sc.full_art === true || sc.frame_effects?.includes('fullart'),
    borderColor: sc.border_color,
    layout: sc.layout,
    finishes: sc.finishes,
    promoTypes: sc.promo_types,
    purchasePrice: pickPrice(sc, selection.finish !== 'nonfoil'),
    pricedAt: Date.now(),
  };

  // Existing copies of this printing/finish — updated in place, copyId kept so
  // deck allocations stay intact.
  const existing = allCards.filter(
    (c) => c.scryfallId === editingCard.scryfallId && c.finish === editingCard.finish
  );
  const targetQty = selection.quantity ?? existing.length;
  const others = allCards.filter(
    (c) => !(c.scryfallId === editingCard.scryfallId && c.finish === editingCard.finish)
  );

  const updated = existing
    .slice(0, targetQty)
    .map((c) => ({ ...c, ...cardFields, copyId: c.copyId }));
  const added: EnrichedCard[] = [];
  for (let i = updated.length; i < targetQty; i++) {
    added.push({
      ...editingCard,
      ...cardFields,
      copyId: crypto.randomUUID(),
      sourceCategory: editingCard.sourceCategory,
      sourceFormat: editingCard.sourceFormat,
      importId: editingCard.importId,
    } as EnrichedCard);
  }

  return [...others, ...updated, ...added];
}
