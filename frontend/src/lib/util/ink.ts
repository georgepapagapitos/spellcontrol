// Text on a colour the user chose (binder colour, avatar fill) can't use a fixed
// ink: the presets run from pale gold to dark purple. Pick near-black or white
// per fill; whichever wins clears 4.5:1 on ANY colour (the worst case, a fill
// around L=0.18, still measures 4.58 either way). Guard: lib/util/ink.test.ts.

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (1:1 to 21:1). */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const DARK_INK = '#000000';
const LIGHT_INK = '#ffffff';

/** Whichever of near-black/white clears more contrast against the `#rrggbb` fill `bg`. */
export function inkOn(bg: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return LIGHT_INK;
  return contrastRatio(bg, DARK_INK) >= contrastRatio(bg, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}
