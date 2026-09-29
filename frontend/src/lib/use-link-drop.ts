import { useEffect, useEffectEvent, useState } from 'react';

/**
 * Does a drag carry a link? Dragging a card image or link off another site
 * (scryfall.com) always brings `text/uri-list` and/or `text/html`. During
 * dragover only the types can be read, never the data, so any link counts
 * here; the drop itself decides whether it was a card.
 *
 * A plain file dragged from the desktop brings only `Files`, which stays the
 * import dialog's business. Some browsers add `Files` to an image dragged from
 * a web page too, so `Files` alone is what rules a drag out, not its presence.
 */
export function hasLinkPayload(types: readonly string[]): boolean {
  return types.includes('text/uri-list') || types.includes('text/html');
}

/** Every text flavour the drop carried, joined, for a link parser to scan. */
export function readLinkPayload(data: DataTransfer): string {
  return ['text/uri-list', 'text/html', 'text/plain']
    .map((type) => data.getData(type))
    .filter(Boolean)
    .join('\n');
}

// dragover keeps firing while a drag is over the page, even when the pointer
// is still: the HTML spec's drag loop runs at least every 350ms (±200ms), and
// browsers are faster. Silence past the slowest allowed beat means the drag is
// gone without the browser saying so (a dragleave lost to a removed element).
export const DRAGOVER_SILENCE_MS = 1000;

/**
 * Window-wide drop target for links dragged in from outside the page. Returns
 * whether such a drag is over the window right now, for a drop overlay, and
 * calls `onDrop` with the dropped text.
 *
 * - Drags that start inside the document (the app's own images and links) are
 *   ignored from `dragstart` to `dragend`.
 * - Enter/leave is a depth count, so crossing child elements doesn't flicker.
 *   Drop, `dragend`, Escape, a pointer move with no button held, and a
 *   silent dragover watchdog all clear it, so the overlay can't stick.
 * - A drop some other target on the page already handled (`defaultPrevented`,
 *   an import dialog's file drop) is left alone.
 */
export function useLinkDrop(
  onDrop: (text: string) => void,
  options: { disabled?: boolean } = {}
): boolean {
  const { disabled = false } = options;
  const [dragging, setDragging] = useState(false);
  const handleDrop = useEffectEvent(onDrop);

  useEffect(() => {
    if (disabled) return;
    let depth = 0;
    let internal = false;
    let silence: number | undefined;

    const clear = () => {
      depth = 0;
      window.clearTimeout(silence);
      setDragging(false);
    };
    const isExternalLink = (e: DragEvent) =>
      !internal && !!e.dataTransfer && hasLinkPayload(Array.from(e.dataTransfer.types));

    const onDragStart = () => {
      internal = true;
    };
    const onDragEnd = () => {
      internal = false;
      clear();
    };
    const onDragEnter = (e: DragEvent) => {
      if (!isExternalLink(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isExternalLink(e)) return;
      // Without this the browser refuses the drop (and navigates to the link).
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      window.clearTimeout(silence);
      silence = window.setTimeout(clear, DRAGOVER_SILENCE_MS);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isExternalLink(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) clear();
    };
    const onWindowDrop = (e: DragEvent) => {
      if (!isExternalLink(e)) return;
      clear();
      if (e.defaultPrevented) return;
      e.preventDefault();
      handleDrop(readLinkPayload(e.dataTransfer!));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && depth > 0) clear();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons === 0 && depth > 0) clear();
    };

    const listeners: Array<[string, EventListener]> = [
      ['dragstart', onDragStart],
      ['dragend', onDragEnd],
      ['dragenter', onDragEnter as EventListener],
      ['dragover', onDragOver as EventListener],
      ['dragleave', onDragLeave as EventListener],
      ['drop', onWindowDrop as EventListener],
      ['keydown', onKeyDown as EventListener],
      ['pointermove', onPointerMove as EventListener],
    ];
    for (const [type, fn] of listeners) window.addEventListener(type, fn);
    return () => {
      window.clearTimeout(silence);
      for (const [type, fn] of listeners) window.removeEventListener(type, fn);
      // Turning the target off mid-drag must not leave a stale `true` behind
      // for when it turns back on.
      setDragging(false);
    };
  }, [disabled]);

  return dragging && !disabled;
}
