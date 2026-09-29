import { contrastRatio, inkOn } from '../lib/ink';
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

export { contrastRatio, inkOn as fallbackTextColor };

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
  const color = inkOn(bg);
  // Array.from splits on code points, so an emoji or astral-plane letter
  // isn't cut into a lone surrogate half.
  const initial = (Array.from(name.trim())[0] ?? '?').toUpperCase();

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
