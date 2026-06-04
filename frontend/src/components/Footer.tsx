/**
 * Attribution footer. Scryfall asks API consumers to display a notice that card data
 * comes from them; this is the cheapest way to honor that.
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';

export function Footer() {
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
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
    </footer>
  );
}
