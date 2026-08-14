import type { BattlefieldCard, ManaColor, PlaytestCard, PlaytestState } from './types';
import type { GameLogEntry, LogEntryKind } from './game-log';

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

/** One public-safe game-log line, ready to project to the table — see
 *  `toPublicTicker`. `seq` is the source `GameLogEntry.seq`: per-seat
 *  monotonic, which is what lets receivers diff re-delivered tickers (every
 *  board re-publish and long-poll snapshot carries the whole window). */
export interface TickerEntry {
  seq: number;
  kind: LogEntryKind;
  text: string;
  cardName?: string;
}

/** How many trailing public log lines a published board carries. Enough for
 *  a late joiner to get real backstory; small enough to be payload noise
 *  next to the battlefield itself. */
export const TICKER_LIMIT = 25;

/** Log kinds whose `text` is public by construction — no hand/library
 *  contents, no card identity an opponent hasn't already seen. Everything
 *  else (`life`/`counter`/`mana` reference solo-mode virtual opponents or
 *  duplicate state the board already carries live; `resistance` is
 *  solo-only) stays local. `zone-move` is conditionally public — see
 *  `toPublicTicker`. */
const TICKER_KINDS: ReadonlySet<LogEntryKind> = new Set([
  'turn',
  'draw',
  'play',
  'zone-move',
  'mulligan',
  'shuffle',
  'scry',
  'mill',
  'token',
  'tap-all',
  'attach',
  'phase',
  'designation',
  'undo',
  'reset',
]);

/**
 * Filter a seat's game log down to the lines its opponents are allowed to
 * read — the play-ticker half of this module's projection contract.
 *
 * The one non-obvious case: a `zone-move` whose card never touched a public
 * zone. `library → hand` is a tutor and `hand → library` is a bottoming —
 * in both, the card's name is hidden information even though the *move*
 * itself is table-visible, and the entry `text` bakes the name in. Rather
 * than rewrite prose, those lines are dropped entirely (the board's
 * `handCount`/`libraryCount` still move, and a tutor's shuffle line still
 * shows). Every other endpoint pair passes: touching battlefield /
 * graveyard / exile / command reveals the card on arrival, and a card
 * *leaving* one was already public. Entries persisted before `from`/`to`
 * existed can't prove any of that, so they drop too.
 */
export function toPublicTicker(log: readonly GameLogEntry[]): TickerEntry[] {
  const out: TickerEntry[] = [];
  for (const e of log) {
    if (!TICKER_KINDS.has(e.kind)) continue;
    if (e.kind === 'zone-move') {
      if (!e.from || !e.to) continue;
      const hiddenFrom = e.from === 'hand' || e.from === 'library';
      const hiddenTo = e.to === 'hand' || e.to === 'library';
      if (hiddenFrom && hiddenTo) continue;
    }
    out.push({
      seq: e.seq,
      kind: e.kind,
      text: e.text,
      ...(e.cardName !== undefined && { cardName: e.cardName }),
    });
  }
  return out.slice(-TICKER_LIMIT);
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
  /** Trailing public log lines (see `toPublicTicker`) — the play ticker.
   *  Optional: boards published by clients predating the ticker arrive
   *  without it, and `toPublicBoard` itself doesn't attach one (the log
   *  lives at the store layer, not in `PlaytestState` — the publisher
   *  spreads it in; see use-online-table.ts). */
  ticker?: TickerEntry[];
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
 *  face a DFC is showing is public information, only `faceDown` hides it.
 *
 *  ⚠️ INVARIANT this redaction rests on: `PlaytestCard.id` must be OPAQUE. It
 *  is the one field a redacted card still carries (it has to — it's the render
 *  key). Deck cards satisfy this: `deck-to-playtest.ts`'s `instanceId` builds
 *  `${slotId}#${copy}` from `genId('slot')`, which is random.
 *
 *  Commanders are the exception and DO leak — they're built as
 *  `cmd-${commander.id}`, embedding the Scryfall card id. This engine enforces
 *  no rules, so any permanent can be turned face-down, and a face-down
 *  commander projects an id an opponent can resolve straight back to the card.
 *  Impact is small today (a commander's identity is public information in the
 *  format), so this leaks only *which* face-down permanent is the commander,
 *  not an unknown card. Left as-is rather than fixed because changing that id
 *  format would rekey `commanderTax` and break resume for saved sessions.
 *
 *  If any other instance id ever becomes identity-derived, this redaction
 *  silently stops working. Keep ids opaque. */
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
