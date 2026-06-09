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
 * Maps a Scryfall mana-cost symbol payload to its mana-font class string.
 *   "W"    → "ms ms-w ms-cost"
 *   "2/W"  → "ms ms-2w ms-split ms-cost"
 *   "T"    → "ms ms-tap ms-cost"   (mana-font aliases handled by the font)
 *   "X"    → "ms ms-x ms-cost"
 * Used for rendering full cost strings (ManaCost) and inline symbol prose
 * (MagicText), where each `{…}` payload becomes one `<i>`.
 */
export function symbolToClass(sym: string): string {
  const lower = sym.toLowerCase().replace(/\//g, '');
  const isHybrid = sym.includes('/');
  return `ms ms-${lower} ms-cost${isHybrid ? ' ms-split' : ''}`;
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
