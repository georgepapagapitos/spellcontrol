/**
 * Rewind classification (multiplayer takebacks). Pure logic only — no UI, no
 * networking, no consent flow; those are follow-ups. This module answers one
 * question for every playtest action: can it be taken back, and does taking
 * it back need the table's agreement?
 *
 * The rule: you cannot un-see information. A takeback is
 *  - `locked`  — the actor gained hidden information (or the state that made
 *                a rewind possible was destroyed). No amount of consent
 *                undoes that; there's nothing to hand back.
 *  - `consent` — the table saw it, or shared state changed, but the actor
 *                learned nothing private. Legitimate if the others agree.
 *  - `free`    — local bookkeeping nobody else depends on. Always reversible.
 *
 * Deliberately has zero dependency on `game-log.ts` (only `types.ts`) so
 * there's no import cycle with the module that attaches the verdict to a
 * `GameLogEntry`.
 */

import type { PlaytestAction, PlaytestState, Zone } from './types';

export type RewindVerdict = 'locked' | 'consent' | 'free';

export interface RewindClassification {
  verdict: RewindVerdict;
  /** Always populated, including for the "obviously free" cases, so a UI
   *  surface can show its reasoning rather than a bare label. */
  reason: string;
}

function classification(verdict: RewindVerdict, reason: string): RewindClassification {
  return { verdict, reason };
}

const LOCKED_LIBRARY_LOOK =
  "The library is hidden — taking a card off it means seeing (or choosing among) what was underneath. That can't be handed back.";

/** Where a card *was*, not the zone map's iteration order — battlefield is
 *  checked separately since it isn't a key of `state.zones`. */
function locateZone(state: PlaytestState, cardId: string): Zone | 'battlefield' | null {
  for (const zone of Object.keys(state.zones) as Zone[]) {
    if (state.zones[zone].some((c) => c.id === cardId)) return zone;
  }
  if (state.battlefield.some((b) => b.card.id === cardId)) return 'battlefield';
  return null;
}

/**
 * MOVE_TO_ZONE cannot be classified by action type alone — the *source* zone
 * decides it. `library → hand` is a tutor (the mover searched the one hidden
 * zone — locked). `hand → graveyard` is a discard: the table already treats
 * the actor as knowing their own hand, so nothing hidden was learned by
 * moving it — even though the card leaving hand is itself new information
 * *for the table* (which is exactly what makes it `consent` rather than
 * `free`: the graveyard is shared, public state now, and reverting it is a
 * social ask, not a purely private one). Every non-library source shares that
 * shape, including a card leaving the battlefield.
 */
function moveToZoneVerdict(from: Zone | 'battlefield' | null): RewindClassification {
  if (from === 'library') return classification('locked', LOCKED_LIBRARY_LOOK);
  return classification(
    'consent',
    'Moved between zones the table can already account for — nothing hidden was learned making the move, but where it landed is now public.'
  );
}

/**
 * MOVE_TO_BATTLEFIELD gets the same library rule as MOVE_TO_ZONE, but a
 * battlefield-sourced call is the drag-to-reposition case the reducer treats
 * specially (see `MOVE_TO_BATTLEFIELD` in reducer.ts and the "reposition, not
 * a play" comment in game-log.ts) — no zone actually changed, so it's
 * bookkeeping, not a play.
 */
function moveToBattlefieldVerdict(from: Zone | 'battlefield' | null): RewindClassification {
  if (from === 'library') return classification('locked', LOCKED_LIBRARY_LOOK);
  if (from === 'battlefield') {
    return classification(
      'free',
      'Already on the battlefield — this is a reposition or a state tweak (tapped/face-down), not a new play.'
    );
  }
  return classification(
    'consent',
    'A card entering play is public the instant it lands — the table watches it happen.'
  );
}

const RESOLVE_TOP_VERB: Record<'scry' | 'surveil' | 'mill', string> = {
  scry: 'Scrying',
  surveil: 'Surveilling',
  mill: 'Milling',
};

/**
 * Classify a single playtest action's rewindability, given the state
 * *immediately before* it was applied (the only place the source zone of a
 * MOVE_TO_ZONE/MOVE_TO_BATTLEFIELD is still knowable — `state.past` stores
 * states, not actions, so this can't be reconstructed later).
 *
 * The switch has no `default` — the compiler enforces every member of
 * `PlaytestAction['type']` is handled, so adding a new action type without
 * classifying it here is a type error, not a silent gap.
 */
export function classifyAction(
  current: PlaytestState,
  action: PlaytestAction
): RewindClassification {
  switch (action.type) {
    case 'DRAW':
      return classification(
        'locked',
        'Drawing shows the actor a card. No replay hands that knowledge back.'
      );

    case 'MULLIGAN':
      return classification(
        'locked',
        'A new hand was seen — the London mulligan draws a fresh seven before any bottoming happens.'
      );

    case 'SHUFFLE_LIBRARY':
      // Nobody *sees* anything here, unlike the other locked cases — but the
      // RNG advanced and every future draw now comes from that new order.
      // Handing back the pre-shuffle order isn't undoing a UI action, it's
      // rewriting what the deck deals next — the same "the game now knows
      // something it didn't" shape as hidden information, just one step
      // removed from a human's eyes.
      return classification(
        'locked',
        'The library order changed and future draws depend on it — un-shuffling would hand back an ordering (and its knock-on draws) nobody is entitled to know in advance.'
      );

    case 'RESOLVE_TOP':
      return classification(
        'locked',
        `${RESOLVE_TOP_VERB[action.mode]} looks at the top of the library — hidden information, seen.`
      );

    case 'MOVE_TO_ZONE':
      return moveToZoneVerdict(locateZone(current, action.cardId));

    case 'MOVE_TO_BATTLEFIELD':
      return moveToBattlefieldVerdict(locateZone(current, action.cardId));

    case 'MOVE_BF_POSITION':
      return classification('free', 'A drag on the mat — no zone or information changed.');

    case 'TAP':
      // Arguable: a tap is visible to the whole table, and can represent an
      // attack declaration or ability activation others already reacted to —
      // that alone would argue for `consent`. But nothing hidden is ever at
      // stake (this app has no rules engine enforcing what a tap paid for),
      // and an accidental tap is the single most common misclick in the app —
      // the exact case the whole feature exists to make painless. Real
      // tables wave this one off without a second thought; `free` matches
      // that norm rather than the stricter "table saw it" reading.
      return classification(
        'free',
        'Visible to the table, but reversible bookkeeping with nothing hidden riding on it — and the single most common misclick.'
      );

    case 'UNTAP_ALL':
      return classification('free', 'Bulk version of TAP — same reasoning.');

    case 'SET_COUNTER':
      return classification(
        'free',
        "A permanent's counter tally is tracked, not enforced — adjusting it back costs nothing."
      );

    case 'ADD_STICKER':
    case 'REMOVE_STICKER':
      return classification(
        'free',
        "A free-text label on a card — purely the player's own bookkeeping."
      );

    case 'CREATE_TOKEN':
      return classification(
        'consent',
        'A new object enters a shared, visible zone — the table sees it appear.'
      );

    case 'CLONE_BF_CARDS':
      return classification(
        'consent',
        'Copies land on the shared battlefield — visible to everyone, even though nothing hidden was learned making them.'
      );

    case 'ATTACH':
      return classification(
        'consent',
        'A visible battlefield relationship (Aura/Equipment) the table tracks, and may already be reacting to.'
      );

    case 'FLIP_FACE':
    case 'TRANSFORM':
      // These change what the *table* can see of a card, not what the actor
      // privately knows (the actor already knew the card underneath). That's
      // exactly the `consent` shape: shared state changed, no private
      // knowledge was gained by the person taking the action.
      return classification(
        'consent',
        'Changes what the table can see of the card, not what the actor privately knows.'
      );

    case 'TOGGLE_PHASED':
      return classification(
        'free',
        'A personal "doesn\'t interact right now" flag — bookkeeping, not a zone or information change.'
      );

    case 'ADJUST_MANA':
    case 'EMPTY_MANA_POOL':
      return classification(
        'free',
        'Floating-mana tally is display bookkeeping — this app never spends it against a cost.'
      );

    case 'SET_CARD_IMAGE':
      // The reducer itself never pushes this onto the undo stack (see
      // reducer.ts: it bypasses `snapshot`/`withHistory` outright), so it can
      // never actually be the action a rewind targets. Classified for
      // completeness, matching the reducer's own "not really history" stance.
      return classification(
        'free',
        'Cosmetic async art patch — the reducer never records it in undo history to begin with.'
      );

    case 'NEXT_TURN':
      return classification(
        'consent',
        'Passing the turn is a shared, public moment the whole table experiences together.'
      );

    case 'RESET':
      // Not "negotiable" in the ordinary sense — RESET clears the undo stack
      // outright (see reducer.ts), so there is no prior state left to walk
      // back to, even in principle. Modeled as `locked` because it's the same
      // *hard wall* shape as hidden information: rewinding past it is
      // impossible regardless of consent — just for a different underlying
      // reason (the history was destroyed, not that someone learned a secret).
      return classification(
        'locked',
        'Clears the undo history outright — there is no prior state left to rewind to, regardless of consent.'
      );

    case 'UNDO':
      // Undo only ever restores a state that was already live at some earlier
      // point in this same session — it cannot surface anything the table
      // (or the actor) didn't already see once. Restoring it again isn't new
      // information, so it carries none of the `locked` weight itself.
      return classification(
        'free',
        'Only ever restores a state that already happened once this session — reveals nothing new.'
      );

    case 'ADJUST_LIFE':
    case 'ADJUST_COMMANDER_DAMAGE':
      return classification(
        'consent',
        'Life and commander damage are shared numbers the whole table tracks and reacts to.'
      );

    case 'SET_PLAYER_COUNTER':
      // Unlike life/commander-damage, this app never derives a loss condition
      // from poison/energy/experience (see reducer.ts's
      // `deriveTableDefeatedTurn` — life and commander damage only). With no
      // downstream consequence wired up, it's grouped with the other
      // counters as bookkeeping rather than with life/damage.
      return classification(
        'free',
        'Not wired to any loss condition in this app — tracked the same as a permanent counter.'
      );

    case 'SET_DESIGNATION':
      return classification(
        'consent',
        "A table-wide designation (Monarch/Initiative/City's Blessing) — everyone sees who holds it."
      );
  }
}

/** Anything the walk can read a verdict off of — deliberately structural
 *  (not `GameLogEntry` itself) so this module stays independent of
 *  `game-log.ts` and works directly against test fixtures. */
export interface RewindLogEntry {
  verdict?: RewindVerdict;
}

export interface RewindWalk<T extends RewindLogEntry> {
  /** How many of the most recent log entries can be undone without hitting a
   *  hard `locked` wall. Some of them may still need the table's consent —
   *  see `firstConsentIndex`. */
  stepsAvailable: number;
  /** The nearest-to-now `locked` entry, i.e. the wall that stops the walk —
   *  or `null` if the whole log is rewindable (no locked entry present). */
  boundary: T | null;
  /** Index into the rewindable window (0 = most recent) of the first entry
   *  that needs the table's agreement, or `null` if every step in the window
   *  is `free`. */
  firstConsentIndex: number | null;
  firstConsentEntry: T | null;
}

/**
 * Walk a game log backward from its most recent entry and report how far a
 * rewind can go. A `locked` entry is a hard wall: nothing at or before it can
 * be undone, full stop — everything strictly newer than it is fair game,
 * though a `consent` entry inside that window still needs the table's
 * agreement to actually take back. This is what lets the UI say "you can
 * take back 2 actions — the third would undo a draw" (`boundary`) and "the
 * first of those needs the table's OK" (`firstConsentIndex`).
 *
 * An entry with no verdict at all (a log persisted before this feature
 * existed) is treated as `locked` — conservatively, since an unclassified
 * entry's safety can't be verified after the fact.
 *
 * Pure: same log in, same result out, every time.
 */
export function walkRewindable<T extends RewindLogEntry>(log: readonly T[]): RewindWalk<T> {
  let stepsAvailable = 0;
  let boundary: T | null = null;
  let firstConsentIndex: number | null = null;
  let firstConsentEntry: T | null = null;

  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    const verdict: RewindVerdict = entry.verdict ?? 'locked';
    if (verdict === 'locked') {
      boundary = entry;
      break;
    }
    if (verdict === 'consent' && firstConsentIndex === null) {
      firstConsentIndex = stepsAvailable;
      firstConsentEntry = entry;
    }
    stepsAvailable++;
  }

  return { stepsAvailable, boundary, firstConsentIndex, firstConsentEntry };
}
