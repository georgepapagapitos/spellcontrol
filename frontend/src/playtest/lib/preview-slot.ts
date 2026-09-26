/**
 * Where the card preview (`CardHoverPreview`) goes. Pure geometry, kept out of
 * the component so it can be tested with plain boxes.
 */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SlotInput {
  vw: number;
  vh: number;
  /** One face, or two side by side plus the gap. */
  paneWidth: number;
  height: number;
  /** The card being previewed: the pane never covers it. */
  card: Box;
  /** The corner clusters (life panel, menu and turn stack). */
  corners: Box[];
  /** Tabs standing along a side edge (the zones tab). */
  edges: Box[];
  /** What runs along the bottom: the pile row, the hand fan. */
  floor: Box[];
  /** A phone held upright (UPRIGHT_PHONE_QUERY). */
  upright?: boolean;
}

export interface Slot {
  left: number;
  top: number;
  /** 1, or less where the only free room is shorter than the pane. */
  scale: number;
}

export const MARGIN = 12;
/** Past this the face stops being worth reading; overlap rather than shrink
 *  further. */
const MIN_SCALE = 0.7;

const hits = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const box = (left: number, top: number, w: number, h: number): Box => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

/**
 * The desk slot: vertically centred at the table's right edge, flipped to the
 * left edge only when the card itself sits under it, and started below any
 * corner cluster it would cover (EDHPlay's; the eye always knows where to
 * look). That is where the pane goes whenever it clears the table's chrome.
 *
 * A phone on its side has no such room: centred at the right edge, the pane
 * sat over the TURN chip, the zones tab and the Hand/Library row. Then it
 * goes to the top of the table instead, just left of the right-hand corner
 * column, shrinking only as far as the room above the pile row and the hand
 * requires.
 *
 * Upright, neither fits: the right edge is the zones tab, and the top is
 * the life panel. What an upright phone has is a tall, empty felt between
 * the corners and the pile row, so the pane goes in the middle of that,
 * as big as it allows.
 */
export function previewSlot(s: SlotInput): Slot {
  if (s.upright) return uprightSlot(s);
  const desk = deskSlot(s);
  const deskPane = box(desk.left, desk.top, s.paneWidth, s.height);
  if (![...s.corners, ...s.edges, ...s.floor].some((o) => hits(deskPane, o))) return desk;

  // Left of the corner cluster and any edge tab on the right-hand side.
  const wall = Math.min(
    s.vw - MARGIN,
    ...[...s.corners, ...s.edges].filter((o) => o.left > s.vw / 2).map((o) => o.left)
  );
  // Down to the first thing along the bottom under that column.
  const column = box(wall - MARGIN - s.paneWidth, 0, s.paneWidth, s.vh);
  const floor = Math.min(s.vh, ...s.floor.filter((o) => hits(o, column)).map((o) => o.top));
  const room = floor - 2 * MARGIN;
  const scale = room < s.height ? Math.max(MIN_SCALE, room / s.height) : 1;
  const left = wall - MARGIN - s.paneWidth * scale;
  const top = MARGIN;
  if (hits(box(left, top, s.paneWidth * scale, s.height * scale), s.card)) return desk;
  return { left, top, scale };
}

/** Centred in the felt the chrome leaves: below the corner clusters, above
 *  the floor, left of an edge tab. Shrinks to fit that room, with no floor
 *  on the scale: a two-faced card is two faces across a 390px screen. */
function uprightSlot(s: SlotInput): Slot {
  let ceiling = Math.max(0, ...s.corners.map((c) => c.bottom)) + MARGIN;
  let floor = Math.min(s.vh, ...s.floor.map((o) => o.top)) - MARGIN;
  // A card out on the felt (a pointer resting on a permanent) splits it in
  // two; the pane takes the taller side.
  if (s.card.bottom > ceiling && s.card.top < floor) {
    if (s.card.top - ceiling >= floor - s.card.bottom) floor = s.card.top - MARGIN;
    else ceiling = s.card.bottom + MARGIN;
  }
  const wall = Math.min(s.vw, ...s.edges.map((e) => e.left)) - MARGIN;
  const scale = Math.min(1, (wall - MARGIN) / s.paneWidth, (floor - ceiling) / s.height);
  return {
    left: (MARGIN + wall - s.paneWidth * scale) / 2,
    top: (ceiling + floor - s.height * scale) / 2,
    scale,
  };
}

function deskSlot(s: SlotInput): Slot {
  const rightSlot = s.vw - MARGIN * 2 - s.paneWidth;
  const r = s.card;
  const centred = Math.max(MARGIN, (s.vh - s.height) / 2);
  const underRightSlot =
    r.right > rightSlot - MARGIN &&
    r.top < centred + s.height + MARGIN &&
    r.bottom > centred - MARGIN;
  const left = underRightSlot ? MARGIN * 2 : rightSlot;
  let top = centred;
  for (const c of s.corners) {
    if (c.right > left && c.left < left + s.paneWidth && c.bottom + MARGIN > top) {
      top = c.bottom + MARGIN;
    }
  }
  top = Math.min(top, Math.max(MARGIN, s.vh - s.height - MARGIN));
  return { left, top, scale: 1 };
}
