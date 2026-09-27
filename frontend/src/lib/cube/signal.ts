// The cube generator's notion of "good card": CubeCobra's per-card cube
// popularity (the share of its ~400k cubes that hold the card) and draft Elo,
// shipped as `public/cube-signal.json` by scripts/refresh-cube-signal.mjs.
//
// EDHREC rank is Commander popularity — ranked by it, a draft cube's colorless
// section fills with Command Tower and Arcane Signet (board E288). The signal
// here is what cube builders actually pick; `rank` stays only as the fallback
// for cards CubeCobra has never seen (see `byQuality` / `rawPower`).
//
// Same shape as the tagger client: one lazy fetch per session, a Map lookup
// after, and a missing/failed snapshot degrades to "no signal" rather than
// blocking a build. The file is a public asset, so the native bundle carries it
// offline like tagger-tags.json.
//
// Pauper/peasant scope: a pauper or peasant pool (Rarity filter, pool-filters.ts)
// needs "good card" to mean "what that pool's builders actually play", not
// "what all ~400k cubes play, dominated by power/legacy/vintage" — a pauper
// staple like Kor Skyfisher ranks hundreds to thousands of places worse than
// it should by the all-cube number alone. `public/cube-signal-{pauper,peasant}.json`
// (scripts/refresh-cube-signal-budget.mjs) hold a per-card play-share WITHIN a
// ~2,300-2,700-card mined corpus of well-regarded public pauper/peasant cubes.
// A scoped read substitutes that corpus share for `cubePop` when the card is
// in the corpus; a card the corpus never saw keeps the all-cube number instead
// of looking unranked, and `cubeElo` (the all-cube "polish" tiebreak) is
// untouched either way — there's no per-scope Elo to duplicate it with.
//
// Scope is an explicit parameter everywhere, never module-level state: a page
// can have two consumers wanting different scopes at once (the Cards tab's
// pool vs the Shopping tab's candidate walk, or two build sheets), and a
// shared "current scope" would let whichever call ran last silently decide
// how the other reads. `loadCubeSignal(scope)` only fetches; every reader
// (`cubeSignalOf`, `hasCubeSignal`, the ranked-name walks) takes its own
// `scope` argument instead.
import { logger } from '@/lib/logger';
import type { RarityCap } from './pool-filters';

export interface CubeSignal {
  /** Share of CubeCobra cubes holding the card, in percent (Lightning Bolt ≈ 26). */
  cubePop: number;
  /** CubeCobra draft Elo (≈1200 filler … ≈2400 Power). */
  cubeElo: number;
}

interface SignalFile {
  generatedAt: string;
  cards: Record<string, [pop: number, elo: number]>;
}

/** A scoped corpus snapshot: one play-share number per card, no Elo. */
interface ScopedSignalFile {
  generatedAt: string;
  cards: Record<string, number>;
}

type Scope = Exclude<RarityCap, 'any'>;

const SIGNAL_URL = '/cube-signal.json';
const SCOPED_SIGNAL_URL: Record<Scope, string> = {
  pauper: '/cube-signal-pauper.json',
  peasant: '/cube-signal-peasant.json',
};

let cards: Map<string, CubeSignal> | null = null;
let loading: Promise<void> | null = null;
/** Memoized `[...cards]` sorted by popularity — built once per load, not per call. */
let ranked: string[] | null = null;

/** Loaded corpus snapshots, one per scope, kept for the session once fetched. */
const scoped = new Map<Scope, Map<string, number>>();
const scopedLoading = new Map<Scope, Promise<void>>();
/** Memoized `[...scoped]` sorted by corpus play-share, one per scope. */
const rankedScoped = new Map<Scope, string[]>();

/** CubeCobra keys a double-faced card by its front face. */
const frontFace = (name: string) => name.split(' // ')[0].trim();

function loadAllCubeSignal(): Promise<void> {
  if (cards) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(SIGNAL_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error("Couldn't load the cube signal snapshot.");
      const data = (await res.json()) as SignalFile;
      const next = new Map<string, CubeSignal>();
      for (const [name, [cubePop, cubeElo]] of Object.entries(data.cards ?? {})) {
        next.set(name, { cubePop, cubeElo });
      }
      cards = next;
      logger.debug(`[CubeSignal] Loaded ${next.size} cards (generated ${data.generatedAt})`);
    } catch (err) {
      logger.warn('[CubeSignal] Failed to load — cube ranking falls back to EDHREC rank:', err);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function loadScopedSignal(scope: Scope): Promise<void> {
  if (scoped.has(scope)) return Promise.resolve();
  const inFlight = scopedLoading.get(scope);
  if (inFlight) return inFlight;
  const next = (async () => {
    try {
      const res = await fetch(SCOPED_SIGNAL_URL[scope], { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Couldn't load the ${scope} cube signal snapshot.`);
      const data = (await res.json()) as ScopedSignalFile;
      const byName = new Map<string, number>();
      for (const [name, pop] of Object.entries(data.cards ?? {})) byName.set(name, pop);
      scoped.set(scope, byName);
      logger.debug(
        `[CubeSignal] Loaded ${byName.size} ${scope} corpus cards (generated ${data.generatedAt})`
      );
    } catch (err) {
      logger.warn(
        `[CubeSignal] Failed to load the ${scope} corpus — falls back to the all-cube signal:`,
        err
      );
    } finally {
      scopedLoading.delete(scope);
    }
  })();
  scopedLoading.set(scope, next);
  return next;
}

/**
 * Fetch the snapshot(s) for `scope` once; safe to call repeatedly (dedupes in
 * flight, and a previously loaded scope resolves immediately). Loading only —
 * it does not change how any reader below behaves; each takes its own `scope`.
 */
export function loadCubeSignal(scope: RarityCap = 'any'): Promise<void> {
  const base = loadAllCubeSignal();
  if (scope === 'any') return base;
  return Promise.all([base, loadScopedSignal(scope)]).then(() => {});
}

/**
 * The card's cube signal, or an empty object when unknown or not yet loaded —
 * spread it onto a CubeCard. CubeCobra names a double-faced card by its front
 * face, so `Bonecrusher Giant // Stomp` is looked up as `Bonecrusher Giant`.
 * Under a pauper/peasant `scope`, a card the mined corpus has seen gets its
 * corpus play-share in place of `cubePop`; a card the corpus never saw keeps
 * the all-cube number. `scope` defaults to 'any' (the plain all-cube signal)
 * so an unscoped call site is unchanged.
 */
export function cubeSignalOf(name: string, scope: RarityCap = 'any'): Partial<CubeSignal> {
  const base = cards?.get(name) ?? cards?.get(frontFace(name));
  if (scope === 'any') return base ?? {};
  const corpus = scoped.get(scope);
  const corpusPop = corpus?.get(name) ?? corpus?.get(frontFace(name));
  return corpusPop != null ? { ...base, cubePop: corpusPop } : (base ?? {});
}

/** Whether `scope`'s signal has loaded — 'any' checks the all-cube snapshot,
 *  a pauper/peasant scope checks that corpus specifically (it can fail to
 *  load independently of the all-cube signal). */
export function hasCubeSignal(scope: RarityCap = 'any'): boolean {
  return scope === 'any' ? cards !== null : scoped.has(scope);
}

/**
 * Every known card name, most-popular first (ties broken by Elo) — the
 * shopping list's candidate source: names a real cube builder would reach
 * for, walked in popularity order until enough survive ownership/format
 * filtering. Empty until the snapshot loads.
 */
export function rankedCubeSignalNames(): string[] {
  if (!cards) return [];
  if (!ranked) {
    ranked = [...cards.entries()]
      .sort(([, a], [, b]) => b.cubePop - a.cubePop || b.cubeElo - a.cubeElo)
      .map(([name]) => name);
  }
  return ranked;
}

/**
 * `rankedCubeSignalNames`'s pauper/peasant counterpart — candidate names from
 * the mined corpus ONLY, most-played first, so a pauper cube's shopping list
 * suggests pauper staples rather than the all-cube signal's rares/mythics.
 * Empty until `loadCubeSignal(scope)` has loaded that corpus.
 */
export function rankedScopedSignalNames(scope: Scope): string[] {
  const corpus = scoped.get(scope);
  if (!corpus) return [];
  let names = rankedScoped.get(scope);
  if (!names) {
    names = [...corpus.entries()].sort(([, a], [, b]) => b - a).map(([name]) => name);
    rankedScoped.set(scope, names);
  }
  return names;
}

/** Test-only: forget the loaded snapshot(s). */
export function resetCubeSignalForTests(): void {
  cards = null;
  loading = null;
  ranked = null;
  scoped.clear();
  scopedLoading.clear();
  rankedScoped.clear();
}
