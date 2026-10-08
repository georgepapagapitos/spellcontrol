import { fireEvent, screen } from '@testing-library/react';
import { useDecksStore } from '@/store/decks';
import { useToastsStore } from '@/store/toasts';
import { setSuggestionContext } from '@/lib/util/suggestion-labels';
import type { ScryfallCard } from '@/deck-builder/types';

export const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';

/** A real deck in the store, opened the way the editor opens it (label context + active deck). */
export function openDeck(): string {
  useDecksStore.setState({ decks: [] });
  useToastsStore.getState().clear();
  const commander = { name: "Atraxa, Praetors' Voice", oracle_id: ATRAXA } as ScryfallCard;
  const id = useDecksStore.getState().createDeck({
    name: 'Atraxa',
    format: 'commander',
    source: 'manual',
    commander,
  });
  setSuggestionContext({ id, commander, partnerCommander: null });
  return id;
}

export const hiddenOf = (deckId: string) =>
  useDecksStore.getState().decks.find((d) => d.id === deckId)?.dismissedSuggestions;

/** Opens a row's ⋮ and picks "Not for this deck", the way a player does. */
export function hideFromMenu(cardName: string): void {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${cardName}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Not for this deck' }));
}

/** Presses Undo on the toast the dismissal raised. */
export function pressUndo(): void {
  const toast = useToastsStore
    .getState()
    .toasts.filter((t) => t.actionLabel === 'Undo')
    .at(-1);
  if (!toast?.onAction) throw new Error('the dismissal raised no toast action');
  toast.onAction();
}
