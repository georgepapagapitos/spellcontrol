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
import { logger } from '@/lib/logger';

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

const SIGNAL_URL = '/cube-signal.json';

let cards: Map<string, CubeSignal> | null = null;
let loading: Promise<void> | null = null;

/** Fetch the snapshot once; safe to call repeatedly (deduplicates in flight). */
export function loadCubeSignal(): Promise<void> {
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

/**
 * The card's cube signal, or an empty object when unknown or not yet loaded —
 * spread it onto a CubeCard. CubeCobra names a double-faced card by its front
 * face, so `Bonecrusher Giant // Stomp` is looked up as `Bonecrusher Giant`.
 */
export function cubeSignalOf(name: string): Partial<CubeSignal> {
  if (!cards) return {};
  return cards.get(name) ?? cards.get(name.split(' // ')[0].trim()) ?? {};
}

export function hasCubeSignal(): boolean {
  return cards !== null;
}

/** Test-only: forget the loaded snapshot. */
export function resetCubeSignalForTests(): void {
  cards = null;
  loading = null;
}
