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
  // Permanents are public: a counter on one, or one turning face up/down
  // or transforming, is table-visible. (`counter` — PLAYER counters — stays
  // local; see game-log.ts.)
  'card-counter',
  'face',
  // The stack is in the middle of the table and a reveal IS the showing —
  // both are public the moment they happen.
  'stack',
  'reveal',
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
  /** Ids of this seat's own battlefield permanents currently marked as
   *  waiting to resolve, bottom first — the same ids that appear in
   *  `battlefield`, so a receiver looks the card up there rather than
   *  being sent a second copy of it. Public by construction: an object on
   *  the stack has been announced. Optional like `ticker` — boards
   *  published by clients predating the stack arrive without one. */
  stack?: string[];
  /** Cards this seat is currently showing the table out of its hand. The
   *  one thing that legitimately lets a hand card's identity out without a
   *  zone change — see `PlaytestState.revealed`. */
  revealed?: ProjectedCard[];
  /**
   * What this seat is currently showing of its library, top first — one
   * card while it is playing with the top revealed, the whole library while
   * it is revealing all of it, and absent (the normal case) while the
   * library is private. See `PlaytestState.libraryReveal`. Optional like
   * `ticker`: boards published by clients predating it arrive without one,
   * which reads as private — the safe default for a hidden zone.
   */
  revealedLibrary?: ProjectedCard[];
  /** Trailing public log lines (see `toPublicTicker`) — the play ticker.
   *  Optional: boards published by clients predating the ticker arrive
   *  without it, and `toPublicBoard` itself doesn't attach one (the log
   *  lives at the store layer, not in `PlaytestState` — the publisher
   *  spreads it in; see use-online-table.ts). */
  ticker?: TickerEntry[];
  /** True once this seat has kept its opening hand (its playtest phase left
   *  `opening` / `mulligan-bottom`). The opening-hand takeover reads it to
   *  decide who the table is still waiting on. Optional like `ticker`, and
   *  for the same two reasons: boards published by clients predating it
   *  arrive without one, and `toPublicBoard` can't see the phase — that
   *  lives at the store layer, so the publisher spreads it in (see
   *  use-online-table.ts). Absent reads as "still choosing", which is the
   *  safe default. */
  keptHand?: boolean;
}

/** The slice of the library its owner is currently showing. `undefined`
 *  rather than `[]` when nothing is revealed, so the field stays absent on
 *  the wire for the overwhelmingly common private case. */
function projectRevealedLibrary(state: PlaytestState): ProjectedCard[] | undefined {
  const mode = state.libraryReveal ?? 'none';
  // `top-me` is the whole point of the audience split: the owner sees a
  // face-up pile, and nothing about it crosses the wire. Filtering it in an
  // opponent's UI instead would put the card name in every client's payload.
  if (mode === 'none' || mode === 'top-me' || state.zones.library.length === 0) return undefined;
  const shown = mode === 'top' ? state.zones.library.slice(0, 1) : state.zones.library;
  return shown.map(toProjectedCard);
}

/** Slim a `PlaytestCard` down to its projected shape — the one place that
 *  drops image fields, so every zone that projects cards (battlefield,
 *  graveyard, exile, command) does it the same way. */
export function toProjectedCard(card: PlaytestCard): ProjectedCard {
  const { id, name, oracleId, scryfallId, manaValue, typeLine, isToken } = card;
  return { id, name, oracleId, scryfallId, manaValue, typeLine, isToken };
}

/** Per-load secret for `maskId` below. Module-level so a masked id is stable
 *  for the page's lifetime — render keys, `attachedTo` references and an
 *  opponent's point-at-this-card signal all keep lining up — and rotates on
 *  reload, so no table of masked ids survives a session. */
const FACE_DOWN_SALT = Math.random().toString(36).slice(2) + Date.now().toString(36);

/** cyrb53 over `salt + id` — small, fast, non-cryptographic; the random salt
 *  is what stops an opponent inverting it against the finite set of
 *  `cmd-<scryfallId>` commander ids. Not used for anything security-critical
 *  beyond that: the worst case was ever "which face-down permanent is your
 *  commander", whose identity is public in the format anyway. */
function maskId(id: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const s = FACE_DOWN_SALT + id;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fd-${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

/** Face-down (morph/manifest) is the subtle case: the permanent sits in the
 *  battlefield zone, which is otherwise fully public, so a naive projection
 *  leaks its identity. Keep the public facts about the *object* — position,
 *  tapped, counters, stickers, the face-down flag itself, its attachment,
 *  whether it's phased — but reduce `card` to a MASKED instance id. A
 *  face-up transformed card (`showBackFace: true`) is not redacted: which
 *  face a DFC is showing is public information, only `faceDown` hides it.
 *
 *  The id is masked (`maskId`) rather than passed through because instance
 *  ids are not all opaque: deck cards build theirs from `genId('slot')`, but
 *  commanders are `cmd-${commander.id}` with the Scryfall id embedded, and
 *  this engine enforces no rules, so any permanent — a commander included —
 *  can be turned face-down. Rekeying the commander id itself would break
 *  `commanderTax` and resume for saved sessions; masking at the projection
 *  boundary fixes the leak without touching stored state. `hidden` is the
 *  set of face-down ids on this board, so an `attachedTo` reference pointing
 *  at a face-down card is masked the same way and still resolves. */
function toPublicBattlefieldCard(bf: BattlefieldCard, hidden: Set<string>): PublicBattlefieldCard {
  return {
    card: bf.faceDown ? { id: maskId(bf.card.id) } : toProjectedCard(bf.card),
    tapped: bf.tapped,
    counters: bf.counters,
    stickers: bf.stickers,
    x: bf.x,
    y: bf.y,
    faceDown: bf.faceDown,
    showBackFace: bf.showBackFace,
    attachedTo: bf.attachedTo && hidden.has(bf.attachedTo) ? maskId(bf.attachedTo) : bf.attachedTo,
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
  const hidden = new Set(state.battlefield.filter((b) => b.faceDown).map((b) => b.card.id));
  const faceDownExile = new Set(state.faceDownExile ?? []);
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
    battlefield: state.battlefield.map((bf) => toPublicBattlefieldCard(bf, hidden)),
    graveyard: state.zones.graveyard.map(toProjectedCard),
    // Exile is public except for what was put there face down, which is
    // redacted to a bare masked id exactly the way a face-down permanent
    // is — the card is visibly THERE, and what it is stays with its owner.
    exile: state.zones.exile.map((c) =>
      faceDownExile.has(c.id) ? { id: maskId(c.id) } : toProjectedCard(c)
    ),
    command: state.zones.command.map(toProjectedCard),
    handCount: state.zones.hand.length,
    libraryCount: state.zones.library.length,
    // Filtered against the live battlefield for the same reason `revealed`
    // is filtered against the live hand: the list must never name a card
    // the receiver cannot find.
    stack: (state.stack ?? []).filter((id) => state.battlefield.some((b) => b.card.id === id)),
    // Filtered against the live hand, not trusted from the list: a card that
    // left hand without going through `pluck` (an older snapshot, a future
    // action that forgets) must not keep leaking its name from here.
    // Playing with the hand revealed shows all of it, read off the live hand
    // so a card drawn after turning it on is shown too.
    revealed: state.zones.hand
      .filter((c) => state.handRevealed || (state.revealed ?? []).includes(c.id))
      .map(toProjectedCard),
    // Read off the live library rather than carried alongside it, so the
    // revealed card is always the one actually on top — a draw or a shuffle
    // changes what the table sees without anyone re-publishing a list.
    revealedLibrary: projectRevealedLibrary(state),
  };
}
