import type { BattlefieldCard, ManaColor, PlaytestCard, PlaytestState } from './types';

/** A `PlaytestCard` stripped to what's safe to show an opponent: never an
 *  image URL (peers re-resolve art from `scryfallId` via the app's existing
 *  card-image path — shipping `imageUrl`/`backImageUrl` too would roughly
 *  quadruple the payload for no gain). Everything else on `PlaytestCard` is
 *  printed-card metadata, not hidden information, so it passes through. */
export interface ProjectedCard {
  id: string;
  name?: string;
  oracleId?: string;
  scryfallId?: string;
  manaValue?: number;
  typeLine?: string;
  isToken?: boolean;
}

/** A battlefield permanent as an opponent would see it. `card` is redacted to
 *  just `{ id }` when `faceDown` is true — see `toPublicBoard`. */
export interface PublicBattlefieldCard {
  card: ProjectedCard;
  tapped: boolean;
  counters: Record<string, number>;
  stickers: string[];
  x: number;
  y: number;
  faceDown: boolean;
  showBackFace?: boolean;
  attachedTo?: string;
  phased?: boolean;
}

/** One player's board as their opponents are allowed to see it: the public
 *  zones (battlefield, graveyard, exile, command) in full, plus counts —
 *  never contents — for the two zones MTG keeps private (library, hand). */
export interface PublicBoard {
  seat: number;
  turn: number;
  life: number;
  playerCounters?: Record<string, number>;
  manaPool?: Record<ManaColor, number>;
  commanderTax: Record<string, number>;
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  battlefield: PublicBattlefieldCard[];
  graveyard: ProjectedCard[];
  exile: ProjectedCard[];
  command: ProjectedCard[];
  handCount: number;
  libraryCount: number;
}

/** Slim a `PlaytestCard` down to its projected shape — the one place that
 *  drops image fields, so every zone that projects cards (battlefield,
 *  graveyard, exile, command) does it the same way. */
export function toProjectedCard(card: PlaytestCard): ProjectedCard {
  const { id, name, oracleId, scryfallId, manaValue, typeLine, isToken } = card;
  return { id, name, oracleId, scryfallId, manaValue, typeLine, isToken };
}

/** Face-down (morph/manifest) is the subtle case: the permanent sits in the
 *  battlefield zone, which is otherwise fully public, so a naive projection
 *  leaks its identity. Keep the public facts about the *object* — position,
 *  tapped, counters, stickers, the face-down flag itself, its attachment,
 *  whether it's phased — but reduce `card` to just its instance id. A
 *  face-up transformed card (`showBackFace: true`) is not redacted: which
 *  face a DFC is showing is public information, only `faceDown` hides it. */
function toPublicBattlefieldCard(bf: BattlefieldCard): PublicBattlefieldCard {
  return {
    card: bf.faceDown ? { id: bf.card.id } : toProjectedCard(bf.card),
    tapped: bf.tapped,
    counters: bf.counters,
    stickers: bf.stickers,
    x: bf.x,
    y: bf.y,
    faceDown: bf.faceDown,
    showBackFace: bf.showBackFace,
    attachedTo: bf.attachedTo,
    phased: bf.phased,
  };
}

/** Project `state` into what seat `seat`'s opponents are allowed to see.
 *  Pure — no `past` (the undo stack is local bookkeeping, never shared), no
 *  `opponents`/`tableDefeatedTurn`/`startingOpponentLife` (solo-play's
 *  virtual-opponent bookkeeping; at a real multiplayer table those are other
 *  seats' own state, not this seat's to project), library/hand collapsed to
 *  counts, and face-down battlefield cards redacted — see
 *  `toPublicBattlefieldCard`. */
export function toPublicBoard(state: PlaytestState, seat: number): PublicBoard {
  return {
    seat,
    turn: state.turn,
    life: state.life,
    playerCounters: state.playerCounters,
    manaPool: state.manaPool,
    commanderTax: state.commanderTax,
    monarch: state.monarch,
    initiative: state.initiative,
    citysBlessing: state.citysBlessing,
    battlefield: state.battlefield.map(toPublicBattlefieldCard),
    graveyard: state.zones.graveyard.map(toProjectedCard),
    exile: state.zones.exile.map(toProjectedCard),
    command: state.zones.command.map(toProjectedCard),
    handCount: state.zones.hand.length,
    libraryCount: state.zones.library.length,
  };
}
