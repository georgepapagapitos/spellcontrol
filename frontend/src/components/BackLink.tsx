import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  to: string;
  label: string;
}

/**
 * Consistent "back to index" link rendered above a detail-page hero.
 * Used on /decks/:id, /decks/new, and /binders/:id so every detail
 * surface has the same exit gesture in the same place.
 */
export function BackLink({ to, label }: Props) {
  return (
    <Link to={to} className="back-link">
      <ArrowLeft width={14} height={14} strokeWidth={1.6} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
