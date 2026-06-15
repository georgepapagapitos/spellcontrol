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
