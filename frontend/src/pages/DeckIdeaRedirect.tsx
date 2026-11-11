import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * `/decks/new/generate/idea/:slug` was the idea's own page (E1112). An idea is now a filter on the
 * generator's one commander grid, so an old link opens the generator with it applied.
 */
export function DeckIdeaRedirect() {
  const { slug = '' } = useParams();
  const { search } = useLocation();
  const format = new URLSearchParams(search).get('format');
  const params = new URLSearchParams({ idea: slug });
  if (format) params.set('format', format);
  return <Navigate to={`/decks/new/generate?${params}`} replace />;
}
