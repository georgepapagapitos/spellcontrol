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
  /** Refine only: suggested or looked-up cards the STRATEGY prose names as if in the deck. */
  suggestedAsDeck?: string[];
  /**
   * Refine only (E1027): changes the "why" check dropped, with the claims that
   * failed, and the adds whose check errored or didn't parse (kept as written).
   */
  whyCheck?: {
    dropped: { add: string; why: string; failed: string[] }[];
    unchecked?: string[];
  };
  truncated?: true;
}

/**
 * The deck a reading was written for, stored on its `ai_reviews` row
 * (`deck_snapshot`). The row carries only a `deck_id`, and decks get deleted or
 * edited afterwards (a 2026-10-15 probe could grade 1 of 60 readings), so a
 * reading is only gradable if it keeps the list it read. Names and counts only,
 * never card objects, so rows stay small. NULL on rows predating the column.
 */
export interface DeckSnapshot {
  /** Command zone, one name or a partner pair. */
  commanders: string[];
  /** The main deck as the model was given it. */
  cards: { name: string; qty: number }[];
  /** Refine only: the candidate pool the model was offered, after any budget/owned trim. */
  pool?: string[];
}

export function deckSnapshot(req: {
  commander: string;
  partnerCommander?: string;
  cards: { name: string; qty: number }[];
  pool?: { name: string }[];
}): DeckSnapshot {
  return {
    commanders: req.partnerCommander ? [req.commander, req.partnerCommander] : [req.commander],
    cards: req.cards.map((c) => ({ name: c.name, qty: c.qty })),
    ...(req.pool ? { pool: req.pool.map((c) => c.name) } : {}),
  };
}
