import { useEffect, useMemo, type JSX } from 'react';
import './SwapThisCard.css';
import { DeckCardRow } from './DeckCardRow';
import type { Change } from '@/lib/coach/deck-change';
import { recordShown, recordSuggestion } from '@/lib/util/suggestion-labels';
import { useDismissedSuggestions, withoutDismissed } from '@/lib/coach/dismissed-suggestions';
import { SuggestionSection, suggestionSummary, useRememberedOpen } from './SuggestionSection';

/** The open/closed choice, shared by every card's preview. */
export const SWAP_OPEN_KEY = 'sc-preview-swap-open';

export interface SwapThisCardProps {
  /** The in-deck card being looked at (the swap-out target). */
  currentName: string;
  /** Same-role replacement candidates, owned-first (normalized Changes). */
  alternatives: Change[];
  /** Swap the current card for the named alternative (cut + add). */
  onSwap: (name: string) => void;
  /** A swap is in flight — disables every row's action. */
  swapping?: boolean;
  /** Commander name, for the inclusion line wording. */
  commanderName?: string;
}

/**
 * The in-context "Swap this card" section, injected into the card-preview panel
 * for a card already in the deck. A complement to the Tune lanes (which answer
 * "what to change across the deck"): this answers "I'm looking at THIS card —
 * what replaces it", scoped to the card's role, owned-first. Rows go through the
 * shared <DeckCardRow> over the Change model, so this view and the lanes can
 * never disagree about a recommendation. Closed until asked for (see
 * <SuggestionSection>), so the card's own printings and rulings stay in reach.
 */
export function SwapThisCard({
  currentName,
  alternatives: all,
  onSwap,
  swapping,
  commanderName,
}: SwapThisCardProps): JSX.Element | null {
  const hidden = useDismissedSuggestions();
  const alternatives = useMemo(() => withoutDismissed(all, hidden.list), [all, hidden.list]);
  const count = alternatives.length;
  const [open, toggle] = useRememberedOpen(SWAP_OPEN_KEY);
  // "Shown" means the rows were on screen, so a closed section records nothing.
  useEffect(() => {
    if (open) recordShown('swap', count, currentName);
  }, [open, count, currentName]);
  if (count === 0) return null;

  return (
    <SuggestionSection
      className="swap-this-card"
      label={`Swap ${currentName}`}
      title="Swap this card"
      summary={suggestionSummary(
        count,
        ['option', 'options'],
        alternatives.map((c) => c.ownership)
      )}
      open={open}
      onToggle={toggle}
    >
      <p className="swap-this-card-sub">Same-role alternatives, owned first.</p>
      <ul className="swap-this-card-list">
        {alternatives.map((change, i) => (
          <DeckCardRow
            key={change.id}
            change={change}
            commanderName={commanderName}
            actLabel="Swap in"
            onAct={() => {
              recordSuggestion({
                surface: 'swap',
                action: 'accept',
                rank: i + 1,
                reason: change.lane,
                cardIn: change.name,
                cardOut: currentName,
              });
              onSwap(change.name);
            }}
            acting={swapping}
            onDismiss={
              hidden.canDismiss
                ? () =>
                    hidden.dismiss({
                      name: change.name,
                      surface: 'swap',
                      rank: i + 1,
                      reason: change.lane,
                      cardIn: change.name,
                      cardOut: currentName,
                    })
                : undefined
            }
          />
        ))}
      </ul>
    </SuggestionSection>
  );
}
