import { colorGlyph } from '@/lib/cards/mana-symbols';
import { typeIcon } from '@spellcontrol/binder-routing';
import { joinClasses } from '@/lib/util/join-classes';

interface ManaSymbolProps {
  /** mana-font glyph token (the part after `ms-`) — e.g. "w", "2w", "tap", "creature". */
  symbol: string;
  /** Apply the rounded `ms-cost` symbol treatment. */
  cost?: boolean;
  /** Split/hybrid diagonal treatment (`ms-split`). */
  split?: boolean;
  /**
   * The circular `color-pip-mana` pip treatment (styles/stats-breakdown.css):
   * a roomier circle with the glyph centered in it. Size it with `--pip-size`.
   */
  pip?: boolean;
  /** Extra class(es) for per-surface tweaks (e.g. `breakdown-icon`). */
  className?: string;
  /**
   * Accessible name. When provided, the glyph is exposed as an image with this
   * label + a native tooltip; when omitted it's `aria-hidden` (the default —
   * most call sites label a parent button/row instead).
   */
  label?: string;
  /**
   * Native tooltip for a decorative glyph (e.g. `{T}` inside rules prose) — kept
   * `aria-hidden` since the surrounding text already carries the meaning. Ignored
   * when `label` is set.
   */
  title?: string;
}

/**
 * The atomic mana-font glyph — one `<i class="ms ms-…">`. Every Magic symbol on
 * screen (mana costs, color pips, type icons) routes through this so the class
 * conventions live in exactly one place. Prefer the `ColorPip` / `TypeIcon`
 * wrappers below for those two common cases.
 */
export function ManaSymbol({ symbol, cost, split, pip, className, label, title }: ManaSymbolProps) {
  const cls = joinClasses(
    'ms',
    `ms-${symbol}`,
    cost && 'ms-cost',
    split && 'ms-split',
    pip && 'color-pip-mana',
    className
  );
  return label ? (
    <i className={cls} role="img" aria-label={label} title={label} />
  ) : (
    <i className={cls} title={title} aria-hidden />
  );
}

interface ColorPipProps {
  /** Color-identity key — WUBRG, `C`/`L` (colorless), or `M` (multicolor). */
  color: string;
  className?: string;
  /** Accessible name; defaults to `aria-hidden` (parent usually carries the label). */
  label?: string;
}

/**
 * A single color-identity pip (the WUBRG/colorless/multicolor circle). Always
 * the `color-pip-mana` treatment: mana-font's bare `ms-cost` circle hugs a
 * full-size glyph with ~1px of clearance, so pixel snapping pushes it visibly
 * off-center. Resize a pip with `--pip-size`, never by going bare.
 */
export function ColorPip({ color, className, label }: ColorPipProps) {
  return <ManaSymbol symbol={colorGlyph(color)} cost pip className={className} label={label} />;
}

interface TypeIconProps {
  /** Internal primary-type bucket — creature / instant / land / planeswalker / … */
  type: string;
  className?: string;
  /** Accessible name; defaults to `aria-hidden`. */
  label?: string;
}

/** A primary card-type glyph (creature / instant / land / …). */
export function TypeIcon({ type, className, label }: TypeIconProps) {
  return <ManaSymbol symbol={typeIcon(type)} className={className} label={label} />;
}
