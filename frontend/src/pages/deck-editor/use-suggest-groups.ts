import { useMemo } from 'react';
import { planSuggestedGroups } from '@/components/deck/suggested-groups';
import { useDecksStore, type Deck } from '@/store/decks';
import { useDeckHistoryStore } from '@/store/deck-history';
import { useToastsStore } from '@/store/toasts';

/**
 * The Edit menu's "Suggest groups": the prop DeckDisplay takes, or undefined
 * while it would file nothing. One write inside one undo entry; a failed write
 * toasts instead of reporting success.
 */
export function useSuggestGroups(deck: Deck | undefined, taggerReady: boolean) {
  const file = useDecksStore((s) => s.fileSuggestedStacks);
  const record = useDeckHistoryStore((s) => s.record);
  const undo = useDeckHistoryStore((s) => s.undo);
  const push = useToastsStore((s) => s.push);
  const plan = useMemo(
    () => (deck ? planSuggestedGroups(deck.cards, taggerReady) : null),
    [deck, taggerReady]
  );
  if (!deck || !plan || (plan.assignments.length === 0 && !plan.pending)) return undefined;
  const run = () => {
    const { assignments } = plan;
    if (assignments.length === 0) return;
    try {
      record(deck.id, 'suggest groups', () => file(deck.id, assignments));
    } catch {
      push({ message: "Couldn't file those cards into groups.", tone: 'error' });
      return;
    }
    push({
      message: `Filed ${assignments.length} ${assignments.length === 1 ? 'card' : 'cards'} into groups`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undo(deck.id),
    });
  };
  return { pending: plan.pending, run };
}
