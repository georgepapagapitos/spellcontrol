import { Button } from '@/components/shared/Button';
import { findIdea, type useIdeaIndex } from '@/lib/deck/idea-index';

/**
 * What the finder says when the deck ideas aren't there: the idea list failed to
 * load (with Retry), or a `?idea=` link (or an old idea-page bookmark) names an
 * idea that left the list. `slug` is the link's, while the player hasn't picked.
 */
export function IdeaIndexNotes({
  state,
  slug,
}: {
  state: ReturnType<typeof useIdeaIndex>;
  slug: string | null;
}) {
  if (state.status === 'error') {
    return (
      <p className="commander-finder-alert" role="alert">
        <span>Couldn&apos;t load the deck ideas. Commanders still work.</span>
        <Button variant="link" onClick={state.retry}>
          Retry
        </Button>
      </p>
    );
  }
  if (state.status === 'ready' && slug && !findIdea(state.index, slug)) {
    return (
      <p className="commander-finder-note" role="status">
        That deck idea isn&apos;t on the list any more. Showing every commander.
      </p>
    );
  }
  return null;
}
