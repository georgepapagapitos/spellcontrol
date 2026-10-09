import type { CSSProperties, ReactNode } from 'react';
import { ColorPip } from '@/components/shared/ManaSymbol';

const COLOR_NAMES: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

interface Props {
  /** The commander's art_crop, drawn as a thumbnail. Absent → no thumbnail. */
  art?: string;
  /** The deck's own color: the thumbnail's foot, or the title column's rule. */
  color?: string;
  /** The deck's color identity (WUBRG), as pips at the head of the meta line. */
  colors?: readonly string[];
  /** A back link, heading the title column. */
  back?: ReactNode;
  /** The h1 (or the owner's inline rename editor). */
  title: ReactNode;
  /** One line under the title: format · count · value · bracket · visibility. */
  meta: ReactNode;
  /** Anything that belongs under the meta line (a byline, the fork credit). */
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * The deck page's header, shared by the owner's editor and the shared/public
 * deck (STYLE_GUIDE § Page hero art, deck header): a compact bar, so the deck
 * itself has the screen. The commander's art is a thumbnail beside the title,
 * never a stretched banner: Scryfall's art_crop is ~626px wide, which a wide
 * panel upscales into a blur. Then back link, title and one meta line in a
 * column, and the actions on the right (their own row on a phone).
 */
export function DeckHero({
  art,
  color,
  colors,
  back,
  title,
  meta,
  children,
  actions,
  className,
}: Props) {
  // WUBRG order, whatever order a commander and its partner were merged in.
  const pips = Object.keys(COLOR_NAMES).filter((c) => colors?.includes(c));
  return (
    <header
      className={`deck-editor-hero${art ? ' deck-editor-hero--art' : ''}${className ? ` ${className}` : ''}`}
      style={color ? ({ '--deck-color': color } as CSSProperties) : undefined}
    >
      {art && <img className="deck-editor-hero-art" src={art} alt="" aria-hidden="true" />}
      <div className="deck-editor-hero-text">
        {back}
        {title}
        <p className="binder-hero-meta">
          {pips.length > 0 && (
            <span
              className="deck-hero-colors"
              role="img"
              aria-label={`Colors: ${pips.map((c) => COLOR_NAMES[c]).join(', ')}`}
            >
              {pips.map((c) => (
                <ColorPip key={c} color={c} />
              ))}
            </span>
          )}
          {meta}
        </p>
        {children}
      </div>
      {actions && <div className="deck-editor-actions">{actions}</div>}
    </header>
  );
}
