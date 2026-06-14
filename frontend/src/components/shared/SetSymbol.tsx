import { rarityTint } from '@/lib/set-symbols';

/**
 * The atomic keyrune set-symbol glyph — one `<i class="ss ss-…">`, the sister
 * primitive to `ManaSymbol` (mana-font) for the *set* icon font. Every set
 * symbol on screen routes through this so the keyrune class conventions and
 * the rarity-tint mapping live in exactly one place. Helper logic lives in
 * `lib/set-symbols.ts` (use `setSymbolTitle` there to build the tooltip).
 *
 * Tinting: collector-app standard (ManaBox/Delver/Moxfield) — the glyph is
 * colored by the printing's rarity. We use flat theme-token tints
 * (`--rarity-*` in styles/tokens.css) via our own `set-symbol--*` classes rather
 * than keyrune's baked-in `ss-uncommon`/`ss-rare`/`ss-mythic` colors, so the
 * colors track the app's rarity tokens and stay legible at row-glyph sizes.
 */

function joinClasses(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

interface SetSymbolProps {
  /** Scryfall set code (e.g. "mh2"). Renders nothing when falsy. */
  setCode: string;
  /** Scryfall rarity word — common / uncommon / rare / mythic; tints the glyph. */
  rarity?: string;
  /**
   * Accessible name + native tooltip (use `setSymbolTitle`). When omitted the
   * glyph is `aria-hidden` — most call sites sit next to a visible set-code
   * label or inside a labelled row.
   */
  title?: string;
  /** Extra class(es) for per-surface tweaks. */
  className?: string;
}

/** A rarity-tinted set symbol — the printing-identity glyph on card rows (T36). */
export function SetSymbol({ setCode, rarity, title, className }: SetSymbolProps) {
  if (!setCode) return null;
  const cls = joinClasses(
    'ss',
    `ss-${setCode.toLowerCase()}`,
    'ss-fw',
    'set-symbol',
    `set-symbol--${rarityTint(rarity)}`,
    className
  );
  return title ? (
    <i className={cls} role="img" aria-label={title} title={title} />
  ) : (
    <i className={cls} aria-hidden />
  );
}
