import { useCollectionStore } from '@/store/collection';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/Button';

/**
 * A binder view with no cards to show. When the binder holds cards and the
 * search hides them all, that is the search's doing, not the rules': say so
 * and offer to clear it, rather than send the user to rules that are fine.
 */
export function BinderEmptyState({
  binderId,
  holdsCards,
}: {
  binderId: string;
  /** Whether the binder holds any card before the search narrows it. */
  holdsCards: boolean;
}) {
  const search = useCollectionStore((s) => s.search);
  const setSearch = useCollectionStore((s) => s.setSearch);
  const setEditingBinder = useCollectionStore((s) => s.setEditingBinder);
  if (holdsCards && search.trim()) {
    return (
      <EmptyState
        tagline="No cards match your search."
        actions={
          <Button variant="primary" onClick={() => setSearch('')}>
            Clear search
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      tagline="No cards match this binder's rules."
      hint="Loosen a rule to catch more cards."
      actions={
        <Button variant="primary" onClick={() => setEditingBinder(binderId)}>
          Binder rules
        </Button>
      }
    />
  );
}
