import { useRef, useState, type KeyboardEvent } from 'react';
import type { CardSearchResultsHandle } from '../components/CardSearchResults';
import type { ScryfallCard } from '@/deck-builder/types';

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
export function useResultsKeys() {
  const resultsRef = useRef<CardSearchResultsHandle>(null);
  const [hasActive, setHasActive] = useState(false);

  const onActiveChange = (active: ScryfallCard | null) => setHasActive(active !== null);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || !hasActive) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      resultsRef.current?.moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      resultsRef.current?.moveActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      resultsRef.current?.addActive();
    }
  };

  return { resultsRef, onActiveChange, onKeyDown };
}
