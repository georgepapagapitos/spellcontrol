/**
 * Attribution footer. Scryfall asks API consumers to display a notice that card data
 * comes from them; this is the cheapest way to honor that.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useShortcutRegistry } from '../lib/shortcut-registry';
import { track } from '../lib/analytics';
import { Chip } from '@/components/shared/Chip';

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
        {'. '}
        <a href="/guides/" onClick={() => track('guide_cta')}>
          Help &amp; guides
        </a>
        {' · '}
        <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a>
        {isAdmin && (
          <>
            {' · '}
            <Link to="/admin">Admin</Link>
          </>
        )}
      </p>
      {/* Desktop / fine-pointer only: no hardware keyboard on coarse-pointer devices */}
      <Chip
        className="footer-shortcuts-chip"
        onClick={show}
        aria-label="Show keyboard shortcuts"
        trailing={<span className="footer-shortcuts-label">Keyboard shortcuts</span>}
      >
        <kbd className="footer-shortcuts-kbd">?</kbd>
      </Chip>
    </footer>
  );
}
