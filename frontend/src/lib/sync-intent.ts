/**
 * Tiny shared flag between store mutators and the sync layer.
 *
 * Destructive mutators (clearCards, deleteBinder, etc) call markDestructive()
 * right before/after their set(). The sync subscriber consumes the flag on
 * the next change and skips its debounce, pushing immediately so a fast
 * reload can't lose the deletion to a still-pending debounce timer.
 */

let immediateFlush = false;

export function markDestructive(): void {
  immediateFlush = true;
}

export function consumeImmediateFlush(): boolean {
  const v = immediateFlush;
  immediateFlush = false;
  return v;
}
