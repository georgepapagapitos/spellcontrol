/**
 * The goldfish game loop. See `./index.ts` for the model; this file is the
 * mechanics.
 */

import { isKeepableHand, librarySeed } from './opening-hand-sim';
import { mulberry32, shuffle } from '../playtest/rng';
import { gameSeed } from './game-seed';
import {
  allocate,
  canPay,
  canPayWithDrops,
  dropShortMask,
  dropTotal,
  popcount,
  type DropSupply,
  type PoolUnit,
} from './cost';
import {
  ANY_COLOR,
  MANA_SYMBOLS,
  type CardCastability,
  type LandFace,
  type LandSearch,
  type ManaCard,
  type ManaChoice,
  type ManaCost,
  type ManaDeck,
  type ManaMask,
  type ManaSimOptions,
  type ManaSimResult,
  type ManaSymbol,
} from './types';

/** Flood is judged at the end of this turn. */
export const FLOOD_TURN = 6;
/** Land cards stuck in hand at FLOOD_TURN that count as surplus. */
export const FLOOD_SURPLUS = 2;

/** A land on the battlefield. */
interface LandPerm {
  card: number;
  units: ManaMask[];
  /** First turn it can tap. */
  ready: number;
  /** Played as a land drop (a fetch's land counts); false = put in by a ramp spell. */
  fromDrop: boolean;
}

/** A rock, dork or other nonland mana permanent. */
interface SourcePerm {
  units: ManaMask[];
  ready: number;
  oneShot: boolean;
  /** One-shot units not yet spent. */
  left: number;
}

/** A fetch in hand, for the re-chosen-drops supply. */
interface HandFetch {
  mask: ManaMask;
  /** Could be today's drop with an untapped target. */
  now: boolean;
  /** Drawn this turn. */
  today: boolean;
  search: LandSearch;
}

interface CostStat {
  cost: ManaCost;
  onTurn: number;
  on: number;
  onEnough: number;
  next: number;
  nextEnough: number;
  short: Float64Array;
}

const karstenBar = (mv: number): number => (89 + Math.min(7, Math.max(1, mv))) / 100;

const unionOf = (units: readonly ManaMask[]): ManaMask => {
  let m = 0;
  for (const u of units) m |= u;
  return m;
};

/** Every mana type a land can supply: what it taps for, what it can choose, what it can fetch. */
function reachOf(face: LandFace): ManaMask {
  let m = unionOf(face.units);
  if (face.choice) m |= face.choice.fixed | face.choice.options;
  if (face.fetch) m |= face.fetch.types;
  return m;
}

/** Marks a pool unit spent before the pool is compacted. */
const SPENT: PoolUnit = { mask: 0, spend: 0, source: -1 };

/** Lexicographic "a beats b" over equal-length number tuples. */
function beats(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function simulateManaDeck(deck: ManaDeck, options: ManaSimOptions = {}): ManaSimResult {
  const games = Math.max(1, Math.floor(options.games ?? 1000));
  const maxTurn = Math.max(1, Math.floor(options.maxTurn ?? 10));
  const mode = options.mulligan ?? 'app';
  const freeMulligan = options.freeMulligan ?? true;
  const depth = Math.max(0, Math.floor(options.mulliganDepth ?? (mode === 'karsten' ? 3 : 2)));
  const drawOnTurnOne = options.drawOnTurnOne ?? true;
  const opponents = options.opponents ?? 3;
  const seed =
    options.seed ??
    librarySeed([...deck.commanders, ...deck.library].map((c) => ({ name: c.name })));

  // ── Card table: distinct cards by name, the library as ids ────────────────
  const cards: ManaCard[] = [];
  const idByName = new Map<string, number>();
  const idOf = (c: ManaCard): number => {
    let id = idByName.get(c.name);
    if (id === undefined) {
      id = cards.length;
      cards.push(c);
      idByName.set(c.name, id);
    }
    return id;
  };
  const libraryIds = deck.library.map(idOf);
  const commanders = deck.commanders;
  const copies = new Map<number, number>();
  for (const id of libraryIds) copies.set(id, (copies.get(id) ?? 0) + 1);
  const isSpell = (c: ManaCard): boolean => c.cost !== null && !c.landCard;

  // Which library cards each search can find: fixed per deck.
  const searchMatches = new Map<LandSearch, number[]>();
  const matchesOf = (search: LandSearch): number[] => {
    let ids = searchMatches.get(search);
    if (!ids) {
      ids = [];
      for (const [id] of copies) {
        const f = cards[id].land;
        if (!cards[id].landCard || !f) continue;
        if (search.basicOnly && !f.basic) continue;
        if (search.types !== ANY_COLOR && !(f.types & search.types)) continue;
        ids.push(id);
      }
      searchMatches.set(search, ids);
    }
    return ids;
  };

  // Costs to measure: every distinct cost among library spells and commanders.
  const costStats: CostStat[] = [];
  const costIdByKey = new Map<string, number>();
  const costIdOf = (cost: ManaCost): number => {
    let id = costIdByKey.get(cost.key);
    if (id === undefined) {
      id = costStats.length;
      costIdByKey.set(cost.key, id);
      costStats.push({
        cost,
        onTurn: Math.max(1, cost.mv),
        on: 0,
        onEnough: 0,
        next: 0,
        nextEnough: 0,
        short: new Float64Array(6),
      });
    }
    return id;
  };
  const cardCost = cards.map((c) => (isSpell(c) ? costIdOf(c.cost as ManaCost) : -1));
  const commanderCost = commanders.map((c) => (c.cost ? costIdOf(c.cost) : -1));
  const onAt: number[][] = Array.from({ length: maxTurn + 1 }, () => []);
  const nextAt: number[][] = Array.from({ length: maxTurn + 1 }, () => []);
  costStats.forEach((s, i) => {
    if (s.onTurn <= maxTurn) onAt[s.onTurn].push(i);
    if (s.onTurn + 1 <= maxTurn) nextAt[s.onTurn + 1].push(i);
  });

  // Deck color demand: pips weighted toward early costs (the manabaseMath
  // earliness curve), commanders counted twice since they are always in reach.
  const demand = new Float64Array(6);
  const addPips = (target: Float64Array, cost: ManaCost, weight: number): void => {
    for (const p of cost.pips) {
      let n = 0;
      for (let b = 0; b < 6; b++) if (p & (1 << b)) n++;
      for (let b = 0; b < 6; b++) if (p & (1 << b)) target[b] += weight / n;
    }
  };
  const earliness = (cost: ManaCost): number => 1 + 0.1 * Math.max(0, 5 - cost.mv);
  for (const id of libraryIds) {
    const cost = cards[id].cost;
    if (cardCost[id] >= 0 && cost) addPips(demand, cost, earliness(cost));
  }
  for (const c of commanders) if (c.cost) addPips(demand, c.cost, 2 * earliness(c.cost));
  const demandSum = demand.reduce((a, b) => a + b, 0);
  if (demandSum > 0) for (let b = 0; b < 6; b++) demand[b] /= demandSum;

  const landReach = cards.map((c) => (c.land ? reachOf(c.land) : 0));
  const deckCount = new Int32Array(cards.length);
  for (const id of libraryIds) deckCount[id]++;
  /** Per-card stamp: tried as a land candidate in this land-drop phase. */
  const tried = new Int32Array(cards.length);
  const pipVector = cards.map((c) => {
    const v = new Float64Array(6);
    if (c.cost && !c.landCard) addPips(v, c.cost, 1);
    return v;
  });

  // ── Accumulators ──────────────────────────────────────────────────────────
  const T = maxTurn + 1;
  const hit = new Float64Array(T);
  const onCurveDrops = new Float64Array(T);
  const landsInPlaySum = new Float64Array(T);
  const manaSum = new Float64Array(T);
  const manaAtLeast = new Float64Array(T);
  let keep7 = 0;
  let keptSizeSum = 0;
  const keptSizes: Record<number, number> = {};
  let missed3 = 0;
  let missed4 = 0;
  let floodCount = 0;
  let surplusCount = 0;

  // ── Per-game state ────────────────────────────────────────────────────────
  let order: number[] = [];
  let ptr = 0;
  const libCount = new Int32Array(cards.length);
  let hand: number[] = [];
  let lands: LandPerm[] = [];
  let sources: SourcePerm[] = [];
  let treasures = 0;
  let cmdCast: boolean[] = [];
  let legendaryInPlay = false;
  const srcCount = new Float64Array(6);
  const handPips = new Float64Array(6);
  /** The pool's masks before the land drop: what `castNow` pays from. */
  let base: ManaMask[] = [];
  const drop: DropSupply = {
    fixed: [],
    early: [],
    flex: [],
    today: [],
    drops: 0,
    memo: new Int32Array(64),
  };

  const addHandPips = (id: number, sign: 1 | -1): void => {
    const v = pipVector[id];
    for (let b = 0; b < 6; b++) handPips[b] += sign * v[b];
  };
  const need = (b: number): number => (demand[b] + 0.05 * handPips[b]) / (1 + srcCount[b]);
  const colourValue = (m: ManaMask): number => {
    let v = 0;
    for (let b = 0; b < 6; b++) if (m & (1 << b)) v += need(b);
    return v;
  };
  const noteSource = (units: readonly ManaMask[], sign: 1 | -1): void => {
    const m = unionOf(units);
    for (let b = 0; b < 6; b++) if (m & (1 << b)) srcCount[b] += sign;
  };

  const faceOf = (id: number): LandFace => cards[id].land as LandFace;

  /** Would this land enter untapped now? `self` is its hand copy (a snarl can't reveal itself). */
  const entersUntapped = (face: LandFace, self: number): boolean => {
    const e = face.entry;
    switch (e.kind) {
      case 'untapped':
      case 'shock':
        return true;
      case 'bond':
        return opponents >= 2;
      case 'check':
        return lands.some((l) => faceOf(l.card).types & e.types);
      case 'fast':
        return lands.length <= 2;
      case 'slow':
        return lands.length >= 2;
      case 'basics':
        return lands.filter((l) => faceOf(l.card).basic).length >= e.count;
      case 'reveal': {
        let skipped = false;
        for (const id of hand) {
          if (id === self && !skipped) {
            skipped = true;
            continue;
          }
          if (cards[id].landCard && faceOf(id).types & e.types) return true;
        }
        return false;
      }
      case 'legendary':
        return legendaryInPlay;
      default:
        return false;
    }
  };

  const searchUntapped = (search: LandSearch, target: number): boolean =>
    (!search.tapped || (search.untapAtLands > 0 && lands.length + 1 >= search.untapAtLands)) &&
    entersUntapped(faceOf(target), target);

  /** Every mana type a land card could make once down (a choice left open). */
  const targetMask = (id: number): ManaMask => {
    const f = faceOf(id);
    return unionOf(f.units) | (f.choice ? f.choice.fixed | f.choice.options : 0);
  };

  /** Mana types a fetch in hand could reach: all targets, and those usable this turn. */
  const fetchReach = (search: LandSearch): { all: ManaMask; now: ManaMask } => {
    let all = 0;
    let now = 0;
    for (const t of matchesOf(search)) {
      if (libCount[t] <= 0) continue;
      const m = targetMask(t);
      all |= m;
      if (searchUntapped(search, t) && faceOf(t).minLands <= lands.length + 1) now |= m;
    }
    return { all, now };
  };

  /** Units a land in hand gives THIS turn if played now (a choice stays open: one flexible unit). */
  const unitsIfPlayed = (id: number): ManaMask[] => {
    const f = faceOf(id);
    if (f.fetch) {
      const { now } = fetchReach(f.fetch);
      return now ? [now] : [];
    }
    if (f.bounce || !entersUntapped(f, id) || f.minLands > lands.length + 1) return [];
    if (f.choice) return [f.choice.fixed | f.choice.options];
    return f.units.slice();
  };

  const resolveChoice = (units: readonly ManaMask[], choice: ManaChoice | null): ManaMask[] => {
    if (!choice) return units.slice();
    let best = 0;
    let bestV = -1;
    for (let b = 0; b < 6; b++) {
      if (!(choice.options & (1 << b))) continue;
      const v = need(b);
      if (v > bestV) {
        bestV = v;
        best = 1 << b;
      }
    }
    return [choice.fixed | best];
  };

  /**
   * Biggest mana value castable now from hand or command zone with `extra` on
   * top of `base`. Memoized per land-drop phase for zero- and one-unit extras
   * (every fetch target and most land candidates), which is where it is hot.
   */
  // Slot 64 is "no extra unit"; a slot is valid while its stamp is the phase's.
  const castNowValue = new Int32Array(65);
  const castNowStamp = new Int32Array(65);
  let phase = 0;
  const castNow = (extra: readonly ManaMask[]): number => {
    if (extra.length > 1) return castNowUncached(extra);
    const key = extra.length === 0 ? 64 : extra[0];
    if (castNowStamp[key] !== phase) {
      castNowValue[key] = castNowUncached(extra);
      castNowStamp[key] = phase;
    }
    return castNowValue[key];
  };
  const castNowUncached = (extra: readonly ManaMask[]): number => {
    let best = -1;
    for (const id of hand) {
      const c = cards[id];
      if (!c.cost || c.landCard || c.cost.mv <= best) continue;
      if (canPay(c.cost, base, extra)) best = c.cost.mv;
    }
    for (let i = 0; i < commanders.length; i++) {
      const cost = commanders[i].cost;
      if (cmdCast[i] || !cost || cost.mv <= best) continue;
      if (canPay(cost, base, extra)) best = cost.mv;
    }
    return best;
  };

  /**
   * Take a searched-for card out of the library. The search's shuffle is not
   * repeated: a card picked by what it is (not where it sits) leaves the rest
   * of a uniformly shuffled library uniformly ordered, so the shuffle would
   * spend random numbers without changing any distribution.
   */
  const removeFromLibrary = (id: number): void => {
    order.splice(order.indexOf(id, ptr), 1);
    libCount[id]--;
  };

  const putLand = (id: number, ready: number, fromDrop: boolean): LandPerm => {
    const f = faceOf(id);
    const units = resolveChoice(f.units, f.choice);
    const perm = { card: id, units, ready, fromDrop };
    lands.push(perm);
    noteSource(units, 1);
    return perm;
  };

  /**
   * The best search target. A fetch cracked for the land drop weighs what it
   * lets you cast this turn first; a ramp spell's search (its mana already
   * spent) goes straight to the most-needed colors. Untapped breaks ties.
   */
  const pickTarget = (search: LandSearch, forDrop: boolean): number => {
    let best = -1;
    let bestKey = [-2, -1, -1];
    for (const t of matchesOf(search)) {
      if (libCount[t] <= 0) continue;
      const untapped = searchUntapped(search, t);
      const f = faceOf(t);
      const key = [
        forDrop && untapped && f.minLands <= lands.length + 1
          ? castNow(f.units)
          : forDrop
            ? castNow([])
            : 0,
        colourValue(landReach[t]),
        untapped ? 1 : 0,
      ];
      if (beats(key, bestKey)) {
        best = t;
        bestKey = key;
      }
    }
    return best;
  };

  /** Resolve a ramp spell's search. Returns the units ready this turn. */
  const resolveSearch = (search: LandSearch, turn: number): ManaMask[] => {
    const now: ManaMask[] = [];
    for (let k = 0; k < search.count; k++) {
      const t = pickTarget(search, false);
      if (t < 0) break;
      const untapped = searchUntapped(search, t);
      removeFromLibrary(t);
      const perm = putLand(t, untapped ? turn : turn + 1, false);
      if (untapped && faceOf(t).minLands <= lands.length) now.push(...perm.units);
    }
    for (let k = 0; k < search.toHand; k++) {
      const t = pickTarget(search, false);
      if (t < 0) break;
      removeFromLibrary(t);
      hand.push(t);
    }
    return now;
  };

  /** Least useful land on the battlefield other than index `except` (Karoo bounce, Harrow). */
  const worstLand = (except: number): number => {
    let worst = -1;
    let worstV = Infinity;
    lands.forEach((l, i) => {
      if (i === except) return;
      const v = colourValue(unionOf(l.units));
      if (v < worstV) {
        worstV = v;
        worst = i;
      }
    });
    return worst;
  };

  const buildPool = (turn: number): PoolUnit[] => {
    const pool: PoolUnit[] = [];
    for (const l of lands) {
      if (l.ready > turn || faceOf(l.card).minLands > lands.length) continue;
      for (const u of l.units) pool.push({ mask: u, spend: 0, source: -1 });
    }
    sources.forEach((s, i) => {
      if (s.ready > turn) return;
      if (s.oneShot) {
        for (let k = 0; k < s.left; k++) pool.push({ mask: s.units[0], spend: 2, source: i });
      } else {
        for (const u of s.units) pool.push({ mask: u, spend: 0, source: -1 });
      }
    });
    for (let k = 0; k < treasures; k++) pool.push({ mask: ANY_COLOR, spend: 1, source: -1 });
    return pool;
  };

  /**
   * The re-chosen-drops supply for this turn (see `DropSupply`). `newFrom` is
   * the hand index where this turn's draw starts.
   */
  const buildDropSupply = (turn: number, drops: number, newFrom: number): void => {
    drop.fixed.length = 0;
    drop.early.length = 0;
    drop.flex.length = 0;
    drop.today.length = 0;
    drop.drops = drops;
    (drop.memo as Int32Array).fill(-1);
    for (const s of sources) {
      if (s.ready > turn) continue;
      const n = s.oneShot ? s.left : s.units.length;
      for (let k = 0; k < n; k++) drop.fixed.push(s.oneShot ? s.units[0] : s.units[k]);
    }
    for (let k = 0; k < treasures; k++) drop.fixed.push(ANY_COLOR);
    for (const l of lands) {
      const f = faceOf(l.card);
      if (f.minLands > lands.length + 1) continue;
      if (!l.fromDrop) {
        if (l.ready <= turn) drop.fixed.push(...l.units);
        continue;
      }
      // A multi-mana land already down keeps its extra mana whatever the order.
      for (let k = 1; k < l.units.length; k++) drop.fixed.push(l.units[k]);
      if (l.units.length === 0) continue;
      (entersUntapped(f, -1) ? drop.flex : drop.early).push(l.units[0]);
    }
    const fetches: HandFetch[] = [];
    for (let h = 0; h < hand.length; h++) {
      const id = hand[h];
      const f = cards[id].land;
      if (!f || f.minLands > lands.length + 1) continue;
      if (f.fetch) {
        // A fetch counts as one land of every color it can reach,
        // even as today's drop where only its untapped targets could serve
        // (a fetch into a tapped triome). Split the mask by use if it matters.
        const r = fetchReach(f.fetch);
        if (r.all)
          fetches.push({ mask: r.all, now: r.now !== 0, today: h >= newFrom, search: f.fetch });
        continue;
      }
      const all = unionOf(f.units) | (f.choice ? f.choice.fixed | f.choice.options : 0);
      if (!all) continue;
      const now = !f.bounce && entersUntapped(f, id);
      if (h >= newFrom) {
        if (now) drop.today.push(all);
      } else {
        (now ? drop.flex : drop.early).push(all);
      }
    }
    if (fetches.length > 1) capFetches(fetches);
    for (const x of fetches) {
      if (!x.mask) continue;
      if (x.today) {
        if (x.now) drop.today.push(x.mask);
      } else {
        (x.now ? drop.flex : drop.early).push(x.mask);
      }
    }
  };

  /**
   * Fetches in hand share one library: no color can be fetched by more of
   * them than there are cards left that make it. The color is stripped from
   * the fetches with the most alternatives first.
   */
  const capFetches = (list: HandFetch[]): void => {
    const targets = new Set<number>();
    for (const x of list) for (const t of matchesOf(x.search)) if (libCount[t] > 0) targets.add(t);
    for (let b = 0; b < 6; b++) {
      const bit = 1 << b;
      let supply = 0;
      for (const t of targets) if (targetMask(t) & bit) supply += libCount[t];
      const wanting = list.filter((x) => x.mask & bit);
      if (wanting.length <= supply) continue;
      wanting.sort((a, c) => popcount(c.mask) - popcount(a.mask));
      for (let k = 0; k < wanting.length - supply; k++) wanting[k].mask &= ~bit;
    }
  };

  const measure = (sid: number, onCurve: boolean): void => {
    const s = costStats[sid];
    if (dropTotal(drop) < s.cost.units) return;
    const ok = canPayWithDrops(s.cost, drop);
    if (onCurve) {
      s.onEnough++;
      if (ok) s.on++;
      else {
        const short = dropShortMask(s.cost, drop);
        for (let b = 0; b < 6; b++) if (short & (1 << b)) s.short[b]++;
      }
    } else {
      s.nextEnough++;
      if (ok) s.next++;
    }
  };

  // ── Opening hand ─────────────────────────────────────────────────────────
  /** London bottoming, Karsten's way: aim near three lands, priciest spells and least-needed lands first. */
  const bottom = (seven: number[], n: number): { kept: number[]; bottomed: number[] } => {
    if (n <= 0) return { kept: seven, bottomed: [] };
    const spells = seven.filter((id) => !cards[id].sim.isLand);
    const landIds = seven.filter((id) => cards[id].sim.isLand);
    const targetSpells = seven.length - n >= 5 ? 2 : 1;
    let spellsOut = Math.min(n, Math.max(0, spells.length - targetSpells));
    let landsOut = n - spellsOut;
    if (landsOut > landIds.length) {
      spellsOut += landsOut - landIds.length;
      landsOut = landIds.length;
    }
    spells.sort(
      (a, b) =>
        Number(cards[a].sim.role === 'ramp') - Number(cards[b].sim.role === 'ramp') ||
        cards[b].sim.cmc - cards[a].sim.cmc
    );
    landIds.sort((a, b) => colourValue(landReach[a]) - colourValue(landReach[b]));
    const bottomed = [...spells.slice(0, spellsOut), ...landIds.slice(0, landsOut)];
    const kept = seven.slice();
    for (const id of bottomed) kept.splice(kept.indexOf(id), 1);
    return { kept, bottomed };
  };

  /** Karsten's 2022 keep rule for Commander (lands after bottoming). */
  const karstenKeeps = (kept: number[], free: boolean): boolean => {
    const n = kept.filter((id) => cards[id].sim.isLand).length;
    if (kept.length >= 7) return free ? n >= 3 && n <= 5 : n >= 2 && n <= 5;
    return n >= 2 && n <= 4;
  };

  for (let g = 0; g < games; g++) {
    // One stream per game, so decks a slot apart share games (game-seed.ts).
    const rand = mulberry32(gameSeed(seed, g));
    lands = [];
    sources = [];
    treasures = 0;
    cmdCast = commanders.map(() => false);
    legendaryInPlay = false;
    srcCount.fill(0);
    handPips.fill(0);

    // Mulligans: a free one first (multiplayer), then counted ones.
    let mulls = 0;
    let freeLeft = freeMulligan;
    for (let attempt = 0; ; attempt++) {
      order = shuffle(libraryIds, rand);
      const seven = order.slice(0, 7);
      const last = mulls >= depth;
      let kept: number[];
      let bottomed: number[];
      let keeps: boolean;
      if (mode === 'app') {
        keeps = last || isKeepableHand(seven.map((id) => cards[id].sim));
        ({ kept, bottomed } = bottom(seven, keeps ? mulls : 0));
      } else {
        ({ kept, bottomed } = bottom(seven, mulls));
        keeps = last || karstenKeeps(kept, freeLeft && attempt === 0);
      }
      if (keeps) {
        hand = kept;
        order = [...order.slice(7), ...bottomed];
        ptr = 0;
        if (attempt === 0) keep7++;
        break;
      }
      if (freeLeft) freeLeft = false;
      else mulls++;
    }
    keptSizeSum += hand.length;
    keptSizes[hand.length] = (keptSizes[hand.length] ?? 0) + 1;
    libCount.set(deckCount);
    for (const id of hand) {
      libCount[id]--;
      addHandPips(id, 1);
    }
    let drops = 0;

    for (let turn = 1; turn <= maxTurn; turn++) {
      const newFrom = hand.length;
      if ((turn > 1 || drawOnTurnOne) && ptr < order.length) {
        const id = order[ptr++];
        libCount[id]--;
        hand.push(id);
        addHandPips(id, 1);
      }

      // Castability of every cost whose turn this is, held hypothetically.
      if (onAt[turn].length || nextAt[turn].length) {
        buildDropSupply(turn, drops, newFrom);
        for (const sid of onAt[turn]) measure(sid, true);
        for (const sid of nextAt[turn]) measure(sid, false);
      }

      // The land drop: a real land if one is in hand; an MDFC only when no real
      // land is and its spell side can't be cast this turn anyway. Best is
      // what it lets you cast now, then a tapland when that costs nothing,
      // then the colors the deck needs most.
      // One-turn greedy sequencing, no plan for next turn's curve.
      // It moves the mana and screw stats, never the per-card castability
      // (that re-chooses the drops). Add lookahead if the mana curve reads low.
      let pool = buildPool(turn);
      base = pool.map((u) => u.mask);
      phase++;
      const hasRealLand = hand.some((id) => cards[id].landCard);
      // A Karoo with nothing to return returns itself: a wasted drop unless
      // it is the only land there is.
      const hasOtherThanKaroo = hand.some((id) => cards[id].landCard && !faceOf(id).bounce);
      let choice = -1;
      let bestKey = [-3, -1, -1];
      for (const id of hand) {
        const c = cards[id];
        if (!c.land || tried[id] === phase) continue;
        tried[id] = phase;
        if (!c.landCard && (hasRealLand || (c.cost && canPay(c.cost, base)))) continue;
        if (c.land.bounce && lands.length === 0 && hasOtherThanKaroo) continue;
        const units = unitsIfPlayed(id);
        const key = [
          castNow(units),
          units.length === 0 && landReach[id] !== 0 ? 1 : 0,
          colourValue(landReach[id]) + (c.land.entry.kind === 'fast' && units.length ? 0.001 : 0),
        ];
        if (beats(key, bestKey)) {
          choice = id;
          bestKey = key;
        }
      }

      if (choice >= 0) {
        hand.splice(hand.indexOf(choice), 1);
        addHandPips(choice, -1);
        drops++;
        hit[turn]++;
        const face = faceOf(choice);
        if (face.fetch) {
          const t = pickTarget(face.fetch, true);
          if (t >= 0) {
            const untapped = searchUntapped(face.fetch, t);
            removeFromLibrary(t);
            putLand(t, untapped ? turn : turn + 1, true);
          }
        } else {
          const untapped = !face.bounce && entersUntapped(face, choice);
          putLand(choice, untapped ? turn : turn + 1, true);
          if (face.bounce) {
            // A Karoo returns a land: the least useful other one, else itself.
            const other = worstLand(lands.length - 1);
            const back = other >= 0 ? other : lands.length - 1;
            noteSource(lands[back].units, -1);
            hand.push(lands[back].card);
            lands.splice(back, 1);
          }
        }
        pool = buildPool(turn);
      }

      manaSum[turn] += pool.length;
      if (pool.length >= turn) manaAtLeast[turn]++;

      // Spend: ramp first (cheapest), then the commanders, then the biggest spell.
      // Casting a spell does nothing but spend mana; card draw is not
      // modeled, so a draw-heavy deck's land drops read low. Feed a draw role
      // through (like simulateAssemblyClock's +2) if that bias matters.
      for (;;) {
        const work = pool.map((u) => u.mask);
        let pick = -1;
        let pickRank = Infinity;
        for (let h = 0; h < hand.length; h++) {
          const c = cards[hand[h]];
          if (!c.cost || c.landCard) continue;
          const rank = c.ramp ? c.cost.units : 1000 - c.cost.mv;
          if (rank < pickRank && canPay(c.cost, work)) {
            pick = h;
            pickRank = rank;
          }
        }
        let pickCmd = -1;
        if (pickRank >= 1000) {
          for (let i = 0; i < commanders.length && pickCmd < 0; i++) {
            const cost = commanders[i].cost;
            if (!cmdCast[i] && cost && canPay(cost, work)) pickCmd = i;
          }
        }
        if (pick < 0 && pickCmd < 0) break;
        const card = pickCmd >= 0 ? commanders[pickCmd] : cards[hand[pick]];
        for (const u of allocate(card.cost as ManaCost, pool) as number[]) {
          if (pool[u].spend === 1) treasures--;
          else if (pool[u].spend === 2) sources[pool[u].source].left--;
          pool[u] = SPENT;
        }
        let kept = 0;
        for (const u of pool) if (u !== SPENT) pool[kept++] = u;
        pool.length = kept;
        if (pickCmd >= 0) cmdCast[pickCmd] = true;
        else {
          addHandPips(hand[pick], -1);
          hand.splice(pick, 1);
        }
        if (card.legendaryCreature) legendaryInPlay = true;

        const ramp = card.ramp;
        if (!ramp) continue;
        if (ramp.kind === 'source') {
          const units = resolveChoice(ramp.units, ramp.choice);
          const idx = sources.length;
          sources.push({
            units,
            ready: turn + ramp.delay,
            oneShot: ramp.oneShot,
            left: units.length,
          });
          noteSource(units, 1);
          if (ramp.delay === 0) {
            for (const u of units) pool.push({ mask: u, spend: ramp.oneShot ? 2 : 0, source: idx });
          }
        } else if (ramp.kind === 'search') {
          if (ramp.sacrificeLand && lands.length > 0) {
            const gone = worstLand(-1);
            noteSource(lands[gone].units, -1);
            lands.splice(gone, 1);
          }
          for (const u of resolveSearch(ramp.search, turn))
            pool.push({ mask: u, spend: 0, source: -1 });
        } else {
          treasures += ramp.count;
          for (let k = 0; k < ramp.count; k++) pool.push({ mask: ANY_COLOR, spend: 1, source: -1 });
        }
      }

      landsInPlaySum[turn] += lands.length;
      if (drops >= turn) onCurveDrops[turn]++;
      if (turn === 3 && drops < 3) missed3++;
      if (turn === 4 && drops < 4) missed4++;
      if (turn === FLOOD_TURN) {
        const stuck = hand.filter((id) => cards[id].landCard).length;
        if (stuck >= FLOOD_SURPLUS) {
          surplusCount++;
          if (!hand.some((id) => isSpell(cards[id]))) floodCount++;
        }
      }
    }
  }

  // ── Results ───────────────────────────────────────────────────────────────
  const perTurn = (a: Float64Array): number[] => Array.from(a, (v, i) => (i === 0 ? 0 : v / games));
  const rateOf = (n: number, d: number): number | null => (d > 0 ? n / d : null);

  const castRow = (name: string, cost: ManaCost, sid: number, n: number): CardCastability => {
    const s = costStats[sid];
    const measuredOn = s.onTurn <= maxTurn;
    const measuredNext = s.onTurn + 1 <= maxTurn;
    const shortBy: Partial<Record<ManaSymbol, number>> = {};
    for (let b = 0; b < 6; b++) {
      if (s.short[b] > 0) shortBy[MANA_SYMBOLS[b]] = s.short[b] / s.onEnough;
    }
    return {
      name,
      mv: cost.mv,
      cost: cost.text,
      copies: n,
      karstenBar: karstenBar(cost.mv),
      onCurve: measuredOn ? s.on / games : null,
      onCurveGivenMana: measuredOn ? rateOf(s.on, s.onEnough) : null,
      nextTurn: measuredNext ? s.next / games : null,
      nextTurnGivenMana: measuredNext ? rateOf(s.next, s.nextEnough) : null,
      shortBy,
    };
  };

  const rows: CardCastability[] = [];
  for (const [id, n] of copies) {
    if (cardCost[id] >= 0)
      rows.push(castRow(cards[id].name, cards[id].cost as ManaCost, cardCost[id], n));
  }
  rows.sort(
    (a, b) => (a.onCurve ?? 2) - (b.onCurve ?? 2) || a.mv - b.mv || a.name.localeCompare(b.name)
  );

  const mean = (pick: (r: CardCastability) => number | null): number | null => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v === null) continue;
      sum += v * r.copies;
      n += r.copies;
    }
    return n > 0 ? sum / n : null;
  };
  let measured = 0;
  let below = 0;
  for (const r of rows) {
    if (r.onCurve === null) continue;
    measured += r.copies;
    if (r.onCurveGivenMana !== null && r.onCurveGivenMana < r.karstenBar) below += r.copies;
  }

  const keptSizeShare: Record<number, number> = {};
  for (const [size, n] of Object.entries(keptSizes)) keptSizeShare[Number(size)] = n / games;

  return {
    games,
    seed,
    maxTurn,
    mulligan: { keepRate7: keep7 / games, avgKeptSize: keptSizeSum / games, keptSizeShare },
    landDrops: {
      hitRate: perTurn(hit),
      onCurveRate: perTurn(onCurveDrops),
      avgLandsInPlay: perTurn(landsInPlaySum),
    },
    screw: { missedDropBy3: missed3 / games, missedDropBy4: missed4 / games },
    flood: { rate: floodCount / games, surplusLands: surplusCount / games },
    mana: { average: perTurn(manaSum), atLeastTurn: perTurn(manaAtLeast) },
    castability: {
      onCurve: mean((r) => r.onCurve),
      onCurveGivenMana: mean((r) => r.onCurveGivenMana),
      nextTurn: mean((r) => r.nextTurn),
      nextTurnGivenMana: mean((r) => r.nextTurnGivenMana),
      measured,
      belowKarstenBar: below,
    },
    commanders: commanders.flatMap((c, i) =>
      c.cost ? [castRow(c.name, c.cost, commanderCost[i], 1)] : []
    ),
    cards: rows,
  };
}
