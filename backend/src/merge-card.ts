import crypto from 'crypto';
import type { ImportRow } from './parsers/types';
import type { EnrichedCard, ScryfallCard } from './types';
import { pickUsdForFinish } from './scryfall-cache';

// Always prefer Scryfall's market price over whatever the import file claimed.
// CSV "purchase price" columns vary wildly (some are list price, some are
// what the user paid years ago, some are blank) and we've decided to ignore
// them entirely for display. Returns 0 when Scryfall has no price for any
// finish — callers can treat that as "unpriced" rather than a real $0 value.
// Finish-aware ordering lives in `pickUsdForFinish` (shared with the price
// refresh + share-projection paths) so a foil never silently shows the
// non-foil price.
function resolvePrice(row: ImportRow, scryfall: ScryfallCard | undefined): number {
  if (!scryfall) return 0;
  return pickUsdForFinish(scryfall, row.finish ?? 'nonfoil');
}

/**
 * Merge a parsed import row with its resolved Scryfall printing into the
 * EnrichedCard the frontend consumes. Extracted from server.ts so the
 * import-enrichment logic can be unit-tested without booting the HTTP server
 * (and so it falls inside the backend coverage scope).
 */
export function mergeCard(row: ImportRow, scryfall?: ScryfallCard): EnrichedCard {
  const price = resolvePrice(row, scryfall);
  const base: EnrichedCard = {
    copyId: crypto.randomUUID(),
    name: scryfall?.name || row.name,
    setCode: scryfall?.set?.toUpperCase() || row.setCode || '',
    setName: scryfall?.set_name || row.setName || '',
    collectorNumber: scryfall?.collector_number || row.collectorNumber || '',
    rarity: (scryfall?.rarity || row.rarity || '').toLowerCase(),
    scryfallId: scryfall?.id || row.scryfallId || '',
    purchasePrice: price,
    sourceCategory: row.sourceCategory || '',
    sourceFormat: row.sourceFormat,
    finish: row.finish ?? 'nonfoil',
    foil: (row.finish ?? 'nonfoil') !== 'nonfoil',
  };
  if (row.condition !== undefined) base.condition = row.condition;
  if (row.language !== undefined) base.language = row.language;
  if (row.altered !== undefined) base.altered = row.altered;
  if (row.proxy !== undefined) base.proxy = row.proxy;
  if (row.misprint !== undefined) base.misprint = row.misprint;
  if (price > 0) base.pricedAt = Date.now();

  if (scryfall) {
    if (scryfall.oracle_id) base.oracleId = scryfall.oracle_id;
    // Some layouts (reversible_card, art_series, etc.) leave top-level type_line/cmc/colors
    // null and put the real data on the faces. Fall back to the first face so binder routing
    // and section grouping see real values for those printings.
    const firstFace = scryfall.card_faces?.[0];
    base.cmc = scryfall.cmc ?? firstFace?.cmc;
    base.typeLine = scryfall.type_line ?? firstFace?.type_line;
    base.colorIdentity = scryfall.color_identity;
    base.colors = scryfall.colors ?? firstFace?.colors;
    base.edhrecRank = scryfall.edhrec_rank;
    base.imageSmall = scryfall.image_uris?.small || firstFace?.image_uris?.small;
    base.imageNormal = scryfall.image_uris?.normal || firstFace?.image_uris?.normal;
    // Two-sided layouts (transform / modal_dfc / reversible / double_faced_token)
    // give each face its own image_uris. Capture the back so the preview can flip.
    const backFace = scryfall.card_faces?.[1];
    if (backFace?.image_uris?.normal) {
      base.imageNormalBack = backFace.image_uris.normal;
    }
    base.frameEffects = scryfall.frame_effects;
    // Older fullart lands don't put 'fullart' in frame_effects — they only set full_art.
    base.fullArt = scryfall.full_art === true || scryfall.frame_effects?.includes('fullart');
    base.borderColor = scryfall.border_color;
    base.layout = scryfall.layout;
    base.legalities = scryfall.legalities;
    base.finishes = scryfall.finishes;
    base.promoTypes = scryfall.promo_types;

    // Mana cost / oracle text — multi-face cards leave the top-level fields empty
    // and put data on each face. Join faces with separators so substring matching works.
    const faces = scryfall.card_faces;
    if (scryfall.mana_cost) {
      base.manaCost = scryfall.mana_cost;
    } else if (faces && faces.length > 0) {
      const joined = faces.map((f) => f.mana_cost ?? '').join(' // ');
      if (joined.replace(/\s|\/\//g, '').length > 0) base.manaCost = joined;
    }
    if (scryfall.oracle_text) {
      base.oracleText = scryfall.oracle_text;
    } else if (faces && faces.length > 0) {
      const joined = faces
        .map((f) => f.oracle_text ?? '')
        .filter(Boolean)
        .join('\n//\n');
      if (joined.length > 0) base.oracleText = joined;
    }
  }

  return base;
}
