/**
 * Pure filter logic for the shared collection / binder / deck views. Reuses the
 * SAME matching engine (`@spellcontrol/binder-routing`) the authed collection
 * uses, so shared views filter identically instead of maintaining a parallel
 * hand-rolled predicate.
 *
 * The public share payload (`PublicCard`) is a structural near-superset of the
 * engine's `EnrichedCard` — the fields it reads (typeLine, colorIdentity, cmc,
 * rarity, setCode, layout, manaCost, finish, …) already line up by name — so the
 * adapter just supplies the few required-but-unread fields plus name-derived
 * oracle `tags`. Facets the slim payload can't back (oracle text, legality,
 * treatment, border) are simply not exposed by the shared filter UI.
 *
 * Kept store-agnostic: shared views must not touch zustand stores.
 */
import type { PublicCard, PublicDeckCard } from './shared-types';
import type { BinderFilter, ChipExpression, EnrichedCard } from '../types';
import { getCardTags } from './card-tags';
import { colorSelectionMatches, getColorKey, type ColorMatchMode } from './colors';
import { cardMatchesCompiled, compileFilter, isExpressionEmpty } from './rules';

/** Committed filter state the shared views hold and the dialog edits. */
export interface SharedFilterState {
  supertypeExpr: ChipExpression;
  typesExpr: ChipExpression;
  subtypeExpr: ChipExpression;
  /** Color-identity codes W/U/B/R/G + C (colorless). */
  colorFilter: ReadonlySet<string>;
  /** How multiple selected colors combine — OR ('any', default) or AND ('all'). */
  colorMode: ColorMatchMode;
  rarityExpr: ChipExpression;
  oracleExpr: ChipExpression;
  oracleTagExpr: ChipExpression;
  legalityExpr: ChipExpression;
  layoutExpr: ChipExpression;
  treatmentExpr: ChipExpression;
  borderExpr: ChipExpression;
  finishExpr: ChipExpression;
  /** Selected set codes (uppercased). */
  setFilter: ReadonlySet<string>;
  cmcMin?: number;
  cmcMax?: number;
  priceMin?: number;
  priceMax?: number;
}

/**
 * Adapt a `PublicCard` to the `EnrichedCard` shape both the routing engine and
 * the shared card carousel consume. Field names already align; `tags` is
 * decorated from the name-keyed snapshot (empty until it loads), image fields
 * carry through for the carousel, and the required-but-unread copy fields get
 * harmless stubs.
 */
export function publicCardToEnriched(pc: PublicCard): EnrichedCard {
  return {
    copyId: pc.scryfallId,
    name: pc.name,
    oracleId: pc.oracleId,
    setCode: pc.setCode,
    setName: pc.setName,
    collectorNumber: pc.collectorNumber,
    rarity: pc.rarity,
    scryfallId: pc.scryfallId,
    purchasePrice: pc.purchasePrice,
    sourceCategory: '',
    sourceFormat: '',
    finish: pc.finish,
    foil: pc.foil,
    cmc: pc.cmc,
    typeLine: pc.typeLine,
    colorIdentity: pc.colorIdentity,
    colors: pc.colors,
    layout: pc.layout,
    manaCost: pc.manaCost,
    oracleText: pc.oracleText,
    legalities: pc.legalities,
    frameEffects: pc.frameEffects,
    fullArt: pc.fullArt,
    borderColor: pc.borderColor,
    imageSmall: pc.imageSmall,
    imageNormal: pc.imageNormal,
    imageNormalBack: pc.imageNormalBack,
    tags: getCardTags(pc.name),
  };
}

/** Build the engine `BinderFilter` from committed shared state (empty facets omitted). */
export function buildSharedBinderFilter(s: SharedFilterState): BinderFilter {
  const f: BinderFilter = {};
  if (!isExpressionEmpty(s.supertypeExpr)) f.supertypeChips = s.supertypeExpr;
  if (!isExpressionEmpty(s.typesExpr)) f.typeTokenChips = s.typesExpr;
  if (!isExpressionEmpty(s.subtypeExpr)) f.subtypeChips = s.subtypeExpr;
  if (!isExpressionEmpty(s.rarityExpr)) f.rarities = s.rarityExpr;
  if (!isExpressionEmpty(s.oracleExpr)) f.oracleChips = s.oracleExpr;
  if (!isExpressionEmpty(s.oracleTagExpr)) f.oracleTagChips = s.oracleTagExpr;
  if (!isExpressionEmpty(s.legalityExpr)) f.legalities = s.legalityExpr;
  if (!isExpressionEmpty(s.layoutExpr)) f.layouts = s.layoutExpr;
  if (!isExpressionEmpty(s.treatmentExpr)) f.treatments = s.treatmentExpr;
  if (!isExpressionEmpty(s.borderExpr)) f.borderColors = s.borderExpr;
  if (!isExpressionEmpty(s.finishExpr)) f.finishes = s.finishExpr;
  if (s.setFilter.size > 0) f.setCodes = [...s.setFilter].map((c) => c.toUpperCase());
  if (s.priceMin !== undefined) f.priceMin = s.priceMin;
  if (s.priceMax !== undefined) f.priceMax = s.priceMax;
  if (s.cmcMin !== undefined) f.cmcMin = s.cmcMin;
  if (s.cmcMax !== undefined) f.cmcMax = s.cmcMax;
  return f;
}

/**
 * Color-identity post-check — kept separate from the engine filter because the
 * collection uses the same "any selected color in identity (C = colorless)"
 * semantics rather than the engine's color-key rule (mirrors CardListTable).
 */
export function colorMatches(
  card: EnrichedCard,
  colorFilter: ReadonlySet<string>,
  mode: ColorMatchMode = 'any'
): boolean {
  if (colorFilter.size === 0) return true;
  return colorSelectionMatches(getColorKey(card), card.colorIdentity ?? [], colorFilter, mode);
}

/**
 * Build a per-card predicate from committed shared state. Compiles the engine
 * filter once; the returned function adapts + color-checks + engine-matches each
 * card.
 */
export function makeSharedMatcher(state: SharedFilterState): (pc: PublicCard) => boolean {
  const compiled = compileFilter(buildSharedBinderFilter(state));
  return (pc) => {
    const card = publicCardToEnriched(pc);
    if (!colorMatches(card, state.colorFilter, state.colorMode)) return false;
    return cardMatchesCompiled(card, compiled);
  };
}

/** Count of active facets — drives the filter-button badge. */
export function countActiveSharedFilters(s: SharedFilterState): number {
  return (
    (isExpressionEmpty(s.supertypeExpr) ? 0 : 1) +
    (isExpressionEmpty(s.typesExpr) ? 0 : 1) +
    (isExpressionEmpty(s.subtypeExpr) ? 0 : 1) +
    s.colorFilter.size +
    (isExpressionEmpty(s.rarityExpr) ? 0 : 1) +
    (isExpressionEmpty(s.oracleExpr) ? 0 : 1) +
    (isExpressionEmpty(s.oracleTagExpr) ? 0 : 1) +
    (isExpressionEmpty(s.legalityExpr) ? 0 : 1) +
    (isExpressionEmpty(s.layoutExpr) ? 0 : 1) +
    (isExpressionEmpty(s.treatmentExpr) ? 0 : 1) +
    (isExpressionEmpty(s.borderExpr) ? 0 : 1) +
    (isExpressionEmpty(s.finishExpr) ? 0 : 1) +
    s.setFilter.size +
    (s.priceMin !== undefined || s.priceMax !== undefined ? 1 : 0) +
    (s.cmcMin !== undefined || s.cmcMax !== undefined ? 1 : 0)
  );
}

/**
 * Coerces a deck slot's stored `card: ScryfallCard`-shaped value into the
 * `PublicCard` shape the shared tile/list components use. Best-effort — fields
 * a deck card doesn't carry (purchasePrice, condition, …) default to safe
 * placeholders.
 *
 * Lives beside `publicCardToEnriched` because it is the same kind of thing: a
 * boundary coercion between the public payload's card shape and a renderer's.
 * Its last remaining caller is `DeckFeedbackView` — the per-card commenting
 * surface, which is genuinely its own view. The deck VIEW no longer needs it:
 * `/d/:slug` and `/s/:token` render the owner's own `DeckDisplay` via
 * `lib/public-deck-to-deck.ts`.
 */
export function deckCardToPublicCard(slot: PublicDeckCard): PublicCard {
  const c = slot.card;
  // Scryfall's card shape uses snake_case (image_uris, type_line, mana_cost).
  // EnrichedCards persisted on the owner's side use camelCase. The deck slot's
  // `card` is a ScryfallCard, so prefer snake_case fields with camelCase fallback.
  // Front-face fallback for transform/modal_dfc layouts, whose top-level
  // image_uris can be absent (the faces carry them instead).
  const img = (c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {}) as {
    small?: string;
    normal?: string;
    large?: string;
  };
  return {
    name: String(c.name ?? '(unknown)'),
    scryfallId: typeof c.id === 'string' ? c.id : '',
    oracleId: typeof c.oracle_id === 'string' ? c.oracle_id : undefined,
    setCode: typeof c.set === 'string' ? c.set : '',
    setName: typeof c.set_name === 'string' ? c.set_name : '',
    collectorNumber: typeof c.collector_number === 'string' ? c.collector_number : '',
    rarity: typeof c.rarity === 'string' ? c.rarity : '',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 0,
    cmc: typeof c.cmc === 'number' ? c.cmc : undefined,
    typeLine: typeof c.type_line === 'string' ? c.type_line : undefined,
    colorIdentity: Array.isArray(c.color_identity) ? (c.color_identity as string[]) : undefined,
    colors: Array.isArray(c.colors) ? (c.colors as string[]) : undefined,
    imageSmall: img.small,
    imageNormal: img.normal ?? img.large,
    manaCost: typeof c.mana_cost === 'string' ? c.mana_cost : undefined,
    oracleText: typeof c.oracle_text === 'string' ? c.oracle_text : undefined,
    legalities:
      c.legalities && typeof c.legalities === 'object'
        ? (c.legalities as Record<string, string>)
        : undefined,
    frameEffects: Array.isArray(c.frame_effects) ? (c.frame_effects as string[]) : undefined,
    fullArt: typeof c.full_art === 'boolean' ? c.full_art : undefined,
    borderColor: typeof c.border_color === 'string' ? c.border_color : undefined,
  };
}
