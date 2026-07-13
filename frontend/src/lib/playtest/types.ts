/**
 * Solo playtest state machine.
 *
 * The reducer is intentionally decoupled from `ScryfallCard`/`DeckCard` — UI
 * layers convert their richer card shapes down to `PlaytestCard` (instance id +
 * minimal display fields) when initializing a session. Battlefield positions
 * are stored in unitless coordinates; the UI maps them to its own pixel space.
 */

export type Zone = 'library' | 'hand' | 'graveyard' | 'exile' | 'command';

export interface PlaytestCard {
  /** Unique per instance — two physical copies of the same Scryfall card get distinct ids. */
  id: string;
  name: string;
  oracleId?: string;
  scryfallId?: string;
  imageUrl?: string;
  /** Back-face art for a genuine two-faced card (transform/MDFC), resolved once
   *  at deck-to-playtest time. Presence of this field is also how the UI knows
   *  a card is real-DFC-eligible for the "Transform" context-menu action —
   *  tokens and single-faced cards never have one. */
  backImageUrl?: string;
  manaValue?: number;
  typeLine?: string;
  isToken?: boolean;
}

export interface BattlefieldCard {
  card: PlaytestCard;
  tapped: boolean;
  counters: Record<string, number>;
  /** Free-text labels stuck on the card (e.g. "flying", "6/6"). */
  stickers: string[];
  x: number;
  y: number;
  faceDown: boolean;
  /** Which face's art is showing for a two-faced card. Independent of
   *  `faceDown` — a transformed card can also be turned face-down. */
  showBackFace?: boolean;
}

export interface PlaytestState {
  zones: Record<Zone, PlaytestCard[]>;
  battlefield: BattlefieldCard[];
  rngSeed: number;
  turn: number;
  /** Casts-from-command count per commander card id (keyed by `PlaytestCard.id`).
   *  Display tax is `count * 2` (MTG rule 903.10); incremented only when a card
   *  moves command → battlefield, never decremented (undo restores it via the
   *  normal snapshot mechanism). */
  commanderTax: Record<string, number>;
  /** Snapshots of prior states (cap kept inside reducer). UNDO pops the head. */
  past: Omit<PlaytestState, 'past'>[];
}

export type PlaytestAction =
  | { type: 'DRAW'; n?: number }
  | { type: 'SHUFFLE_LIBRARY' }
  | { type: 'MULLIGAN'; handSize?: number }
  | { type: 'MOVE_TO_ZONE'; cardId: string; to: Zone; toIndex?: number }
  | {
      type: 'MOVE_TO_BATTLEFIELD';
      cardId: string;
      x: number;
      y: number;
      tapped?: boolean;
      faceDown?: boolean;
    }
  | { type: 'MOVE_BF_POSITION'; cardId: string; x: number; y: number }
  | { type: 'TAP'; cardId: string; tapped?: boolean }
  | { type: 'UNTAP_ALL' }
  | { type: 'SET_COUNTER'; cardId: string; counter: string; delta: number }
  | { type: 'ADD_STICKER'; cardId: string; text: string }
  | { type: 'REMOVE_STICKER'; cardId: string; index: number }
  | { type: 'CREATE_TOKEN'; card: PlaytestCard; x: number; y: number }
  | { type: 'FLIP_FACE'; cardId: string }
  | { type: 'TRANSFORM'; cardId: string }
  | {
      /** Cosmetic-only art arriving after the fact (async token-art
       *  resolution) — not a player action, so the reducer never pushes it
       *  onto the undo stack. */
      type: 'SET_CARD_IMAGE';
      cardId: string;
      imageUrl: string;
    }
  | { type: 'NEXT_TURN' }
  | { type: 'RESET' }
  | { type: 'UNDO' };

export interface PlaytestInit {
  library: PlaytestCard[];
  command?: PlaytestCard[];
  seed?: number;
  openingHandSize?: number;
}
