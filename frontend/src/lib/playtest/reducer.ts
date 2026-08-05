import { mulberry32, nextSeed, shuffle } from './rng';
import { isOpponentDefeated } from './life-config';
import type {
  BattlefieldCard,
  OpponentLife,
  PlaytestAction,
  PlaytestCard,
  PlaytestInit,
  PlaytestState,
  Zone,
} from './types';

const DEFAULT_OPENING_HAND = 7;
const MAX_UNDO_STACK = 50;
const MAX_STICKERS_PER_CARD = 8;
const MAX_STICKER_LENGTH = 30;
/** Unitless x/y step between a clone and its source — the same coordinate
 *  space `MOVE_TO_BATTLEFIELD` uses, which the UI maps to pixels 1:1. */
const CLONE_OFFSET = 18;
/** Unitless x/y step between an attached card and its host, so an aura or
 *  Equipment reads as tucked under the permanent it's on rather than hidden
 *  exactly behind it. */
const ATTACH_OFFSET = 14;
const ZONES: Zone[] = ['library', 'hand', 'graveyard', 'exile', 'command'];

function emptyZones(): Record<Zone, PlaytestCard[]> {
  return { library: [], hand: [], graveyard: [], exile: [], command: [] };
}

export function createPlaytestState(init: PlaytestInit): PlaytestState {
  const seed = init.seed ?? Math.floor(Math.random() * 0xffffffff) >>> 0;
  const shuffled = shuffle(init.library, mulberry32(seed));
  const handSize = Math.min(init.openingHandSize ?? DEFAULT_OPENING_HAND, shuffled.length);
  const hand = shuffled.slice(0, handSize);
  const library = shuffled.slice(handSize);
  const life = init.life ?? 20;
  const opponentLife = init.opponentLife ?? life;
  const opponentCount = init.opponentCount ?? 1;
  return {
    zones: {
      ...emptyZones(),
      library,
      hand,
      command: init.command ?? [],
    },
    battlefield: [],
    rngSeed: nextSeed(seed),
    turn: 1,
    commanderTax: {},
    life,
    opponents: Array.from({ length: opponentCount }, () => ({
      life: opponentLife,
      commanderDamage: 0,
      counters: {},
    })),
    startingLife: life,
    startingOpponentLife: opponentLife,
    commanderDamageThreshold: init.commanderDamageThreshold ?? 21,
    tableDefeatedTurn: null,
    monarch: false,
    initiative: false,
    citysBlessing: false,
    playerCounters: {},
    past: [],
  };
}

/** Snapshot the present (sans `past`) and push it onto the undo stack. */
function snapshot(state: PlaytestState): Omit<PlaytestState, 'past'> {
  return {
    zones: {
      library: state.zones.library.slice(),
      hand: state.zones.hand.slice(),
      graveyard: state.zones.graveyard.slice(),
      exile: state.zones.exile.slice(),
      command: state.zones.command.slice(),
    },
    // Shallow copy only: every action already replaces (never mutates) the
    // bf entries it touches, so untouched cards can keep their object
    // identity through to the rendered state — that's what lets
    // React.memo(PlaytestCardView) skip re-rendering cards nobody touched.
    battlefield: state.battlefield.slice(),
    rngSeed: state.rngSeed,
    turn: state.turn,
    commanderTax: { ...state.commanderTax },
    life: state.life,
    opponents: state.opponents.slice(),
    startingLife: state.startingLife,
    startingOpponentLife: state.startingOpponentLife,
    commanderDamageThreshold: state.commanderDamageThreshold,
    tableDefeatedTurn: state.tableDefeatedTurn,
    monarch: state.monarch,
    initiative: state.initiative,
    citysBlessing: state.citysBlessing,
    playerCounters: { ...state.playerCounters },
  };
}

/** Sticky: once the table is swept, further defeats/heals don't move the
 *  recorded turn. Only fires the first time every opponent is defeated. */
function deriveTableDefeatedTurn(
  turn: number,
  priorTableDefeatedTurn: number | null,
  opponents: readonly OpponentLife[],
  commanderDamageThreshold: number
): number | null {
  if (priorTableDefeatedTurn !== null) return priorTableDefeatedTurn;
  if (opponents.length === 0) return null;
  const allDefeated = opponents.every((o) => isOpponentDefeated(o, commanderDamageThreshold));
  return allDefeated ? turn : null;
}

function withHistory(prev: PlaytestState, next: Omit<PlaytestState, 'past'>): PlaytestState {
  const past = [snapshot(prev), ...prev.past].slice(0, MAX_UNDO_STACK);
  return { ...next, past };
}

interface Locator {
  source: 'zone' | 'battlefield';
  zone?: Zone;
  index: number;
}

/** Find a card by instance id across all zones + battlefield. */
function locate(state: PlaytestState, cardId: string): Locator | null {
  for (const zone of ZONES) {
    const idx = state.zones[zone].findIndex((c) => c.id === cardId);
    if (idx >= 0) return { source: 'zone', zone, index: idx };
  }
  const bfIdx = state.battlefield.findIndex((b) => b.card.id === cardId);
  if (bfIdx >= 0) return { source: 'battlefield', index: bfIdx };
  return null;
}

/** Strip the attachment link off one card. Returns the same object when there
 *  was nothing to strip, so untouched cards keep their identity for memo. */
function withoutAttachment(bf: BattlefieldCard): BattlefieldCard {
  if (bf.attachedTo === undefined) return bf;
  const next = { ...bf };
  delete next.attachedTo;
  return next;
}

/** Detach everything hanging off `hostId` — a permanent that left the
 *  battlefield can't keep attachments pointing at it. */
function detachFrom(battlefield: readonly BattlefieldCard[], hostId: string): BattlefieldCard[] {
  return battlefield.map((b) => (b.attachedTo === hostId ? withoutAttachment(b) : b));
}

/** Walk the attachment chain up from `fromId`; true if it reaches `needle`.
 *  A visited set keeps a malformed pre-existing cycle from spinning forever. */
function attachmentReaches(
  battlefield: readonly BattlefieldCard[],
  fromId: string,
  needle: string
): boolean {
  const seen = new Set<string>();
  let cursor: string | undefined = fromId;
  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === needle) return true;
    seen.add(cursor);
    cursor = battlefield.find((b) => b.card.id === cursor)?.attachedTo;
  }
  return false;
}

/** Re-seat `hostId` and everything attached to it at the end of the array.
 *  Render order is stacking order, so this lands the host on top with its
 *  attachments immediately under it. */
function restackWithAttachments(
  battlefield: readonly BattlefieldCard[],
  hostId: string
): BattlefieldCard[] {
  const host = battlefield.find((b) => b.card.id === hostId);
  if (!host) return battlefield.slice();
  const attached = battlefield.filter((b) => b.attachedTo === hostId);
  const moved = new Set(attached.map((b) => b.card.id));
  moved.add(hostId);
  return [...battlefield.filter((b) => !moved.has(b.card.id)), ...attached, host];
}

/** Remove the card identified by `loc` from its current location. Returns it. */
function pluck(
  next: Omit<PlaytestState, 'past'>,
  loc: Locator
): { card: PlaytestCard; bf?: BattlefieldCard } {
  if (loc.source === 'zone' && loc.zone) {
    const zone = next.zones[loc.zone].slice();
    const [card] = zone.splice(loc.index, 1);
    next.zones[loc.zone] = zone;
    return { card };
  }
  const battlefield = next.battlefield.slice();
  const [bf] = battlefield.splice(loc.index, 1);
  next.battlefield = battlefield;
  return { card: bf.card, bf };
}

export function applyAction(state: PlaytestState, action: PlaytestAction): PlaytestState {
  switch (action.type) {
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const [head, ...rest] = state.past;
      return { ...head, past: rest };
    }
    case 'RESET': {
      // RESET is irreversible by design — clears history along with everything else.
      const all = [
        ...state.zones.library,
        ...state.zones.hand,
        ...state.zones.graveyard,
        ...state.zones.exile,
        ...state.battlefield.filter((b) => !b.card.isToken).map((b) => b.card),
      ];
      const shuffled = shuffle(all, mulberry32(state.rngSeed));
      const hand = shuffled.slice(0, DEFAULT_OPENING_HAND);
      const library = shuffled.slice(DEFAULT_OPENING_HAND);
      return {
        zones: { ...emptyZones(), library, hand, command: state.zones.command.slice() },
        battlefield: [],
        rngSeed: nextSeed(state.rngSeed),
        turn: 1,
        // A new game: tax paid in the last game doesn't carry over.
        commanderTax: {},
        life: state.startingLife,
        opponents: state.opponents.map(() => ({
          life: state.startingOpponentLife,
          commanderDamage: 0,
          counters: {},
        })),
        startingLife: state.startingLife,
        startingOpponentLife: state.startingOpponentLife,
        commanderDamageThreshold: state.commanderDamageThreshold,
        tableDefeatedTurn: null,
        // A new game: designations (including City's Blessing) don't carry
        // over — each is scoped to the game it was earned in.
        monarch: false,
        initiative: false,
        citysBlessing: false,
        // A new game: poison/energy/experience don't carry over either.
        playerCounters: {},
        past: [],
      };
    }
    case 'DRAW': {
      const n = action.n ?? 1;
      if (n <= 0 || state.zones.library.length === 0) return state;
      const take = Math.min(n, state.zones.library.length);
      const next = snapshot(state);
      const drawn = next.zones.library.slice(0, take);
      next.zones.library = next.zones.library.slice(take);
      next.zones.hand = next.zones.hand.concat(drawn);
      return withHistory(state, next);
    }
    case 'SHUFFLE_LIBRARY': {
      const next = snapshot(state);
      next.zones.library = shuffle(next.zones.library, mulberry32(state.rngSeed));
      next.rngSeed = nextSeed(state.rngSeed);
      return withHistory(state, next);
    }
    case 'MULLIGAN': {
      const handSize = action.handSize ?? DEFAULT_OPENING_HAND;
      const next = snapshot(state);
      const combined = next.zones.library.concat(next.zones.hand);
      const shuffled = shuffle(combined, mulberry32(state.rngSeed));
      const take = Math.min(handSize, shuffled.length);
      next.zones.hand = shuffled.slice(0, take);
      next.zones.library = shuffled.slice(take);
      next.rngSeed = nextSeed(state.rngSeed);
      return withHistory(state, next);
    }
    case 'MOVE_TO_ZONE': {
      const loc = locate(state, action.cardId);
      if (!loc) return state;
      const next = snapshot(state);
      const { card, bf } = pluck(next, loc);
      // Anything equipped/enchanted onto a permanent that just left the
      // battlefield falls off — done before the token check so it applies on
      // both exits below.
      if (bf) next.battlefield = detachFrom(next.battlefield, action.cardId);
      // Tokens that leave the battlefield cease to exist (MTG rule 704.5d).
      if (bf?.card.isToken && action.to !== 'command') return withHistory(state, next);
      const dest = next.zones[action.to].slice();
      const insertAt = action.toIndex ?? dest.length;
      dest.splice(Math.max(0, Math.min(insertAt, dest.length)), 0, card);
      next.zones[action.to] = dest;
      return withHistory(state, next);
    }
    case 'RESOLVE_TOP': {
      const byId = new Map(state.zones.library.map((c) => [c.id, c]));
      // One card can only go one place: first list to claim an id wins, so a
      // malformed dispatch can never duplicate a card into two zones.
      const claimed = new Set<string>();
      const pick = (ids: readonly string[] | undefined): PlaytestCard[] =>
        (ids ?? []).reduce<PlaytestCard[]>((out, id) => {
          const card = byId.get(id);
          if (card && !claimed.has(id)) {
            claimed.add(id);
            out.push(card);
          }
          return out;
        }, []);
      const top = pick(action.top);
      const bottom = pick(action.bottom);
      const graveyard = pick(action.graveyard);
      if (claimed.size === 0) return state;
      const rest = state.zones.library.filter((c) => !claimed.has(c.id));
      const next = snapshot(state);
      next.zones.library = [...top, ...rest, ...bottom];
      next.zones.graveyard = next.zones.graveyard.concat(graveyard);
      return withHistory(state, next);
    }
    case 'MOVE_TO_BATTLEFIELD': {
      const loc = locate(state, action.cardId);
      if (!loc) return state;
      const next = snapshot(state);
      // A genuine cast from the command zone — not a battlefield reposition —
      // is what accrues commander tax (MTG rule 903.10).
      const fromCommand = loc.source === 'zone' && loc.zone === 'command';
      const plucked = pluck(next, loc);
      // If already on the battlefield, treat as a reposition + optional state update.
      const bfCard: BattlefieldCard = plucked.bf
        ? {
            ...plucked.bf,
            x: action.x,
            y: action.y,
            tapped: action.tapped ?? plucked.bf.tapped,
            faceDown: action.faceDown ?? plucked.bf.faceDown,
          }
        : {
            card: plucked.card,
            tapped: action.tapped ?? false,
            faceDown: action.faceDown ?? false,
            showBackFace: false,
            counters: {},
            stickers: [],
            x: action.x,
            y: action.y,
          };
      next.battlefield = next.battlefield.concat(bfCard);
      if (fromCommand) {
        next.commanderTax = {
          ...next.commanderTax,
          [action.cardId]: (next.commanderTax[action.cardId] ?? 0) + 1,
        };
      }
      return withHistory(state, next);
    }
    case 'MOVE_BF_POSITION': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const prev = state.battlefield[idx];
      const dx = action.x - prev.x;
      const dy = action.y - prev.y;
      const next = snapshot(state);
      // Attachments ride along with their host, so dragging an equipped
      // creature never strands its Equipment across the board.
      next.battlefield = next.battlefield.map((b) => {
        if (b.card.id === action.cardId) return { ...b, x: action.x, y: action.y };
        if (b.attachedTo !== action.cardId) return b;
        return { ...b, x: b.x + dx, y: b.y + dy };
      });
      // A drag is the intentional "bring to front" gesture: move the moved
      // card to the end of the array so render order (== stacking order)
      // puts it above whatever it now overlaps, with its own attachments
      // tucked just beneath it. TAP does not reorder — untapping a stack
      // shouldn't reshuffle it.
      next.battlefield = restackWithAttachments(next.battlefield, action.cardId);
      return withHistory(state, next);
    }
    case 'TAP': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, tapped: action.tapped ?? !b.tapped } : b
      );
      return withHistory(state, next);
    }
    case 'UNTAP_ALL': {
      if (state.battlefield.every((b) => !b.tapped)) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b) => (b.tapped ? { ...b, tapped: false } : b));
      return withHistory(state, next);
    }
    case 'SET_COUNTER': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const current = state.battlefield[idx].counters[action.counter] ?? 0;
      const updated = current + action.delta;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) => {
        if (i !== idx) return b;
        const counters = { ...b.counters };
        if (updated <= 0) delete counters[action.counter];
        else counters[action.counter] = updated;
        return { ...b, counters };
      });
      return withHistory(state, next);
    }
    case 'ADD_STICKER': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const text = action.text.trim().slice(0, MAX_STICKER_LENGTH);
      if (!text) return state;
      if (state.battlefield[idx].stickers.length >= MAX_STICKERS_PER_CARD) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, stickers: [...b.stickers, text] } : b
      );
      return withHistory(state, next);
    }
    case 'REMOVE_STICKER': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      if (action.index < 0 || action.index >= state.battlefield[idx].stickers.length) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, stickers: b.stickers.filter((_, si) => si !== action.index) } : b
      );
      return withHistory(state, next);
    }
    case 'CREATE_TOKEN': {
      const next = snapshot(state);
      next.battlefield = next.battlefield.concat({
        card: { ...action.card, isToken: true },
        tapped: false,
        faceDown: false,
        showBackFace: false,
        counters: {},
        stickers: [],
        x: action.x,
        y: action.y,
      });
      return withHistory(state, next);
    }
    case 'CLONE_BF_CARDS': {
      const added: BattlefieldCard[] = [];
      for (const { sourceId, id } of action.clones) {
        const src = state.battlefield.find((b) => b.card.id === sourceId);
        if (!src) continue;
        // Cascade within the paste so a multi-card group fans out instead of
        // landing as one indistinguishable stack. Successive pastes cascade
        // too — the UI re-points its clipboard at the clones it just made.
        const step = CLONE_OFFSET * (added.length + 1);
        added.push({
          card: { ...src.card, id, isToken: true },
          tapped: false,
          faceDown: false,
          // The one piece of "which face" state that IS copiable: a copy of a
          // transformed permanent copies the face it's showing (rule 707.8).
          showBackFace: src.showBackFace,
          counters: {},
          stickers: [],
          x: src.x + step,
          y: src.y + step,
        });
      }
      if (added.length === 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.concat(added);
      return withHistory(state, next);
    }
    case 'ATTACH': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      if (action.targetId === null) {
        if (state.battlefield[idx].attachedTo === undefined) return state;
        const next = snapshot(state);
        next.battlefield = next.battlefield.map((b, i) => (i === idx ? withoutAttachment(b) : b));
        return withHistory(state, next);
      }
      // Self-attachment and cycles would strand a card behind a host it can
      // never be freed from — reject rather than store a broken relation.
      const targetId = action.targetId;
      if (targetId === action.cardId) return state;
      const host = state.battlefield.find((b) => b.card.id === targetId);
      if (!host) return state;
      if (attachmentReaches(state.battlefield, targetId, action.cardId)) return state;
      if (state.battlefield[idx].attachedTo === targetId) return state;
      // Snap to the host, fanned by how many things are already on it, so a
      // creature carrying three Equipment doesn't hide them in one pile.
      const alreadyOn = state.battlefield.filter((b) => b.attachedTo === targetId).length;
      const step = ATTACH_OFFSET * (alreadyOn + 1);
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, attachedTo: targetId, x: host.x + step, y: host.y + step } : b
      );
      next.battlefield = restackWithAttachments(next.battlefield, targetId);
      return withHistory(state, next);
    }
    case 'SET_PLAYER_COUNTER': {
      const isSelf = action.player === 'self';
      // Narrowed off `action.player` directly rather than via `isSelf` — a
      // boolean alias doesn't carry the narrowing into the branches below.
      const idx = action.player === 'self' ? -1 : action.player;
      if (!isSelf && (!Number.isInteger(idx) || idx < 0 || idx >= state.opponents.length)) {
        return state;
      }
      const current = isSelf
        ? (state.playerCounters?.[action.counter] ?? 0)
        : (state.opponents[idx].counters?.[action.counter] ?? 0);
      // Player counters floor at zero — healing poison out means "none", not a
      // debt. Mirrors SET_COUNTER, where hitting zero drops the key entirely.
      const updated = Math.max(0, current + action.delta);
      if (updated === current) return state;
      const rebag = (bag: Record<string, number> | undefined): Record<string, number> => {
        const out = { ...bag };
        if (updated <= 0) delete out[action.counter];
        else out[action.counter] = updated;
        return out;
      };
      const next = snapshot(state);
      if (isSelf) {
        next.playerCounters = rebag(state.playerCounters);
      } else {
        next.opponents = next.opponents.map((o, i) =>
          i === idx ? { ...o, counters: rebag(o.counters) } : o
        );
      }
      return withHistory(state, next);
    }
    case 'FLIP_FACE': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, faceDown: !b.faceDown } : b
      );
      return withHistory(state, next);
    }
    case 'TRANSFORM': {
      const idx = state.battlefield.findIndex((b) => b.card.id === action.cardId);
      if (idx < 0) return state;
      const next = snapshot(state);
      next.battlefield = next.battlefield.map((b, i) =>
        i === idx ? { ...b, showBackFace: !b.showBackFace } : b
      );
      return withHistory(state, next);
    }
    case 'SET_CARD_IMAGE': {
      const loc = locate(state, action.cardId);
      if (!loc) return state;
      // Cosmetic-only patch — deliberately bypasses snapshot/withHistory so a
      // later Undo can never revert a card back to its placeholder text box.
      if (loc.source === 'zone' && loc.zone) {
        const zoneKey = loc.zone;
        const zone = state.zones[zoneKey].map((c, i) =>
          i === loc.index ? { ...c, imageUrl: action.imageUrl } : c
        );
        return { ...state, zones: { ...state.zones, [zoneKey]: zone } };
      }
      const battlefield = state.battlefield.map((b, i) =>
        i === loc.index ? { ...b, card: { ...b.card, imageUrl: action.imageUrl } } : b
      );
      return { ...state, battlefield };
    }
    case 'NEXT_TURN': {
      const next = snapshot(state);
      next.turn = state.turn + 1;
      next.battlefield = next.battlefield.map((b) => (b.tapped ? { ...b, tapped: false } : b));
      if (state.zones.library.length > 0) {
        next.zones.library = next.zones.library.slice(1);
        next.zones.hand = next.zones.hand.concat(state.zones.library[0]);
      }
      return withHistory(state, next);
    }
    case 'ADJUST_LIFE': {
      if (action.delta === 0) return state;
      if (action.player === 'self') {
        const next = snapshot(state);
        next.life = state.life + action.delta;
        return withHistory(state, next);
      }
      const idx = action.player;
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.opponents.length) return state;
      const next = snapshot(state);
      next.opponents = next.opponents.map((o, i) =>
        i === idx ? { ...o, life: o.life + action.delta } : o
      );
      next.tableDefeatedTurn = deriveTableDefeatedTurn(
        state.turn,
        state.tableDefeatedTurn,
        next.opponents,
        state.commanderDamageThreshold
      );
      return withHistory(state, next);
    }
    case 'ADJUST_COMMANDER_DAMAGE': {
      if (action.delta === 0) return state;
      const idx = action.opponent;
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.opponents.length) return state;
      const next = snapshot(state);
      // Commander damage never goes negative — healing it out just means "no
      // damage yet," not a debt.
      next.opponents = next.opponents.map((o, i) =>
        i === idx ? { ...o, commanderDamage: Math.max(0, o.commanderDamage + action.delta) } : o
      );
      next.tableDefeatedTurn = deriveTableDefeatedTurn(
        state.turn,
        state.tableDefeatedTurn,
        next.opponents,
        state.commanderDamageThreshold
      );
      return withHistory(state, next);
    }
    case 'SET_DESIGNATION': {
      if (state[action.designation] === action.held) return state;
      const next = snapshot(state);
      next[action.designation] = action.held;
      return withHistory(state, next);
    }
  }
}
