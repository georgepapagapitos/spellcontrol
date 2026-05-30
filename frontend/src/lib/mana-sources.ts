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
 * colorless. The one place we override it is cards limited to "any color in
 * your commander's color identity" — Command Tower, Arcane Signet, Path of
 * Ancestry — where Scryfall prints the full rainbow because it can't know the
 * commander; we clamp those to the deck's `identity`.
 *
 * Everything else keeps its reported colors, including reflect-fixers like
 * Reflecting Pool, Exotic Orchard, and Fellwar Stone ("any color a land
 * you/an opponent controls could produce") and genuine rainbow sources like
 * City of Brass and Chromatic Lantern — all treated as producing every color
 * they can report.
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

  // Commander-identity fixers (Command Tower, Arcane Signet): Scryfall reports
  // the full rainbow, so clamp to the deck's identity. Reflect-fixers ("could
  // produce") and true rainbow sources are intentionally left alone.
  const commanderClamped = ot.includes('color identity');
  const rainbow = COLOR_KEYS.every((c) => pm.includes(c));
  if (commanderClamped && (rainbow || pm.length === 0)) {
    return identityColors;
  }

  if (pm.length > 0) return pm;

  // Fallbacks for the rare card cached without produced_mana.
  const out = new Set<string>();
  const tl = (card.type_line ?? '').toLowerCase();
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
  const frontType = (card.type_line ?? '').split('//')[0].toLowerCase();
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
