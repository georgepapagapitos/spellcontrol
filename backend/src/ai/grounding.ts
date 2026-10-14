/**
 * The grounding checks' verdict on one fresh reading, stored on its
 * `ai_reviews` row. The checks used to end in a `logger.warn` only, which Fly
 * keeps for days, so a bad reading couldn't be found after the fact or counted
 * per prompt version. Same names the warnings carry; an empty list is a pass.
 */
export interface Grounding {
  /** Real cards the prose names that are neither in the deck nor looked up. */
  unverified: string[];
  /** Refine only: tweak adds the model never looked up (recalled, not read). */
  recalled?: string[];
  /** Refine only: tweak names the parser refused (illegal, off-identity, missing). */
  rejected?: string[];
  /** Refine only: engine pieces the model tried to cut. */
  protectedCuts?: string[];
  truncated?: true;
}
