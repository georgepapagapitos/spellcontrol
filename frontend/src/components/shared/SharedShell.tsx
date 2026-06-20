import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';

interface Props {
  children: ReactNode;
  action?: ReactNode;
}

/**
 * Brand chrome wrapper for all shared (/s/:token) views. Adds a sticky brand
 * bar above and a footer CTA below without pulling in any auth-coupled store
 * (unlike <Header> and <Footer> which depend on auth/collection/play stores).
 */
export function SharedShell({ children, action }: Props) {
  return (
    <div className="shared-shell">
      <header className="shared-brandbar">
        <Link className="shared-brand" to="/" aria-label="SpellControl">
          <BrandMark size={24} aria-hidden className="shared-brand-mark" />
          <span className="shared-brand-text">SpellControl</span>
        </Link>
        {action && <div className="shared-brandbar-action">{action}</div>}
      </header>

      {children}

      <footer className="shared-footer">
        <Link className="shared-footer-cta" to="/">
          Plan your own binders &amp; decks
        </Link>
        <p className="shared-footer-fineprint">
          Card data from{' '}
          <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
            Scryfall
          </a>
        </p>
      </footer>
    </div>
  );
}
