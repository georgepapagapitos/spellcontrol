/**
 * Shared keyrune set-symbol helpers — the sister module to `mana-symbols.ts`
 * for the *set* icon font. The `SetSymbol` component in
 * `components/shared/SetSymbol.tsx` is the rendering layer on top of this.
 *
 * keyrune is loaded globally in `main.tsx` (`keyrune/css/keyrune.min.css`),
 * mirroring mana-font — the font is bundled, so set glyphs work offline with
 * no per-set network fetch (unlike Scryfall's `icon_svg_uri`).
 */

export type RarityTint = 'common' | 'uncommon' | 'rare' | 'mythic';

/**
 * Maps a Scryfall rarity word to the glyph tint tier. Rarities without a
 * dedicated tint (special, bonus, unknown, missing) render as common/neutral.
 */
export function rarityTint(rarity: string | undefined): RarityTint {
  const r = (rarity ?? '').toLowerCase();
  return r === 'uncommon' || r === 'rare' || r === 'mythic' ? r : 'common';
}

/**
 * Builds the canonical tooltip/accessible name for a set glyph:
 * `"{setName} · #{collectorNumber} · {rarity}"`, skipping missing parts and
 * falling back to the uppercase set code when the set name isn't resolved.
 */
export function setSymbolTitle(opts: {
  setCode: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
}): string {
  const parts = [opts.setName || opts.setCode.toUpperCase()];
  if (opts.collectorNumber) parts.push(`#${opts.collectorNumber}`);
  if (opts.rarity) parts.push(opts.rarity);
  return parts.join(' · ');
}
