import type { ScryfallCard } from '@/deck-builder/types';
import type { SlimCard, SlimCardFace } from './types';

/**
 * Inflate a SlimCard back into a ScryfallCard-shaped object so existing
 * consumers (deck builder, card lists, combo UI) don't need to learn about
 * the slim shape. Fields the slim payload doesn't carry (`set_name`, the
 * rich price object) are filled with safe defaults. `rarity` is carried by
 * slim payloads built by builder v3+; older payloads fall back to 'common'.
 */
export function slimToScryfall(s: SlimCard): ScryfallCard {
  const card: ScryfallCard = {
    id: s.scryfallId,
    oracle_id: s.oracleId,
    name: s.name,
    mana_cost: s.manaCost,
    cmc: s.cmc,
    type_line: s.typeLine,
    oracle_text: s.oracleText,
    colors: s.colors,
    color_identity: s.colorIdentity,
    keywords: s.keywords ?? [],
    produced_mana: s.producedMana,
    rarity: s.rarity ?? 'common', // pre-v3 slim payloads dropped rarity
    layout: s.layout,
    set: s.set,
    set_name: s.setName ?? s.set,
    collector_number: s.collectorNumber,
    edhrec_rank: s.edhrecRank,
    image_uris: s.imageNormal
      ? {
          small: s.imageSmall ?? s.imageNormal,
          normal: s.imageNormal,
          large: s.imageLarge ?? s.imageNormal,
          // ScryfallCard's image_uris type marks these as required; pass
          // through the normal URL as a fallback since we never render them.
          png: s.imageLarge ?? s.imageNormal,
          art_crop: s.imageNormal,
          border_crop: s.imageNormal,
        }
      : undefined,
    card_faces: s.faces?.map(slimFaceToScryfall),
    prices: {
      usd: s.usdPrice ?? null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
    },
    legalities: {
      commander: s.legalities.commander ?? 'not_legal',
      ...s.legalities,
    },
  };
  if (s.isGameChanger) card.isGameChanger = true;
  return card;
}

function slimFaceToScryfall(f: SlimCardFace): NonNullable<ScryfallCard['card_faces']>[number] {
  return {
    name: f.name,
    mana_cost: f.manaCost,
    type_line: f.typeLine ?? '',
    oracle_text: f.oracleText,
    colors: f.colors,
    image_uris: f.imageNormal
      ? {
          small: f.imageSmall ?? f.imageNormal,
          normal: f.imageNormal,
          large: f.imageLarge ?? f.imageNormal,
        }
      : undefined,
  };
}
