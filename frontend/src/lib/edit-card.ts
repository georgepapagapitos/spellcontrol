import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import type { PrintingSelection } from '../components/CardEditDialog';
import { getCurrency } from './currency';
import { formatMoney } from './format-money';

/**
 * Copies in the same printing+finish stack as `card` — the exact set an edit's
 * quantity/condition/language change applies to inside `buildEditedCards`.
 * Exported so callers can inspect the stack (e.g. detect mixed condition/
 * language) *before* the user opens the edit dialog, using the same matching
 * rule the edit itself will use.
 */
export function stackCopies(
  allCards: EnrichedCard[],
  card: Pick<EnrichedCard, 'scryfallId' | 'finish'>
): EnrichedCard[] {
  return allCards.filter((c) => c.scryfallId === card.scryfallId && c.finish === card.finish);
}

/** Human summary of a non-uniform field across a stack, e.g. "3 NM, 1 HP" — `undefined` when every copy agrees (nothing to flag). */
function mixedSummary(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) {
    const label = v ? v.toUpperCase() : 'Not set';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts.size > 1
    ? [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(', ')
    : undefined;
}

/**
 * Which per-copy fields disagree across a printing+finish stack, summarized
 * for display. Feeds CardEditDialog's `mixedDetails` prop — when a key is
 * present here, the dialog must not silently bulk-apply that field.
 */
export function stackDetailMix(copies: EnrichedCard[]): {
  condition?: string;
  language?: string;
  acquiredPrice?: string;
  priceOverride?: string;
} {
  return {
    condition: mixedSummary(copies.map((c) => c.condition)),
    language: mixedSummary(copies.map((c) => c.language)),
    // Cost basis disagrees across a stack more often than any other field — the
    // same card bought twice years apart — so it gets the same don't-homogenize
    // treatment. Each copy formats in the currency it was recorded in (absent =
    // USD), since a stack can legitimately mix them.
    acquiredPrice: mixedSummary(
      copies.map((c) =>
        (c.acquiredPrice ?? 0) > 0
          ? formatMoney(c.acquiredPrice, { currency: c.acquiredCurrency ?? 'USD' })
          : undefined
      )
    ),
    // Same don't-homogenize treatment as cost basis: a stack can have one
    // altered copy someone priced by hand and three untouched siblings.
    priceOverride: mixedSummary(
      copies.map((c) =>
        c.priceOverride !== undefined
          ? formatMoney(c.priceOverride, { currency: c.priceOverrideCurrency ?? 'USD' })
          : undefined
      )
    ),
  };
}

/**
 * Best available USD price for a printing, biased by finish. Foil rows prefer
 * `usd_foil`, then etched, then plain; nonfoil rows the reverse. Returns 0 when
 * no positive, finite price is present.
 */
/**
 * The current printing, rebuilt from the collection row, for when the live
 * printings lookup fails. `buildEditedCards` re-stamps every printing field
 * from the selected ScryfallCard, so a stub must round-trip the row's own
 * values (images, set, prices, treatments) or a quantity edit during a
 * Scryfall outage would blank them. Only ever used when the fetched list is
 * unavailable — never offered as a swap target.
 */
export function printingStubFromEnriched(card: EnrichedCard): ScryfallCard {
  const price = card.purchasePrice > 0 ? String(card.purchasePrice) : null;
  const foil = card.finish ? card.finish !== 'nonfoil' : card.foil;
  const images =
    card.imageSmall || card.imageNormal || card.imageLarge
      ? { small: card.imageSmall, normal: card.imageNormal, large: card.imageLarge }
      : undefined;
  return {
    id: card.scryfallId,
    name: card.name,
    set: card.setCode.toLowerCase(),
    set_name: card.setName,
    collector_number: card.collectorNumber,
    rarity: card.rarity,
    finishes: card.finishes ?? [card.finish ?? (card.foil ? 'foil' : 'nonfoil')],
    frame_effects: card.frameEffects,
    full_art: card.fullArt,
    border_color: card.borderColor,
    layout: card.layout,
    promo_types: card.promoTypes,
    image_uris: images,
    card_faces: card.imageNormalBack
      ? [
          { name: card.name, image_uris: images },
          {
            name: card.name,
            image_uris: { normal: card.imageNormalBack, large: card.imageLargeBack },
          },
        ]
      : undefined,
    prices: foil ? { usd_foil: price, usd: null } : { usd: price, usd_foil: null },
  } as ScryfallCard;
}

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
 *
 * Grouped stacks with non-uniform condition/language (see `stackDetailMix`)
 * are handled by the *Touched flags on `selection.details` — see the comment
 * above that block. A quantity-only change on a mixed stack still adds/drops
 * copies here without rewriting the surviving copies' own condition/language.
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
  //
  // condition/language are gated by *Touched: on a uniform stack the dialog
  // never sends these flags, so `?? true` keeps the old unconditional-write
  // behavior byte-identical. On a MIXED stack the dialog sends `false` while
  // the user hasn't touched that field — omitting the key here (rather than
  // assigning `undefined`) means the spread below leaves each existing copy's
  // own value alone, instead of homogenizing the whole stack to one value the
  // user never chose.
  if (selection.details) {
    const conditionTouched = selection.details.conditionTouched ?? true;
    const languageTouched = selection.details.languageTouched ?? true;
    if (conditionTouched) cardFields.condition = selection.details.condition;
    if (languageTouched) cardFields.language = selection.details.language;
    cardFields.altered = selection.details.altered;
    cardFields.proxy = selection.details.proxy;
    cardFields.misprint = selection.details.misprint;
    // Cost basis, gated by *Touched like condition/language. The currency is
    // stamped here rather than in the dialog: the dialog collects a number, and
    // the applier is what decides how it's persisted. A cleared (or 0) price
    // drops both fields — zero is never a stored basis (see EnrichedCard).
    if (selection.details.acquiredPriceTouched ?? true) {
      const paid = selection.details.acquiredPrice ?? 0;
      cardFields.acquiredPrice = paid > 0 ? paid : undefined;
      cardFields.acquiredCurrency = paid > 0 ? getCurrency() : undefined;
    }
    // Market-price override (E204), gated by *Touched like the fields above.
    // Currency is stamped here for the same reason as acquiredCurrency: the
    // dialog collects a number, the applier decides how it's persisted. A
    // cleared (or 0) override drops both fields — undefined is never a stored
    // override, matching EnrichedCard.priceOverride.
    if (selection.details.priceOverrideTouched ?? true) {
      const override = selection.details.priceOverride ?? 0;
      cardFields.priceOverride = override > 0 ? override : undefined;
      cardFields.priceOverrideCurrency = override > 0 ? getCurrency() : undefined;
      // Show it immediately rather than waiting for the next applyPrices pass
      // (rehydrate/refresh) — mirrors exactly what applyPrices would compute,
      // since purchasePrice above was just stamped to the fresh Scryfall price.
      if (override > 0) cardFields.purchasePrice = override;
    }
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
  const existing = stackCopies(allCards, editingCard);
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
      (d.misprint ?? false) !== (editingCard.misprint ?? false) ||
      (d.acquiredPrice ?? 0) !== (editingCard.acquiredPrice ?? 0) ||
      (d.priceOverride ?? 0) !== (editingCard.priceOverride ?? 0)
    ) {
      return false;
    }
  }
  return true;
}
