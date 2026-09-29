/**
 * Remembered /home footprints — the per-browser shape of the last RESOLVED
 * render, so the next visit's skeletons reserve the same space (E277).
 *
 * Every hero line and bento card on /home resolves asynchronously (an IDB
 * hydrate, a value-history read, a friends fetch), and each one either fills
 * in, collapses to a 44px invitation row that `order`s to the bottom, or
 * disappears. Measured 2026-09-09 (cls-attrib.mjs, no synthetic scroll): a
 * returning signed-in visitor took CLS 0.43 on desktop / 0.21 on the phone,
 * all of it that reflow — the deck editor and binder shifts the earlier
 * probe reported were its own programmatic scroll. The board rarely changes
 * shape between two visits, so the honest reservation is "what it was last
 * time" (the same trade TrendingRail's `sc-trending-shape` makes); a first
 * visit still reflows once.
 *
 * Slot values: `0` = rendered empty/absent, `>0` = rendered present (a card
 * stores its height in px, a hero line stores 1). Unknown = no entry.
 */
const KEY = 'sc-home-shape';

export type HomeShape = Record<string, number>;

export function readHomeShape(): HomeShape {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as HomeShape) : {};
  } catch {
    return {};
  }
}

export function rememberHomeShape(slot: string, value: number): void {
  try {
    const shape = readHomeShape();
    if (shape[slot] === value) return;
    shape[slot] = value;
    localStorage.setItem(KEY, JSON.stringify(shape));
  } catch {
    // Private mode / quota: the next visit simply gets no reservation.
  }
}
