import type { ScryfallCard } from '@/deck-builder/types';

/** Mana keys we tally: the five colors plus colorless. */
export const MANA_KEYS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * The colors of mana a card can produce, as WUBRG + C keys. This is the single
 * source of truth for "what does this card tap for" used by the deck's
 * mana-source tally (lands, rocks, dorks — any permanent that produces mana).
 *
 * Scryfall's `produced_mana` is authoritative and already includes `C` for
 * colorless. We override it for two families of *contextual* fixers that
 * Scryfall prints as the full rainbow because it can't know the table state,
 * clamping both to the deck's `identity`:
 *   - Commander-identity fixers — "any color in your commander's color
 *     identity" (Command Tower, Arcane Signet, Path of Ancestry).
 *   - Reflect-fixers — "any color that a land you/an opponent could produce"
 *     (Reflecting Pool, Exotic Orchard, Fellwar Stone); in practice these
 *     reflect colors within the deck's own identity, so counting them as a true
 *     5-color source over-states fixing.
 *
 * Genuine rainbow sources — "add one mana of any color" with no contextual
 * qualifier (City of Brass, Mana Confluence, Chromatic Lantern) — keep all
 * their reported colors.
 *
 * Name/text fallbacks cover the rare card cached without `produced_mana`.
 * Returns `[]` for non-producers.
 *
 * Note: this reports *colors only*. Whether a card counts as a mana source at
 * all — e.g. excluding one-shot rituals (instants/sorceries) — is decided by the
 * caller; see `isManaSourceType`.
 */
export function producedManaColors(card: ScryfallCard, identity: ReadonlySet<string>): string[] {
  const ot = (card.oracle_text ?? '').toLowerCase();
  const pm = (card.produced_mana ?? []).filter((c) => 'WUBRGC'.includes(c));
  const identityColors = COLOR_KEYS.filter((c) => identity.has(c));
  const typeLine = card.type_line || card.card_faces?.[0]?.type_line || '';

  // Contextual fixers that Scryfall prints as the full rainbow because it can't
  // know the table state: commander-identity fixers ("color identity" — Command
  // Tower, Arcane Signet) and reflect-fixers ("could produce" — Fellwar Stone,
  // Reflecting Pool, Exotic Orchard). Clamp both to the deck's identity, since
  // in practice they reflect colors within the deck's own identity and counting
  // them as a true 5-color source over-states fixing. Genuine rainbow sources
  // ("any color" with no qualifier — City of Brass) fall through and keep all
  // their reported colors. If the deck has no identity yet, fall back to the
  // reported colors rather than dropping the source entirely.
  const clampToIdentity = ot.includes('color identity') || ot.includes('could produce');
  const rainbow = COLOR_KEYS.every((c) => pm.includes(c));
  if (clampToIdentity && (rainbow || pm.length === 0)) {
    return identityColors.length > 0 ? identityColors : pm;
  }

  if (pm.length > 0) return pm;

  // Fallbacks for the rare card cached without produced_mana.
  const out = new Set<string>();
  const tl = typeLine.toLowerCase();
  if (tl.includes('plains') || ot.includes('add {w}')) out.add('W');
  if (tl.includes('island') || ot.includes('add {u}')) out.add('U');
  if (tl.includes('swamp') || ot.includes('add {b}')) out.add('B');
  if (tl.includes('mountain') || ot.includes('add {r}')) out.add('R');
  if (tl.includes('forest') || ot.includes('add {g}')) out.add('G');
  if (ot.includes('any color') || ot.includes('any type')) {
    for (const c of COLOR_KEYS) out.add(c);
  }
  return [...out];
}

/**
 * Whether a card's type makes it part of the mana *base* — i.e. a permanent that
 * can keep producing mana. One-shot rituals (instants/sorceries that "Add {X}")
 * produce mana but aren't sources you can count on, so they're excluded. Checks
 * the front face so an MDFC/adventure permanent isn't dropped by a back-face
 * spell type.
 */
export function isManaSourceType(card: ScryfallCard): boolean {
  const frontType = (card.type_line || card.card_faces?.[0]?.type_line || '')
    .split('//')[0]
    .toLowerCase();
  return !frontType.includes('instant') && !frontType.includes('sorcery');
}

/**
 * The deck's color identity, used to clamp contextual fixers. In Commander this
 * is the commander(s)' identity; otherwise the union of every card's identity.
 */
export function deckColorIdentity(
  cards: readonly ScryfallCard[],
  commanders: ReadonlyArray<ScryfallCard | null | undefined>
): Set<string> {
  const identity = new Set<string>();
  const named = commanders.filter(Boolean) as ScryfallCard[];
  const source = named.length > 0 ? named : cards;
  for (const c of source) {
    for (const k of c.color_identity ?? []) if ('WUBRG'.includes(k)) identity.add(k);
  }
  return identity;
}
