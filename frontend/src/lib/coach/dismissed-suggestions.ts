import { useCallback, useMemo } from 'react';
import { useDecksStore } from '@/store/decks';
import { toast } from '@/store/toasts';
import { useActiveDeckId } from '@/lib/util/active-deck-id';
import { recordSuggestion, type SuggestionSurface } from '@/lib/util/suggestion-labels';

/**
 * Suggestions a player hid for one deck with "Not for this deck" (E580).
 *
 * The list lives on the deck (`Deck.dismissedSuggestions`), so it syncs and
 * survives a reload like any deck field. An entry names a card the player does
 * not want suggested INTO this deck, or (`cut`) a card they do not want
 * suggested OUT of it. The surface it was hidden from rides along so a restore
 * can label the undo on the surface that took the dismissal.
 */
export interface DismissedSuggestion {
  name: string;
  /** Hidden as a cut suggestion ("keep this card") rather than an add. */
  cut?: boolean;
  surface: SuggestionSurface;
}

const key = (name: string) => name.toLowerCase();
const same = (a: DismissedSuggestion, b: Pick<DismissedSuggestion, 'name' | 'cut'>) =>
  key(a.name) === key(b.name) && !!a.cut === !!b.cut;

/** Lowercased names hidden as adds (or swaps' incoming card), `cut: false`, or as cuts. */
export function dismissedNames(
  list: readonly DismissedSuggestion[] | undefined,
  cut = false
): Set<string> {
  return new Set((list ?? []).filter((d) => !!d.cut === cut).map((d) => key(d.name)));
}

/** Whether a Coach-style change is one the player hid: a cut by its card, anything else by the card coming in. */
export function isDismissedChange(
  list: readonly DismissedSuggestion[] | undefined,
  change: { name: string; type: string }
): boolean {
  return (list ?? []).some((d) => same(d, { name: change.name, cut: change.type === 'cut' }));
}

/** The changes the player has not hidden, with hidden substitutes dropped from the rows that carry them. */
export function withoutDismissed<C extends { name: string; type: string; alternatives?: C[] }>(
  changes: readonly C[],
  list: readonly DismissedSuggestion[] | undefined
): C[] {
  if (!list || list.length === 0) return [...changes];
  return changes
    .filter((c) => !isDismissedChange(list, c))
    .map((c) =>
      c.alternatives?.some((a) => isDismissedChange(list, a))
        ? { ...c, alternatives: c.alternatives.filter((a) => !isDismissedChange(list, a)) }
        : c
    );
}

export interface DismissRequest {
  name: string;
  cut?: boolean;
  surface: SuggestionSurface;
  rank?: number;
  reason?: string;
  /** For the label: the card coming in and the card going out. */
  cardIn?: string;
  cardOut?: string;
}

function label(r: DismissRequest, action: 'dismiss' | 'undo'): void {
  recordSuggestion({
    surface: r.surface,
    action,
    rank: r.rank,
    reason: r.reason,
    cardIn: r.cardIn,
    cardOut: r.cardOut,
  });
}

/** The label request for an entry restored from the hidden list (the original rank is gone). */
const requestFor = (e: DismissedSuggestion): DismissRequest => ({
  name: e.name,
  surface: e.surface,
  cardIn: e.cut ? undefined : e.name,
  cardOut: e.cut ? e.name : undefined,
});

const EMPTY: readonly DismissedSuggestion[] = [];

/**
 * The open deck's hidden suggestions, with the actions that change them. Reads
 * the deck the editor has open (see `active-deck-id.ts`), so a surface needs no
 * deck prop. Every change goes through `updateDeck(…, silent)`: hiding a
 * suggestion is not an edit to the deck, so it does not move `updatedAt`.
 */
export function useDismissedSuggestions() {
  const deckId = useActiveDeckId();
  const list =
    useDecksStore((s) => s.decks.find((d) => d.id === deckId)?.dismissedSuggestions) ?? EMPTY;

  const write = useCallback(
    (next: DismissedSuggestion[]) => {
      if (deckId) {
        useDecksStore
          .getState()
          .updateDeck(deckId, { dismissedSuggestions: next.length ? next : undefined }, true);
      }
    },
    [deckId]
  );
  const current = useCallback(
    () =>
      useDecksStore.getState().decks.find((d) => d.id === deckId)?.dismissedSuggestions ?? EMPTY,
    [deckId]
  );

  const restore = useCallback(
    (entry: DismissedSuggestion, request?: DismissRequest) => {
      if (!current().some((d) => same(d, entry))) return;
      write(current().filter((d) => !same(d, entry)));
      label(request ?? requestFor(entry), 'undo');
    },
    [current, write]
  );

  const dismiss = useCallback(
    (r: DismissRequest) => {
      if (!deckId) return;
      const entry: DismissedSuggestion = {
        name: r.name,
        cut: r.cut || undefined,
        surface: r.surface,
      };
      if (current().some((d) => same(d, entry))) return;
      write([...current(), entry]);
      label(r, 'dismiss');
      toast.show({
        message: `Hid ${r.name} from this deck's suggestions`,
        tone: 'success',
        actionLabel: 'Undo',
        onAction: () => restore(entry, r),
      });
    },
    [deckId, current, write, restore]
  );

  const restoreAll = useCallback(() => {
    const all = current();
    write([]);
    // Cap a bulk restore like a bulk cut: it is one decision.
    all.slice(0, 5).forEach((e) => label(requestFor(e), 'undo'));
  }, [current, write]);

  const inNames = useMemo(() => dismissedNames(list), [list]);
  return { list, inNames, dismiss, restore, restoreAll, canDismiss: deckId !== null };
}
