// Pure half of the popup placement check (journey-popups.mjs): the rule that
// says whether an opened popup panel sits where its trigger is. No browser
// import, so frontend/src/test/popup-placement-journey.test.ts can load it.
//
// Born from the Build health ⓘ on the deck stats card, which opened its tooltip
// at the far left of the screen: InfoTip read only `placement.left` and the
// placement had flipped to `right`. Nothing measured a panel against its
// trigger, so no check could see it.

/** Slack for sub-pixel rounding and a primitive's own gap (they use 4 to 8). */
export const TOL = 3;
/** The widest trigger-to-panel gap any primitive uses, plus a few px. */
export const MAX_GAP = 14;
/** A panel clamped to a viewport edge sits within this of it (EDGE_PAD is 8). */
export const EDGE = 24;

const R = (x) => Math.round(x);

/**
 * @param {{left:number,top:number,right:number,bottom:number}} t trigger rect
 * @param {{left:number,top:number,right:number,bottom:number}} p panel rect
 * @param {{width:number,height:number}} vp viewport
 * @returns {string|null} why the placement is wrong, with measured offsets, or null
 */
export function judgePlacement(t, p, vp) {
  const pw = p.right - p.left;
  const ph = p.bottom - p.top;
  const problems = [];

  // 1. On screen. A panel taller than the viewport scrolls inside itself, so
  // only its top edge is judged then.
  const off = {
    left: Math.max(0, -p.left),
    right: Math.max(0, p.right - vp.width),
    top: Math.max(0, -p.top),
    bottom: ph > vp.height ? 0 : Math.max(0, p.bottom - vp.height),
  };
  const offStr = Object.entries(off)
    .filter(([, v]) => v > TOL)
    .map(([k, v]) => `${k} ${R(v)}px`)
    .join(', ');
  if (offStr) problems.push(`off-screen (${offStr})`);

  // 2. Horizontal: overlap or touch the trigger's column, or be clamped against
  // a viewport edge the trigger is near (a trigger at x=2 and a panel whose
  // left edge is held at 8 is fine; a trigger at x=1300 and a panel at 8 is not).
  const overlapsColumn = p.left <= t.right + TOL && p.right >= t.left - TOL;
  const leftClamped = p.left <= EDGE && t.left <= pw + EDGE;
  const rightClamped = vp.width - p.right <= EDGE && vp.width - t.right <= pw + EDGE;
  const sideBeside = // a flyout to the side of its trigger, on the trigger's row
    p.top < t.bottom + TOL &&
    p.bottom > t.top - TOL &&
    (Math.abs(p.left - t.right) <= MAX_GAP || Math.abs(t.left - p.right) <= MAX_GAP);
  if (!overlapsColumn && !leftClamped && !rightClamped && !sideBeside) {
    const dx = p.left > t.right ? p.left - t.right : t.left - p.right;
    problems.push(
      `not beside its trigger horizontally (panel x ${R(p.left)}..${R(p.right)}, trigger x ${R(t.left)}..${R(t.right)}, ${R(dx)}px apart)`
    );
  }

  // 3. Vertical: just below or just above (a flyout beside the trigger is
  // judged above). A panel that covers its trigger is wrong even when neither
  // side has room for it whole: the placement hands back a `maxHeight` for that
  // case, so the panel scrolls inside the room it has instead of being clamped
  // over the control that opened it.
  if (!sideBeside) {
    const below = p.top - t.bottom; // gap when the panel is under the trigger
    const above = t.top - p.bottom; // gap when it is over
    const okBelow = below >= -TOL && below <= MAX_GAP;
    const okAbove = above >= -TOL && above <= MAX_GAP;
    if (!okBelow && !okAbove) {
      const covers = p.top < t.bottom - TOL && p.bottom > t.top + TOL;
      problems.push(
        `not adjacent vertically (panel y ${R(p.top)}..${R(p.bottom)}, trigger y ${R(t.top)}..${R(t.bottom)}, gap below ${R(below)}px / above ${R(above)}px${covers ? ', covers the trigger' : ''})`
      );
    }
  }

  return problems.length ? problems.join('; ') : null;
}

/**
 * Which triggers of one kind a run opens. A screen with more than `cap` of a kind
 * opens a different window of `cap` each night, so every trigger is opened over
 * ceil(count / cap) nights instead of the first `cap` forever (E1108).
 * @param {number} count triggers of this kind on the screen, in DOM order
 * @param {number} cap triggers opened per kind per run
 * @param {number} rotation the run's rotation (the nightly passes the day number)
 * @returns {number[]} indices into the kind's DOM order
 */
export function pickWindow(count, cap, rotation) {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i);
  const windows = Math.ceil(count / cap);
  const start = (((rotation % windows) + windows) % windows) * cap;
  return Array.from({ length: Math.min(cap, count - start) }, (_, i) => start + i);
}
