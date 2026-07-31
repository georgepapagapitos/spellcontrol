/**
 * Shapes returned by the backend `/api/combos/*` endpoints. Mirrors the types
 * in backend/src/combos/match.ts; kept duplicated rather than shared so the
 * frontend can render combos without compiling backend code.
 */

export interface ComboCardRef {
  oracleId: string;
  cardName: string;
  /** Number of copies of this card the combo needs (defaults to 1). */
  quantity: number;
}

export interface ComboPrerequisites {
  easy?: string;
  notable?: string;
}

export interface ComboSummary {
  id: string;
  identity: string;
  produces: string[];
  /** Split prereqs from Spellbook (`easyPrerequisites`, `notablePrerequisites`). */
  prerequisites: ComboPrerequisites | null;
  /** Newline-separated combo steps. Render as a numbered list. */
  description: string | null;
  /** Mana cost required to fire the combo (e.g. "{U}{B}{2}"). */
  manaNeeded: string | null;
  /** EDHREC deck count from Spellbook. */
  popularity: number;
  cardCount: number;
  bracket: number | null;
  bracketTag?: string | null;
  cards: ComboCardRef[];
}

export interface ComboMatch {
  combo: ComboSummary;
  presentOracleIds: string[];
  missingOracleIds: string[];
}

export interface ComboMatchResponse {
  inDeck: ComboMatch[];
  oneAway: ComboMatch[];
  almostInCollection: ComboMatch[];
  /**
   * Which matcher produced this result. `'local'` ran against the full
   * device-cached dataset (the ground truth). `'server'` means the client-side
   * cache couldn't be used, so this went through `/api/combos/match` instead —
   * which caps candidates at 2000 for memory safety and can under-report a
   * large collection's combos. Surfaces so a truncated answer isn't presented
   * as final (E212).
   */
  source: 'local' | 'server';
  /** True count before the backend's ALMOST_LIMIT truncation. */
  almostInCollectionTotal: number;
}

/**
 * Router-state payload carried from a combo seed (ComboCollectionAside's
 * "build around this" click) through deck generation to the post-build
 * summary. Never persisted on the deck itself — same one-shot lifecycle as
 * `justGenerated` (see DeckEditorPage), since it describes build *intent*,
 * not a property of the saved deck.
 */
export interface ComboSeedContext {
  /** The combo's pieces — same set the generator received as mustIncludeCards. */
  pieceNames: string[];
  /** What the combo does (combo.produces), for display. */
  produces: string[];
}

export interface ComboDetail {
  id: string;
  identity: string;
  produces: string[];
  prerequisites: string | null;
  description: string | null;
  manaNeeded: string | null;
  popularity: number;
  legalities: Record<string, string>;
  cardCount: number;
  bracket: number | null;
  bracketTag?: string | null;
  cards: Array<ComboCardRef & { position: number }>;
}
