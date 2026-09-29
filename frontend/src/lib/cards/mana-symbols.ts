/**
 * Shared mana-font glyph helpers — the single home for turning Magic symbol
 * payloads into mana-font class fragments. Previously this logic was copy-pasted
 * across ManaCost, MagicText, and ~10 hand-rolled color-pip call sites; the
 * `ManaSymbol`/`ColorPip`/`TypeIcon` components in
 * `components/shared/ManaSymbol.tsx` are the rendering layer on top of this.
 *
 * mana-font is loaded globally in `main.tsx` (`mana-font/css/mana.min.css`).
 */

/**
 * mana-font glyph tokens that don't match the lowercased Scryfall payload.
 * The Scryfall tap/untap symbols are `{T}`/`{Q}` but the font classes are
 * `ms-tap`/`ms-untap` (there is no `ms-t`/`ms-q`) — without this mapping those
 * render as an empty `ms-cost` circle with no glyph inside.
 */
const GLYPH_ALIASES: Record<string, string> = { t: 'tap', q: 'untap' };

/**
 * Parses a Scryfall mana-cost symbol payload into the mana-font glyph token
 * (the part after `ms-`) and whether it's a split/hybrid symbol.
 *   "W"    → { token: "w",   split: false }
 *   "2/W"  → { token: "2w",  split: true  }
 *   "T"    → { token: "tap", split: false }
 */
export function parseSymbol(sym: string): { token: string; split: boolean } {
  const lower = sym.toLowerCase().replace(/\//g, '');
  return { token: GLYPH_ALIASES[lower] ?? lower, split: sym.includes('/') };
}

/**
 * Maps a Scryfall mana-cost symbol payload to its mana-font class string.
 *   "W"    → "ms ms-w ms-cost"
 *   "2/W"  → "ms ms-2w ms-cost ms-split"
 *   "T"    → "ms ms-tap ms-cost"
 *   "X"    → "ms ms-x ms-cost"
 * Used for rendering full cost strings (ManaCost) and inline symbol prose
 * (MagicText), where each `{…}` payload becomes one `<i>`.
 */
export function symbolToClass(sym: string): string {
  const { token, split } = parseSymbol(sym);
  return `ms ms-${token} ms-cost${split ? ' ms-split' : ''}`;
}

/**
 * Maps an internal color-identity key to its mana-font glyph token (the part
 * after `ms-`). Accepts the single WUBRG letters, `C`/`L` (→ colorless), and
 * `M` (→ the multicolor pie). Case-insensitive. Unknown keys fall back to
 * colorless so a pip always renders.
 */
export function colorGlyph(key: string): string {
  switch (key.toUpperCase()) {
    case 'W':
    case 'U':
    case 'B':
    case 'R':
    case 'G':
      return key.toLowerCase();
    case 'M':
      return 'multicolor';
    case 'C':
    case 'L':
      return 'c';
    default:
      return 'c';
  }
}
