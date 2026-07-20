import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';

interface Props {
  children: ReactNode;
  action?: ReactNode;
  /** Footer CTA copy — override on surfaces where "binders & decks" misses
      (e.g. game nights). */
  ctaLabel?: string;
}

/**
 * Brand chrome wrapper for all shared (/s/:token) views. Adds a sticky brand
 * bar above and a footer CTA below without pulling in any auth-coupled store
 * (unlike <Header> and <Footer> which depend on auth/collection/play stores).
 */
export function SharedShell({ children, action, ctaLabel }: Props) {
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
          {ctaLabel ?? 'Plan your own binders & decks'}
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

interface NotFoundViewProps {
  title?: string;
  message?: string;
}

/**
 * Shared "nothing here" dead-end-avoider for any `SharedShell`-wrapped public
 * page — originally `/s/:token`-only, now also used by `/u/:username`
 * (w1-public-profile-page). Defaults preserve `/s/:token`'s original copy
 * byte-for-byte; callers with a different subject (a hidden/unknown profile,
 * a deck) pass their own `title`/`message`.
 */
export function NotFoundView({
  title = 'Link not found',
  message = 'This share link is invalid or has been revoked.',
}: NotFoundViewProps) {
  return (
    <main className="shared-view shared-view--missing">
      <h1>{title}</h1>
      <p>{message}</p>
      <Link to="/" className="btn btn-primary shared-copy-btn">
        Go to SpellControl
      </Link>
    </main>
  );
}

interface ErrorViewProps {
  message: string;
}

/** Shared network/unexpected-error state for any `SharedShell`-wrapped public
 *  page. Same reuse rationale as `NotFoundView` above. */
export function ErrorView({ message }: ErrorViewProps) {
  return (
    <main className="shared-view shared-view--error">
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <Link to="/" className="btn btn-primary shared-copy-btn">
        Go to SpellControl
      </Link>
    </main>
  );
}
