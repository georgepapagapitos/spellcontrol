import { useRef, useState, type KeyboardEvent } from 'react';
import type { CardSearchResultsHandle } from '@/components/CardSearchResults';
import type { ScryfallCard } from '@/deck-builder/types';

interface UseResultsKeysOptions {
  /**
   * A lookup page (`/search`) isn't an add flow — the first thing a user
   * does after typing is often Enter out of habit, and `CardSearchResults`
   * starts active on row 0, so that Enter would silently add the top hit.
   * With this on, Enter passes through untouched until the user has
   * pressed ↑/↓ at least once since the results last changed. Off
   * (default) for hosts whose whole point IS adding — the Add cards
   * workbench, the list-add sheets — where a type-then-Enter quick add is
   * the intended flow.
   */
  enterNeedsNav?: boolean;
  /**
   * Clears the "has the user pressed an arrow yet" flag whenever this value
   * changes. Pass the host's own query string (or anything else that
   * changes when the result set does) — required when `enterNeedsNav` is
   * on, ignored otherwise.
   */
  resetKey?: unknown;
}

/**
 * ↑/↓ moves the active {@link CardSearchResults} row, Enter adds it — the
 * pattern `AddCardSearchPanel` established for its own input, shared here by
 * every host that owns a query input elsewhere in the tree and drives
 * `CardSearchResults` (directly, or through `InlineCardSearch`'s forwarded
 * ref) instead of rendering one itself.
 *
 * Wire `onKeyDown` to the input, `resultsRef` to the results component's
 * `ref`, and `onActiveChange` to its `onActiveChange` prop (chain it with
 * the host's own, if it has one). Composing IME input passes straight
 * through, and so does every key once there's no active row to act on — an
 * empty result set or a query too short to search yet — so Enter with no
 * active row keeps whatever the host's input already does with it.
 */
export function useResultsKeys(opts: UseResultsKeysOptions = {}) {
  const { enterNeedsNav = false, resetKey } = opts;
  const resultsRef = useRef<CardSearchResultsHandle>(null);
  const [hasActive, setHasActive] = useState(false);
  const [navigated, setNavigated] = useState(false);

  // Adjusted during render, not in an effect (React's "resetting state when a
  // prop changes") — a new result set clears the "has the user pressed an
  // arrow yet" flag the instant it arrives, not a render late. State, not a
  // ref: refs aren't readable during render.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    if (navigated) setNavigated(false);
  }

  const onActiveChange = (active: ScryfallCard | null) => setHasActive(active !== null);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || !hasActive) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // With Enter gated, nothing is selected yet, so the first arrow selects
      // the row already underneath (the top hit) instead of skipping past it.
      const step = enterNeedsNav && !navigated ? 0 : e.key === 'ArrowDown' ? 1 : -1;
      setNavigated(true);
      resultsRef.current?.moveActive(step);
    } else if (e.key === 'Enter') {
      if (enterNeedsNav && !navigated) return;
      e.preventDefault();
      resultsRef.current?.addActive();
    }
  };

  return { resultsRef, onActiveChange, onKeyDown };
}
