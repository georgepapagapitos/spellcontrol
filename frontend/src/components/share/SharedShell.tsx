import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/use-document-title';
import { BrandMark } from '../shared/BrandMark';

interface Props {
  children: ReactNode;
  action?: ReactNode;
  /** Footer CTA copy — override on surfaces where "binders & decks" misses
      (e.g. game nights). */
  ctaLabel?: string;
}

/**
 * Brand chrome for the public surfaces that deliberately sit OUTSIDE the app
 * shell: the game-night pages and the public playtest table. Both are
 * full-screen, chrome-owning surfaces where the app header/nav would be in the
 * way. Everything else public — /s/:token, /d/:slug, /u/:username — renders as
 * a normal page inside <Layout> instead, so a reader gets the same navigation
 * they'd have anywhere else in the app.
 *
 * Owns the page's <main> landmark (the views it wraps render a plain <div>),
 * exactly as <Layout> does for in-app pages.
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

      <main className="shared-shell-main">{children}</main>

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
  // The tab says what the page says. A public link is often a stranger's first
  // contact and the shell they were served carries the homepage title, so
  // without this the tab (and any bookmark) claims a deck they cannot see is
  // "SpellControl — Organize MTG binders…" (E344). Set here rather than at each
  // caller so every dead end gets it, including the ones added later.
  useDocumentTitle(title);
  return (
    <div className="shared-view shared-view--missing">
      <h1>{title}</h1>
      <p>{message}</p>
      <Link to="/" className="btn btn-primary shared-copy-btn">
        Go to SpellControl
      </Link>
    </div>
  );
}

interface ErrorViewProps {
  message: string;
}

/** Shared network/unexpected-error state for any `SharedShell`-wrapped public
 *  page. Same reuse rationale as `NotFoundView` above. */
export function ErrorView({ message }: ErrorViewProps) {
  useDocumentTitle('Something went wrong');
  return (
    <div className="shared-view shared-view--error">
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <Link to="/" className="btn btn-primary shared-copy-btn">
        Go to SpellControl
      </Link>
    </div>
  );
}
