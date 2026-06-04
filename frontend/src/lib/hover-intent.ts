/**
 * Shared hover-intent policy for the desktop card-preview surfaces (the deck-list
 * hover-peek and the collection `CardSlot` tooltip). Centralizing the two knobs
 * here keeps the surfaces consistent — same dwell feel, same opt-out attribute —
 * and gives one tested place to tune them.
 */

/**
 * How long a fine pointer must dwell on a card before its preview is raised.
 * The point is intent: sweeping the cursor across a list toward a button (the
 * kebab, an Add/Cut action) should never flash a card in the way — only a
 * deliberate pause does. ~350ms reads as "I stopped to look" without feeling
 * laggy. Both surfaces share it so the apps never disagree on the cadence.
 */
export const HOVER_INTENT_DELAY_MS = 350;

/**
 * Grace period before a preview is torn down once the pointer leaves a card.
 * The symmetric other half of the show delay: a brief exit — clipping a corner,
 * crossing the gap between two adjacent rows, dipping out and back — shouldn't
 * thrash the preview. A re-entry within this window cancels the teardown, so the
 * card holds steady instead of flickering. Kept short (well under the show
 * delay) so a deliberate move away still feels immediate.
 */
export const HOVER_HIDE_DELAY_MS = 200;

/**
 * Opt-out marker: any element carrying this attribute (or nested under one) is an
 * action zone that must never raise a preview — and should dismiss one already
 * up. Put it on a card's kebab/action menu so hovering or aiming at the control
 * is never obscured by the floating card. Read via {@link isPeekSuppressed}.
 */
export const PEEK_SUPPRESS_ATTR = 'data-peek-suppress';
const PEEK_SUPPRESS_SELECTOR = `[${PEEK_SUPPRESS_ATTR}]`;

/**
 * True when an event target sits inside an opted-out action zone (see
 * {@link PEEK_SUPPRESS_ATTR}). Pure DOM read, so both the delegated deck-peek
 * handler and any per-element handler can gate on it identically.
 */
export function isPeekSuppressed(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PEEK_SUPPRESS_SELECTOR) !== null;
}
