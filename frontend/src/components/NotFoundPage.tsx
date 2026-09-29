import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/Button';

/** An unmatched in-Layout route (typo, stale link, dead deep link) used to
 *  silently redirect to Home/Collection with zero feedback. Render an actual
 *  state instead, so a bad link reads as a bad link, not a random landing.
 *  Also rendered by a page whose own param names nothing (`/search/top/:list`
 *  with an unknown list), so every bad link reads the same. */
export function NotFoundPage({ homePath }: { homePath: string }) {
  const homeLabel = homePath === '/home' ? 'Home' : 'Collection';
  return (
    <EmptyState
      taglineAs="h1"
      tagline="Page not found."
      hint="That link is broken or the page has moved."
      actions={
        <Button variant="primary" to={homePath}>
          Go to {homeLabel}
        </Button>
      }
    />
  );
}
