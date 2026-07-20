import { PRESET_COLORS } from '../lib/preset-colors';
import './UserAvatar.css';

interface Props {
  imageUrl?: string | null;
  name: string;
  size?: number;
}

// FNV-1a — deterministic, tiny, no dependencies. Mirrors lib/seat-palette.ts's
// per-string hash (duplicated rather than imported: that file's palette/hash
// are scoped to game-seat coloring, an unrelated feature — importing across
// that boundary for five lines of arithmetic would couple two features that
// otherwise share nothing).
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colors (1:1 to 21:1). */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const FALLBACK_DARK_TEXT = '#000000';
const FALLBACK_LIGHT_TEXT = '#ffffff';

/**
 * Pick whichever of near-black/white clears more contrast against `bg`.
 * Naively hardcoding white fails WCAG AA (4.5:1) for the lighter PRESET_COLORS
 * entries (Gold, Gray, Brown, Pink measure 2.6-3.7:1 against white); picking
 * per-background instead clears 4.5:1 against every current entry — asserted
 * in UserAvatar.test.tsx, not just described.
 */
export function fallbackTextColor(bg: string): string {
  const dark = contrastRatio(bg, FALLBACK_DARK_TEXT);
  const light = contrastRatio(bg, FALLBACK_LIGHT_TEXT);
  return dark >= light ? FALLBACK_DARK_TEXT : FALLBACK_LIGHT_TEXT;
}

/**
 * Shared avatar primitive for the social program: a circular card-art image,
 * or — when no avatar is set — a flat-colored circle with the name's first
 * letter. `size` is numeric pixels rather than a `'sm'|'lg'` enum: real call
 * sites need 22 (MobileTabBar), 28 (Header), 72-128 (profile pages), which an
 * enum can't cover without per-site overrides. Purely decorative (`alt=""`/
 * `aria-hidden`) — every real call site already names the person via
 * adjacent text or its own wrapping control's `aria-label` (e.g. ProfileEditor's
 * "Choose avatar" trigger), so the avatar announcing a name too would double
 * up rather than help.
 */
export function UserAvatar({ imageUrl, name, size = 32 }: Props) {
  const style = { width: size, height: size };

  if (imageUrl) {
    return <img src={imageUrl} alt="" className="user-avatar user-avatar-img" style={style} />;
  }

  const bg = PRESET_COLORS[hash(name) % PRESET_COLORS.length].hex;
  const color = fallbackTextColor(bg);
  const initial = (name.trim().charAt(0) || '?').toUpperCase();

  return (
    <span
      className="user-avatar user-avatar-fallback"
      style={{ ...style, backgroundColor: bg, color, fontSize: size * 0.46 }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
