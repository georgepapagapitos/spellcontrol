import { useEffect, useRef } from 'react';

/**
 * The instance id of the card the pointer is resting on, or that keyboard
 * focus is inside — the "card in view" every per-card shortcut acts on when
 * nothing is selected.
 *
 * Event-delegated off `document` on the `data-card-id` attribute
 * `PlaytestCardFace` sets, exactly like `CardHoverPreview` does for art, so
 * every card surface gets it with no per-card wiring and no re-render per
 * pointer move. That last part is why this returns a **ref** rather than
 * state: the value is read once, inside a keydown, and storing it in state
 * would re-render the whole board on every card the pointer crosses.
 *
 * Opponents' permanents publish a seat-scoped id (`OpponentQuadrant`), so a
 * card in somebody else's quadrant resolves to an id that is in none of your
 * own zones — the caller's lookup misses and the key falls through, which is
 * what should happen when you press H over a card that isn't yours.
 */
export function useHoverTarget(): React.RefObject<string | null> {
  const ref = useRef<string | null>(null);

  useEffect(() => {
    const SELECTOR = '[data-card-id]';
    const read = (target: EventTarget | null): string | null => {
      const el = (target as Element | null)?.closest?.(SELECTOR);
      return el?.getAttribute('data-card-id') ?? null;
    };
    const onOver = (e: Event) => {
      const id = read(e.target);
      if (id) ref.current = id;
    };
    const onOut = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (!el) return;
      // Moving between a card's own children is not leaving the card.
      const to = (e as PointerEvent).relatedTarget as Element | null;
      if (to && el.contains(to)) return;
      if (ref.current === el.getAttribute('data-card-id')) ref.current = null;
    };
    // Keyboard focus counts as resting on a card: tabbing to a permanent and
    // pressing G has to move that permanent, or the whole per-card half of
    // this map would be pointer-only.
    const onFocusIn = (e: Event) => {
      ref.current = read(e.target);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  return ref;
}
