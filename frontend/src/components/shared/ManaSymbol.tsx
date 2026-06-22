import { colorGlyph } from '@/lib/mana-symbols';
import { typeIcon } from '@/lib/card-types';
import { joinClasses } from '@/lib/join-classes';

/**
 * Pip sizing — maps onto the existing `.color-pip-mana` CSS treatment (the
 * widened circular pip used in stats breakdowns, binder section headers, and
 * color-filter buttons). `true` = the base pip; `'md'`/`'lg'` add the size
 * modifier; `false`/omitted = a bare cost glyph with no pip background.
 */
type Pip = boolean | 'md' | 'lg';

function pipClasses(pip: Pip | undefined): string {
  if (!pip) return '';
  return joinClasses(
    'color-pip-mana',
    pip === 'md' && 'color-pip-mana--md',
    pip === 'lg' && 'color-pip-mana--lg'
  );
}

interface ManaSymbolProps {
  /** mana-font glyph token (the part after `ms-`) — e.g. "w", "2w", "tap", "creature". */
  symbol: string;
  /** Apply the rounded `ms-cost` symbol treatment. */
  cost?: boolean;
  /** Split/hybrid diagonal treatment (`ms-split`). */
  split?: boolean;
  /** Wrap with the circular `color-pip-mana` pip treatment + optional size. */
  pip?: Pip;
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
    pipClasses(pip),
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
  /** Pip treatment/size — defaults to the base pip; pass `false` for a bare glyph. */
  pip?: Pip;
  className?: string;
  /** Accessible name; defaults to `aria-hidden` (parent usually carries the label). */
  label?: string;
}

/** A single color-identity pip (the WUBRG/colorless/multicolor circle). */
export function ColorPip({ color, pip = true, className, label }: ColorPipProps) {
  return (
    <ManaSymbol symbol={colorGlyph(color)} cost pip={pip} className={className} label={label} />
  );
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
