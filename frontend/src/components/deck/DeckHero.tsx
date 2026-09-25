import type { CSSProperties, ReactNode } from 'react';

interface Props {
  /** The commander's art_crop. Absent → the plain header (no art, no height). */
  art?: string;
  /** The deck's own colour, drawn as the title column's left rule. */
  color?: string;
  /** A back link. Rides on the art on a phone, heads the column wider up. */
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
 * deck (STYLE_GUIDE § Layout system, § Page hero art): back link, title, one
 * meta line, then the actions, all in one block. On a phone the art is
 * full-bleed behind a dark scrim with the text bottom-anchored on it; from
 * 600px it is a ~2:1 panel on the right and the text sits on the page.
 */
export function DeckHero({ art, color, back, title, meta, children, actions, className }: Props) {
  return (
    <header
      className={`deck-editor-hero${art ? ' deck-editor-hero--art' : ''}${className ? ` ${className}` : ''}`}
      style={color ? ({ '--deck-color': color } as CSSProperties) : undefined}
    >
      {art && <img className="deck-editor-hero-art" src={art} alt="" aria-hidden="true" />}
      {back}
      <div className="deck-editor-hero-text">
        {title}
        <p className="binder-hero-meta">{meta}</p>
        {children}
      </div>
      {actions && <div className="deck-editor-actions">{actions}</div>}
    </header>
  );
}
