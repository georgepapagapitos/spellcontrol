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
 * collection table and both binder views so the edit semantics can't drift.
 *
 * When `copyId` is given (the ungrouped "All copies" view, where each row is a
 * single physical copy), only that one copy is re-pointed to the new printing —
 * its siblings on the old printing are untouched. This is how a stack of
 * identical printings gets split into different printings. Quantity is ignored
 * in this mode (you're editing exactly one copy).
 */
export function buildEditedCards(
  editingCard: EnrichedCard,
  selection: PrintingSelection,
  allCards: EnrichedCard[],
  copyId?: string
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
    // Stamp last-edit time on every copy this edit touches (printing/finish/qty).
    // Spread onto the split/updated/added copies below; untouched `others` keep
    // their existing updatedAt. Powers the collection "Last edited" sort.
    updatedAt: Date.now(),
  };

  // Per-copy details, only when the dialog ran in details mode. Assigning the
  // (possibly undefined) values overwrites on spread, so clearing a condition
  // in the dialog actually clears it on the copies.
  if (selection.details) {
    cardFields.condition = selection.details.condition;
    cardFields.language = selection.details.language;
    cardFields.altered = selection.details.altered;
    cardFields.proxy = selection.details.proxy;
    cardFields.misprint = selection.details.misprint;
  }

  // Single-copy split (ungrouped view): re-point just this one physical copy,
  // leaving any siblings on the old printing.
  if (copyId !== undefined) {
    return allCards.map((c) =>
      c.copyId === copyId ? ({ ...c, ...cardFields, copyId: c.copyId } as EnrichedCard) : c
    );
  }

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

/**
 * Whether a confirmed edit selection is identical to the card's current
 * printing/finish/quantity/details — i.e. there's nothing to apply or undo.
 * CardEditDialog already disables its Confirm button while unchanged, so this
 * is a defensive second check at the call sites that decide whether to fire
 * an Undo toast: it must never appear for a confirm that changed nothing.
 */
export function isNoOpCardEdit(
  editingCard: EnrichedCard,
  selection: PrintingSelection,
  existingQty: number,
  copyId?: string
): boolean {
  const currentFinish = editingCard.finish ?? (editingCard.foil ? 'foil' : 'nonfoil');
  if (selection.card.id !== editingCard.scryfallId || selection.finish !== currentFinish) {
    return false;
  }
  if (
    copyId === undefined &&
    selection.quantity !== undefined &&
    selection.quantity !== existingQty
  ) {
    return false;
  }
  if (selection.details) {
    const d = selection.details;
    if (
      (d.condition ?? undefined) !== editingCard.condition ||
      (d.language ?? undefined) !== editingCard.language ||
      (d.altered ?? false) !== (editingCard.altered ?? false) ||
      (d.proxy ?? false) !== (editingCard.proxy ?? false) ||
      (d.misprint ?? false) !== (editingCard.misprint ?? false)
    ) {
      return false;
    }
  }
  return true;
}
