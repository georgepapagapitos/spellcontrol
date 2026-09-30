/**
 * Attribution footer. Scryfall asks API consumers to display a notice that card data
 * comes from them; this is the cheapest way to honor that.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { useShortcutRegistry } from './shortcut-registry';
import { track } from '@/lib/util/analytics';
import { DISCORD_INVITE_URL } from '@/lib/util/community';
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
        {/* The community server lives here, with the other site links, not as
            a banner on a page: it's for people looking for it. */}
        <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
          Discord
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
