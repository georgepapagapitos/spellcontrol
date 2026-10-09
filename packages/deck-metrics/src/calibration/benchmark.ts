/**
 * Bracket calibration benchmark: the estimator measured against labeled real
 * decks, the way deck generation is measured against its panel.
 *
 * The corpus (`calibration/fixtures/corpus.json`, built by
 * `calibration/build-fixtures.mjs`) is frozen: decklists, per-card facts, the
 * Spellbook combos each deck completes or sits one card from, and the tag
 * memberships those cards carry. Nothing here touches the network, so the
 * numbers only move when the estimator does.
 *
 * Inputs are built the way the app builds them for a saved deck
 * (`buildEdhrecMissingResult` in commanderDeckAnalysis.ts, `check_bracket` in
 * backend/src/ai/bracket.ts): every card name including the commanders, the
 * average mana value of the non-land 99, counted roles over the non-land 99,
 * and the combos whose every piece is in the list.
 *
 * Labels, by set:
 *  - `precon`: max(Core, the Game Changer floor on the official list, Commander
 *    Spellbook's /estimate-bracket tag). The brackets name Core as where "the
 *    average modern-day preconstructed deck sits"; the October 2025 update
 *    decoupled precons from Core because some carry Game Changers or combos,
 *    and Spellbook's tag is the independent read of exactly that content. It
 *    is a floor from contents, not a read of how the list plays, so a precon
 *    that plays above Core with clean contents is labeled Core: the known
 *    limit of this label.
 *  - `cedh`: 5. Top-8 finishes at large cEDH events (EDHTop16).
 *  - `synthetic`: the bracket the official text (or, marked `heuristic`, a
 *    SpellControl rule the text leaves open) gives a real precon plus real cards.
 * ScrollVault's per-precon brackets ride along as a second opinion only.
 */
import {
  createTagLookup,
  estimateBracket,
  floorOf,
  SOFT_SCORE,
  type BracketEstimation,
  type DetectedCombo,
  type RoleKey,
} from '../index';

// ── Corpus shape ───────────────────────────────────────────────────────────

export interface CorpusDeck {
  id: string;
  set: string;
  name: string;
  url: string;
  commanders: string[];
  /** Main deck (commanders excluded): name → copies. */
  cards: Record<string, number>;
  label: number;
  labelSource: string;
  spellbook?: {
    tag: string;
    gameChangers: string[];
    landDenial: string[];
    extraTurns: string[];
    banned: string[];
    combos: string[];
  };
  scrollvault?: { bracket: number; url: string; why: string[] };
  /** Spellbook combo ids complete in the list. */
  combos: string[];
  /** Spellbook combo ids one card short. */
  oneAway: string[];
  /** Complete `--` combos whose unnamed-card requirement the list meets. */
  templatesSatisfied: string[];
}

export interface Corpus {
  meta: { gameChangers: { names: string[] } } & Record<string, unknown>;
  decks: CorpusDeck[];
  /** name → [mana value, is land (front face), counted role]. */
  cards: Record<string, [number, number, RoleKey | null]>;
  /** id → [Spellbook bracket tag, card count, pieces]. */
  combos: Record<string, [string | null, number, string[]]>;
  tags: Record<string, string[]>;
}

// ── Running the estimator on a corpus deck ─────────────────────────────────

export interface DeckState {
  cards: Record<string, number>;
  commanders: string[];
  combos: string[];
  templatesSatisfied: ReadonlySet<string>;
}

export interface Bench {
  corpus: Corpus;
  gameChangers: Set<string>;
  state(deck: CorpusDeck): DeckState;
  estimate(state: DeckState): BracketEstimation;
  /** The list with one copy of `out` replaced by `add`, combos re-derived. */
  swap(deck: CorpusDeck, state: DeckState, out: string, add: string): DeckState;
}

export function createBench(corpus: Corpus, gameChangers?: ReadonlySet<string>): Bench {
  const tags = createTagLookup(corpus.tags);
  const gc = new Set(gameChangers ?? corpus.meta.gameChangers.names);
  const oneAwayByPiece = new Map<CorpusDeck, Map<string, string[]>>();

  const fact = (name: string) => {
    const f = corpus.cards[name];
    if (!f) throw new Error(`calibration corpus has no facts for ${name}`);
    return f;
  };

  const detected = (s: DeckState): DetectedCombo[] =>
    s.combos.map((id) => {
      const [tag, n, pieces] = corpus.combos[id];
      return {
        comboId: id,
        cards: pieces,
        results: [],
        isComplete: true,
        missingCards: [],
        deckCount: 0,
        bracket: null,
        bracketTag: tag,
        cardCount: n,
        templatesSatisfied: s.templatesSatisfied.has(id),
      };
    });

  const piecesOneAway = (deck: CorpusDeck) => {
    let m = oneAwayByPiece.get(deck);
    if (m) return m;
    m = new Map();
    const inDeck = new Set([...deck.commanders, ...Object.keys(deck.cards)]);
    for (const id of deck.oneAway) {
      const missing = corpus.combos[id][2].find((p) => !inDeck.has(p));
      if (missing) m.set(missing, [...(m.get(missing) ?? []), id]);
    }
    oneAwayByPiece.set(deck, m);
    return m;
  };

  return {
    corpus,
    gameChangers: gc,
    state: (deck) => ({
      cards: deck.cards,
      commanders: deck.commanders,
      combos: deck.combos,
      templatesSatisfied: new Set(deck.templatesSatisfied),
    }),
    estimate(s) {
      const names: string[] = [];
      const roleCounts: Record<string, number> = {};
      let mvTotal = 0;
      let nonLand = 0;
      for (const [name, copies] of Object.entries(s.cards)) {
        for (let i = 0; i < copies; i++) names.push(name);
        const [mv, land, role] = fact(name);
        if (land) continue;
        mvTotal += mv * copies;
        nonLand += copies;
        if (role) roleCounts[role] = (roleCounts[role] ?? 0) + copies;
      }
      names.push(...s.commanders);
      const averageCmc = nonLand > 0 ? Number((mvTotal / nonLand).toFixed(2)) : 0;
      return estimateBracket(
        names,
        detected(s),
        averageCmc,
        undefined,
        roleCounts,
        gc,
        tags,
        s.commanders
      );
    },
    swap(deck, s, out, add) {
      const cards = { ...s.cards };
      if ((cards[out] ?? 0) <= 1) delete cards[out];
      else cards[out] -= 1;
      cards[add] = (cards[add] ?? 0) + 1;
      const gone = !(out in cards);
      const combos = s.combos.filter((id) => !gone || !corpus.combos[id][2].includes(out));
      for (const id of piecesOneAway(deck).get(add) ?? []) {
        if (!gone || !corpus.combos[id][2].includes(out)) combos.push(id);
      }
      return { ...s, cards, combos: [...new Set(combos)] };
    },
  };
}

// ── Agreement statistics ───────────────────────────────────────────────────

/** mulberry32: a seeded PRNG so every CI run draws the same resamples. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval {
  low: number;
  high: number;
}

/** Percentile bootstrap of a proportion (95%). Collapses to a point at 0% or
 *  100%, which is why {@link wilson} is reported beside it. */
export function bootstrapRate(
  hits: readonly boolean[],
  resamples: number,
  rand: () => number
): Interval {
  const n = hits.length;
  if (n === 0) return { low: 0, high: 0 };
  const rates: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let k = 0;
    for (let i = 0; i < n; i++) if (hits[Math.floor(rand() * n)]) k++;
    rates.push(k / n);
  }
  rates.sort((a, b) => a - b);
  const at = (q: number) => rates[Math.min(rates.length - 1, Math.floor(q * rates.length))];
  return { low: at(0.025), high: at(0.975) };
}

/** Wilson score interval (95%): honest at 0% and 100%, where the bootstrap isn't. */
export function wilson(k: number, n: number): Interval {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (c - m) / d), high: Math.min(1, (c + m) / d) };
}

export interface ClassAgreement {
  label: number;
  n: number;
  exact: number;
  rate: number;
  bootstrap: Interval;
  wilson: Interval;
}

export interface Agreement {
  n: number;
  exact: number;
  withinOne: number;
  exactBootstrap: Interval;
  perLabel: ClassAgreement[];
  /** confusion[label][predicted] = decks. */
  confusion: Record<number, Record<number, number>>;
}

export function agreement(
  rows: readonly { label: number; predicted: number }[],
  opts: { resamples?: number; seed?: number } = {}
): Agreement {
  const rand = seededRandom(opts.seed ?? 20260929);
  const resamples = opts.resamples ?? 2000;
  const confusion: Record<number, Record<number, number>> = {};
  for (const r of rows) {
    const row = (confusion[r.label] ??= {});
    row[r.predicted] = (row[r.predicted] ?? 0) + 1;
  }
  const labels = [...new Set(rows.map((r) => r.label))].sort((a, b) => a - b);
  const perLabel = labels.map((label) => {
    const hits = rows.filter((r) => r.label === label).map((r) => r.predicted === label);
    const exact = hits.filter(Boolean).length;
    return {
      label,
      n: hits.length,
      exact,
      rate: exact / hits.length,
      bootstrap: bootstrapRate(hits, resamples, rand),
      wilson: wilson(exact, hits.length),
    };
  });
  const hits = rows.map((r) => r.predicted === r.label);
  return {
    n: rows.length,
    exact: hits.filter(Boolean).length,
    withinOne: rows.filter((r) => Math.abs(r.predicted - r.label) <= 1).length,
    exactBootstrap: bootstrapRate(hits, resamples, rand),
    perLabel,
    confusion,
  };
}

// ── Why a deck reads where it does ─────────────────────────────────────────

export type FloorKind =
  | 'game-changers'
  | 'land-denial'
  | 'commander-combo'
  | 'early-combo'
  | 'rated-combo'
  | 'late-combo'
  | 'extra-turns'
  | 'stax';

/** The kind of a hard floor, read from its reason. `null` is a floor this
 *  classifier doesn't know: the benchmark test fails on it, so a new floor
 *  can't slip past the disagreement buckets unnamed. */
export function floorKind(reason: string): FloorKind | null {
  if (/Game Changer/.test(reason)) return 'game-changers';
  if (/^Mass land denial/.test(reason)) return 'land-denial';
  if (/with your commander/.test(reason)) return 'commander-combo';
  if (/^Commander Spellbook rates/.test(reason)) return 'rated-combo';
  if (/\((fast assembly|highly redundant)\)|fast two-card combo/.test(reason)) return 'early-combo';
  if (/(two-card|multi-card) combo/.test(reason)) return 'late-combo';
  if (/extra turn/.test(reason)) return 'extra-turns';
  if (/stax/.test(reason)) return 'stax';
  return null;
}

/** What set the bracket: the top floor's kind, the power signal, or Core. */
export function driver(est: BracketEstimation): FloorKind | 'power' | 'baseline' {
  if (est.bracket > floorOf(est.hardFloors)) return 'power';
  const top = [...est.hardFloors].sort((a, b) => b.bracket - a.bracket)[0];
  return top ? (floorKind(top.reason) ?? 'late-combo') : 'baseline';
}

/**
 * A disagreement's cause, as a bucket name. `ours` is what the estimator read,
 * `theirs` the label (or second opinion) it disagrees with.
 */
export function disagreementCause(
  deck: CorpusDeck,
  est: BracketEstimation,
  theirs: number,
  source: 'label' | 'scrollvault' = 'label'
): string {
  const ours = est.bracket;
  const by = driver(est);
  const b = est.breakdown;
  if (deck.set === 'synthetic') return `rule drift: ${deck.name}`;
  if (theirs === 5 && ours < 5) {
    if (floorOf(est.hardFloors) < 4) return 'cEDH: no Bracket 4 floor';
    if (b.gameChangerCount < SOFT_SCORE.cedhMinGameChangers) {
      return `cEDH: under ${SOFT_SCORE.cedhMinGameChangers} Game Changers`;
    }
    return `cEDH: power signal under ${SOFT_SCORE.cedhAt}`;
  }
  if (theirs === 1) return 'Bracket 1 is intent: never inferred from a list';
  if (source === 'scrollvault') {
    const why = deck.scrollvault?.why.join(' ') ?? '';
    if (ours > theirs) {
      if (by === 'commander-combo')
        return 'commander combo: we floor 4 (Spellbook R), ScrollVault does not';
      if (by === 'land-denial') return 'land denial ruling: we floor 4, ScrollVault does not';
      if (by === 'late-combo') return 'a combo Spellbook rates S/P that ScrollVault discounts';
      return `we read higher (${by})`;
    }
    if (/optimization score/.test(why)) return 'ScrollVault optimization score; no floor here';
    if (/Two-card infinite combo/.test(why)) {
      return 'ScrollVault floors a two-card combo Spellbook rates Core/Exhibition';
    }
    return `we read lower (${by})`;
  }
  const sb = deck.spellbook;
  if (sb?.tag === 'B') return 'banned card: Spellbook gives no bracket';
  if (ours > theirs) {
    if (by === 'land-denial') {
      const extra = b.massLandDenialNames.filter((n) => !sb?.landDenial.includes(n));
      return sb && extra.length
        ? 'land denial: we flag a card Spellbook does not'
        : 'land-denial floor';
    }
    return by === 'power' ? 'power signal bump' : `${by} floor`;
  }
  if (sb) {
    if (sb.gameChangers.some((n) => !b.gameChangerNames.includes(n))) return 'Game Changer we miss';
    if (sb.landDenial.some((n) => !b.massLandDenialNames.includes(n))) {
      return 'land denial Spellbook flags and we do not';
    }
    return 'a combo Spellbook counts and we do not';
  }
  if (by === 'baseline') return 'no Game Changer, combo or land denial: reads Core (the known gap)';
  return `reads lower through its ${by === 'power' ? 'power signal' : `${by} floor`}`;
}

// ── Stability: one-card swaps ──────────────────────────────────────────────

export interface Violation {
  deck: string;
  out: string;
  add: string;
  kind: 'unnamed-floor-move' | 'bracket-jump' | 'soft-step';
  before: { bracket: number; floor: number; soft: number; floors: string[] };
  after: { bracket: number; floor: number; soft: number; floors: string[] };
}

export interface StabilityResult {
  swaps: number;
  /** Swaps whose bracket moved, by what moved it. */
  moves: Record<string, number>;
  /** Largest power-signal change one swap made where no floor moved. */
  maxSoftStep: number;
  violations: Violation[];
}

type FloorGroup = 'game-changers' | 'land-denial' | 'extra-turns' | 'stax' | 'combo';

const groupOf = (k: FloorKind): FloorGroup =>
  k === 'game-changers' || k === 'land-denial' || k === 'extra-turns' || k === 'stax' ? k : 'combo';

/** The strongest floor of each group. */
function floorsByGroup(est: BracketEstimation): Map<FloorGroup, number> {
  const m = new Map<FloorGroup, number>();
  for (const f of est.hardFloors) {
    const g = groupOf(floorKind(f.reason) ?? 'late-combo');
    m.set(g, Math.max(m.get(g) ?? 0, f.bracket));
  }
  return m;
}

/** The cards a group's floor names or rests on: a swap may move that floor
 *  only through one of them. A combo floor's speed rests on tutors and fast
 *  mana, so those count for it. */
function evidence(est: BracketEstimation, g: FloorGroup): Set<string> {
  const b = est.breakdown;
  switch (g) {
    case 'game-changers':
      return new Set(b.gameChangerNames);
    case 'land-denial':
      return new Set(b.massLandDenialNames);
    case 'extra-turns':
      return new Set(b.extraTurnNames);
    case 'stax':
      return new Set(b.staxPieceNames);
    case 'combo':
      return new Set([...(b.comboPieceNames ?? []), ...b.tutorNames, ...b.fastManaNames]);
  }
}

/**
 * The most one swap can move the power signal without moving a floor: the
 * card out and the card in each carry at most one fast-mana or tutor bonus
 * (a card is never both), the combo-engine term moves by at most its cap,
 * each side changes interaction by one card's share, and the curve term by
 * one card of the largest mana value the corpus holds over a 63-card
 * non-land deck. The stability scan gates the observed step on this.
 */
export function swapSoftStepBound(maxManaValue = 16): number {
  const s = SOFT_SCORE;
  const interactionPerCard = s.interactionCap / ((0.22 - 0.1) * 63);
  const curvePerCard = (maxManaValue / 63) * s.curvePer;
  return Math.ceil(
    Math.max(s.fastManaPer, s.tutorPer) + s.engineCap + 2 * interactionPerCard + curvePerCard
  );
}

const snap = (e: BracketEstimation) => ({
  bracket: e.bracket,
  floor: floorOf(e.hardFloors),
  soft: e.softScore,
  floors: e.hardFloors.map((f) => `B${f.bracket} ${f.reason}`),
});

/**
 * The stability property: replacing any one card of a real deck may move its
 * bracket only
 *  - through a hard floor that names the card taken out or the one put in:
 *    every floor group that moved (Game Changers, land denial, extra turns,
 *    stax, combos) must name one of the two cards as its evidence (a combo
 *    floor also rests on the tutors and fast mana behind its speed), or
 *  - by one bracket, through the power signal crossing `bumpAt` / `cedhAt`,
 *    with the power signal itself moving no more than {@link swapSoftStepBound}.
 * Anything else is a violation.
 */
export function stabilityScan(
  bench: Bench,
  deck: CorpusDeck,
  probes: readonly string[],
  opts: { oneAwayProbes?: boolean } = {}
): StabilityResult {
  const base = bench.state(deck);
  const before = bench.estimate(base);
  const inDeck = new Set([...deck.commanders, ...Object.keys(deck.cards)]);
  const adds = new Set(probes.filter((p) => !inDeck.has(p)));
  if (opts.oneAwayProbes !== false) {
    for (const id of deck.oneAway) {
      for (const p of bench.corpus.combos[id][2]) if (!inDeck.has(p)) adds.add(p);
    }
  }
  const result: StabilityResult = { swaps: 0, moves: {}, maxSoftStep: 0, violations: [] };
  const bFloor = floorOf(before.hardFloors);
  const bound = swapSoftStepBound();
  for (const out of Object.keys(deck.cards)) {
    for (const add of adds) {
      const after = bench.estimate(bench.swap(deck, base, out, add));
      result.swaps++;
      const aFloor = floorOf(after.hardFloors);
      const v = (kind: Violation['kind']) =>
        result.violations.push({
          deck: deck.id,
          out,
          add,
          kind,
          before: snap(before),
          after: snap(after),
        });
      if (aFloor === bFloor) {
        const step = Math.abs(after.softScore - before.softScore);
        result.maxSoftStep = Math.max(result.maxSoftStep, step);
        if (step > bound) v('soft-step');
      }
      if (after.bracket === before.bracket) continue;
      if (aFloor !== bFloor) {
        const was = floorsByGroup(before);
        const now = floorsByGroup(after);
        const moved = [...new Set([...was.keys(), ...now.keys()])]
          .filter((g) => (was.get(g) ?? 0) !== (now.get(g) ?? 0))
          .sort();
        const named = moved.every(
          (g) => evidence(before, g).has(out) || evidence(after, g).has(add)
        );
        const why = named ? `floor:${moved.join('+')}` : 'unnamed';
        result.moves[why] = (result.moves[why] ?? 0) + 1;
        if (!named) v('unnamed-floor-move');
      } else {
        result.moves.power = (result.moves.power ?? 0) + 1;
        if (Math.abs(after.bracket - before.bracket) > 1) v('bracket-jump');
      }
    }
  }
  return result;
}
