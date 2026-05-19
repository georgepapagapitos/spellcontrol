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

export function scryfallToEnrichedCard(
  scryfall: ScryfallCard,
  finish: Finish = 'nonfoil'
): EnrichedCard {
  const price = resolvePrice(scryfall, finish);
  const firstFace = scryfall.card_faces?.[0];
  const backFace = scryfall.card_faces?.[1];

  const card: EnrichedCard = {
    copyId: crypto.randomUUID(),
    name: scryfall.name,
    setCode: scryfall.set?.toUpperCase() || '',
    setName: scryfall.set_name || '',
    collectorNumber: scryfall.collector_number || '',
    rarity: (scryfall.rarity || '').toLowerCase(),
    scryfallId: scryfall.id || '',
    purchasePrice: price,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish,
    foil: finish !== 'nonfoil',
    oracleId: scryfall.oracle_id,
    cmc: scryfall.cmc,
    typeLine: scryfall.type_line ?? firstFace?.type_line,
    colorIdentity: scryfall.color_identity,
    colors: scryfall.colors ?? firstFace?.colors,
    edhrecRank: scryfall.edhrec_rank,
    imageSmall: scryfall.image_uris?.small || firstFace?.image_uris?.small,
    imageNormal: scryfall.image_uris?.normal || firstFace?.image_uris?.normal,
    imageLarge: scryfall.image_uris?.large || firstFace?.image_uris?.large,
    frameEffects: scryfall.frame_effects,
    fullArt: scryfall.full_art === true || scryfall.frame_effects?.includes('fullart'),
    borderColor: scryfall.border_color,
    layout: scryfall.layout,
    legalities: scryfall.legalities,
    finishes: scryfall.finishes,
    promoTypes: scryfall.promo_types,
  };

  if (price > 0) card.pricedAt = Date.now();

  if (backFace?.image_uris?.normal) {
    card.imageNormalBack = backFace.image_uris.normal;
  }

  if (backFace?.image_uris?.large) {
    card.imageLargeBack = backFace.image_uris.large;
  }

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
