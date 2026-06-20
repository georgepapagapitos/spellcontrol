import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard, Finish } from '../types';

/**
 * Price for the chosen finish, falling back to any available price so a
 * card never lands at $0 just because its specific finish isn't priced.
 */
function resolvePrice(scryfall: ScryfallCard, finish: Finish): number {
  const p = scryfall.prices;
  if (!p) return 0;
  const preferred = finish === 'foil' ? p.usd_foil : finish === 'etched' ? p.usd_etched : p.usd;
  for (const raw of [preferred, p.usd, p.usd_foil, p.usd_etched]) {
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Options for `scryfallToEnrichedCard`.
 *
 * Back-compat: the second argument may also be a bare `Finish` string (legacy
 * callers), in which case it is treated as `{ finish }`.
 */
export interface ScryfallToEnrichedOpts {
  finish?: Finish;
  /**
   * Explicit normal-res image URL for the front face. When set, `imageLarge`
   * is suppressed — pulling `large` off the base Scryfall card could surface a
   * different printing's art behind this override.
   */
  frontImageOverride?: string;
  /**
   * Explicit normal-res image URL for the back face. When set, `imageLargeBack`
   * is suppressed for the same reason as `frontImageOverride`.
   */
  backImageOverride?: string;
  /**
   * Metadata overrides from a saved deck row (printing-identity fields).
   * These win over what the current Scryfall fetch returns so the carousel
   * reflects the physical copy the user owns, not the default printing.
   */
  overrides?: {
    foil?: boolean;
    finish?: Finish;
    finishes?: string[];
    promoTypes?: string[];
    frameEffects?: string[];
    setCode?: string;
    setName?: string;
    collectorNumber?: string;
    rarity?: string;
  };
  sourceFormat?: EnrichedCard['sourceFormat'];
}

export function scryfallToEnrichedCard(
  scryfall: ScryfallCard,
  opts: ScryfallToEnrichedOpts | Finish = 'nonfoil'
): EnrichedCard {
  // Back-compat: callers may pass a bare finish string.
  const o: ScryfallToEnrichedOpts = typeof opts === 'string' ? { finish: opts } : opts;
  const finish: Finish = o.finish ?? 'nonfoil';

  const price = resolvePrice(scryfall, finish);
  const firstFace = scryfall.card_faces?.[0];
  const backFace = scryfall.card_faces?.[1];

  // When an explicit normal-res override URL is present, suppress the large-res
  // field. The base ScryfallCard's `large` image belongs to whatever printing
  // Scryfall returned; using it alongside an override URL would show a different
  // printing's art in the carousel.
  const imageLarge = o.frontImageOverride
    ? undefined
    : scryfall.image_uris?.large || firstFace?.image_uris?.large;
  const imageLargeBackRaw =
    o.backImageOverride || !backFace ? undefined : backFace.image_uris?.large;

  const card: EnrichedCard = {
    copyId: crypto.randomUUID(),
    name: scryfall.name,
    setCode: o.overrides?.setCode ?? (scryfall.set?.toUpperCase() || ''),
    setName: o.overrides?.setName ?? (scryfall.set_name || ''),
    collectorNumber: o.overrides?.collectorNumber ?? (scryfall.collector_number || ''),
    rarity: o.overrides?.rarity ?? (scryfall.rarity || '').toLowerCase(),
    scryfallId: scryfall.id || '',
    purchasePrice: price,
    sourceCategory: '',
    sourceFormat: o.sourceFormat ?? 'manual',
    finish: o.overrides?.finish ?? finish,
    foil: o.overrides?.foil ?? finish !== 'nonfoil',
    oracleId: scryfall.oracle_id,
    cmc: scryfall.cmc,
    typeLine: scryfall.type_line ?? firstFace?.type_line,
    colorIdentity: scryfall.color_identity,
    colors: scryfall.colors ?? firstFace?.colors,
    edhrecRank: scryfall.edhrec_rank,
    imageSmall: scryfall.image_uris?.small || firstFace?.image_uris?.small,
    imageNormal:
      o.frontImageOverride ?? (scryfall.image_uris?.normal || firstFace?.image_uris?.normal),
    imageLarge,
    frameEffects: o.overrides?.frameEffects ?? scryfall.frame_effects,
    fullArt: scryfall.full_art === true || scryfall.frame_effects?.includes('fullart'),
    borderColor: scryfall.border_color,
    layout: scryfall.layout,
    legalities: scryfall.legalities,
    finishes: o.overrides?.finishes ?? scryfall.finishes,
    promoTypes: o.overrides?.promoTypes ?? scryfall.promo_types,
  };

  if (price > 0) card.pricedAt = Date.now();

  const backNormal = o.backImageOverride ?? backFace?.image_uris?.normal;
  if (backNormal) card.imageNormalBack = backNormal;

  if (imageLargeBackRaw) card.imageLargeBack = imageLargeBackRaw;

  if (scryfall.mana_cost) {
    card.manaCost = scryfall.mana_cost;
  } else if (scryfall.card_faces && scryfall.card_faces.length > 0) {
    const joined = scryfall.card_faces.map((f) => f.mana_cost ?? '').join(' // ');
    if (joined.replace(/\s|\/\//g, '').length > 0) card.manaCost = joined;
  }

  if (scryfall.oracle_text) {
    card.oracleText = scryfall.oracle_text;
  } else if (scryfall.card_faces && scryfall.card_faces.length > 0) {
    const joined = scryfall.card_faces
      .map((f) => f.oracle_text ?? '')
      .filter(Boolean)
      .join('\n//\n');
    if (joined.length > 0) card.oracleText = joined;
  }

  return card;
}
