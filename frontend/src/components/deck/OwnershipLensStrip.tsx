import { Link } from 'react-router-dom';
import { useSignInPath } from '@/lib/account/sign-in-path';
import { ChevronRight } from 'lucide-react';
import './OwnershipLensStrip.css';

/**
 * The ownership lens's sign-in hook for a guest on a public deck
 * (w1-ownership-lens). A signed-in viewer gets the lens inside the deck view
 * itself: their owned cards read as covered in the list and the preview, and
 * the stat strip's "missing" stat opens the lens sheet. A full-width row
 * restating a percentage above the deck told them nothing the list did not.
 */
export function OwnershipLensStrip() {
  const signInHref = useSignInPath();
  return (
    <Link to={signInHref} className="ownership-lens-strip">
      <span className="ownership-lens-strip-label">Sign in to see what you own from this deck</span>
      <ChevronRight className="ownership-lens-strip-chevron" aria-hidden width={16} height={16} />
    </Link>
  );
}
