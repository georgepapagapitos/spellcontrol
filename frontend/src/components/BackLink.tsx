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
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M10 3l-5 5 5 5" />
      </svg>
      <span>{label}</span>
    </Link>
  );
}
