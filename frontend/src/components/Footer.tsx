/**
 * Attribution footer. Scryfall asks API consumers to display a notice that card data
 * comes from them; this is the cheapest way to honor that.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useShortcutRegistry } from '../lib/shortcut-registry';

export function Footer() {
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const { show } = useShortcutRegistry();
  return (
    <footer className="footer">
      <p className="footer-fineprint">
        Card data from{' '}
        <a href="https://scryfall.com" target="_blank" rel="noopener noreferrer">
          Scryfall
        </a>
        {isAdmin && (
          <>
            {'. '}
            <Link to="/admin">Debug</Link>
          </>
        )}
      </p>
      {/* Desktop / fine-pointer only: no hardware keyboard on coarse-pointer devices */}
      <button
        type="button"
        className="footer-shortcuts-chip"
        onClick={show}
        aria-label="Show keyboard shortcuts"
      >
        <kbd className="footer-shortcuts-kbd">?</kbd>
        <span className="footer-shortcuts-label">Keyboard shortcuts</span>
      </button>
    </footer>
  );
}
