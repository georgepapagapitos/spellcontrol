// Card-eligibility predicates used during deck generation.
// Pure functions — no shared state, no side effects. Extracted verbatim from
// deckGenerator.ts so they can be unit-tested in isolation.
import type { ScryfallCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { fitsColorIdentity as fitsColorIdentitySet } from '@/lib/deck-validation';

// Check if a card's color identity fits within the commander's color identity.
// Thin array-signature wrapper — the actual rule lives in lib/deck-validation.ts
// (the more general home, shared with the post-save legality gate) so
// generation-time filtering and validation can't drift apart (E128).
export function fitsColorIdentity(card: ScryfallCard, commanderColors: string[]): boolean {
  return fitsColorIdentitySet(card, new Set(commanderColors));
}

// Check if a card exceeds the max price limit
// Cards with no price are treated as exceeding the limit when a budget is active
export function exceedsMaxPrice(
  card: ScryfallCard,
  maxPrice: number | null,
  currency: 'USD' | 'EUR' = 'USD'
): boolean {
  if (maxPrice === null) return false;
  const priceStr = getCardPrice(card, currency);
  if (!priceStr) return true; // No price data — skip when budget is set
  const price = parseFloat(priceStr);
  return isNaN(price) || price > maxPrice;
}

// Check if a card exceeds the max rarity limit
const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

export function exceedsMaxRarity(card: ScryfallCard, maxRarity: MaxRarity): boolean {
  if (maxRarity === null) return false;
  return (RARITY_ORDER[card.rarity] ?? 3) > RARITY_ORDER[maxRarity];
}

// Check if a card is NOT in the user's collection (for collection mode)
export function notInCollection(
  cardName: string,
  collectionNames: Set<string> | undefined
): boolean {
  if (!collectionNames) return false;
  return !collectionNames.has(cardName);
}

// Strategies that promise the generated deck is constrained to the provided
// collectionNames set. For "available", callers pass only names with free
// unclaimed copies, so it must be just as strict as "full".
export function constrainsToCollection(strategy: CollectionStrategy): boolean {
  return strategy === 'full' || strategy === 'available';
}

// Check if an owned card is exempt from budget constraints
export function isOwnedBudgetExempt(
  cardName: string,
  collectionNames: Set<string> | undefined,
  ignoreOwnedBudget: boolean
): boolean {
  return ignoreOwnedBudget && !!collectionNames && collectionNames.has(cardName);
}

// Check if an owned card is exempt from rarity constraints
export function isOwnedRarityExempt(
  cardName: string,
  collectionNames: Set<string> | undefined,
  ignoreOwnedRarity: boolean
): boolean {
  return ignoreOwnedRarity && !!collectionNames && collectionNames.has(cardName);
}

const COLOR_WORDS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

/**
 * E282: a colorless card whose payoff names a color the deck can't cast —
 * "Red spells you cast cost {1} less" (Ruby Medallion) in mono-white — is
 * legal by color identity and dead on the table. The EDHREC pool never
 * recommends one, so only the owned-collection fill paths (typed Scryfall
 * fill, owned-substitute tier) can reach it; they gate on this.
 */
export function isDeadInIdentity(card: ScryfallCard, colorIdentity: readonly string[]): boolean {
  const texts = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)];
  for (const text of texts) {
    const m = /\b(white|blue|black|red|green)\b[^.\n]*\byou cast cost\b/i.exec(text ?? '');
    if (m && !colorIdentity.includes(COLOR_WORDS[m[1].toLowerCase()])) return true;
  }
  return false;
}

// Check if a card is not available on MTG Arena (for Arena-only mode)
export function notOnArena(card: ScryfallCard, arenaOnly: boolean): boolean {
  if (!arenaOnly) return false;
  return !card.games?.includes('arena');
}

// Check if a non-land card exceeds the CMC cap (for Tiny Leaders)
export function exceedsCmcCap(card: ScryfallCard, maxCmc: number | null): boolean {
  if (maxCmc === null) return false;
  // Lands are never filtered by CMC (use front face for MDFCs)
  if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) return false;
  return card.cmc > maxCmc;
}

// Check if a card is banned/not legal in Commander. EDHREC/lift-derived pools
// aren't pre-scoped to legality (unlike the Scryfall-search fallback, which
// queries within `f:commander` implicitly via its color-identity search), so
// candidates sourced from a card page need an explicit gate.
export function notCommanderLegal(card: ScryfallCard): boolean {
  return card.legalities.commander !== 'legal';
}

// PDH 99s gate. Scryfall stamps `paupercommander` at ORACLE level ("ever
// printed at common"), so downshifted cards (Chainer's Edict, Command Tower)
// correctly pass and the ~26 PDH bans correctly fail. Do NOT gate on
// rarity — rarity is per-printing and would wrongly exclude downshifts.
export function notPauperCommanderLegal(card: ScryfallCard): boolean {
  return card.legalities.paupercommander !== 'legal';
}

// Format-keyed legality gate, generalized from notCommanderLegal /
// notPauperCommanderLegal so a phase doesn't need to special-case PDH: pass
// the generation's mtgFormat and get the right Scryfall legalities key.
// Anything other than paupercommander/brawl falls back to commander (the
// engine's base format, and the correct check for standard commander runs).
const FORMAT_LEGALITY_KEY: Record<string, string> = {
  paupercommander: 'paupercommander',
  brawl: 'brawl',
};

export function notLegalForFormat(card: ScryfallCard, mtgFormat: string | undefined): boolean {
  const key = (mtgFormat && FORMAT_LEGALITY_KEY[mtgFormat]) || 'commander';
  return card.legalities[key] !== 'legal';
}

// Config shape every user hard-cap check needs. Structurally matches
// GenerationConfig (deckGeneration/state.ts) — kept as a local narrow type so
// this module doesn't depend on state.ts.
export interface UserCapsConfig {
  maxRarity: MaxRarity;
  maxCmc: number | null;
  arenaOnly: boolean;
  maxCardPrice: number | null;
  currency: 'USD' | 'EUR';
  mtgFormat?: string;
  ignoreOwnedRarity?: boolean;
  ignoreOwnedBudget?: boolean;
  /** The Game Changer limit is a count, not a property of one card, so it
   *  comes in as two lookups: is this card one, and is the deck already at
   *  the limit. Absent = no limit check (callers outside generation). */
  isGameChanger?: (name: string) => boolean;
  gameChangerLimitReached?: () => boolean;
}

// Root-cause guard (E-arena-leak): every phase that introduces a card OUTSIDE
// the pre-filtered candidate pool cardPicking.ts already vets must run it
// through this same set of user hard caps, or the cap is decorative. Inert
// (always false) when every cap is off, so default-settings generation is
// byte-for-byte unaffected — verify against deckGenerator.golden.test.ts
// before relying on that.
export function violatesUserCaps(
  card: ScryfallCard,
  caps: UserCapsConfig,
  collectionNames?: Set<string>
): boolean {
  if (notLegalForFormat(card, caps.mtgFormat)) return true;
  // LIVE (stress sweep 2026-09-24): bracket 5 with "No Game Changers" shipped
  // Thassa's Oracle (combo audit) and Cyclonic Rift (post-gen fixup). Every
  // other cap was checked on those paths; this one wasn't.
  if (caps.isGameChanger?.(card.name) && caps.gameChangerLimitReached?.()) return true;
  if (exceedsCmcCap(card, caps.maxCmc)) return true;
  if (notOnArena(card, caps.arenaOnly)) return true;
  if (
    !isOwnedRarityExempt(card.name, collectionNames, !!caps.ignoreOwnedRarity) &&
    exceedsMaxRarity(card, caps.maxRarity)
  ) {
    return true;
  }
  if (
    !isOwnedBudgetExempt(card.name, collectionNames, !!caps.ignoreOwnedBudget) &&
    exceedsMaxPrice(card, caps.maxCardPrice, caps.currency)
  ) {
    return true;
  }
  return false;
}

// For a call site that already runs its own budget-tracker-aware price check
// (the dynamic effective cap, not the static maxCardPrice) — reuse the rest
// of violatesUserCaps without it re-litigating price against the static cap.
// Used by combo floor/audit too: Tiny Leaders is a FORMAT rule (every nonland
// card must be cmc <= 3), not a soft preference, so a combo piece gets no CMC
// exemption — only price stays excluded here, since the live budget-tracker
// effective cap already bounds it independently.
export function userCapsWithoutPrice(caps: UserCapsConfig): UserCapsConfig {
  return { ...caps, maxCardPrice: null };
}
