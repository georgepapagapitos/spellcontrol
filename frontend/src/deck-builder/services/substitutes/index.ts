/**
 * Substitute ranking v2 (E517) at runtime: loading the card facts it reads,
 * the signals it takes from the tagger and EDHREC's similar lists, and the
 * ranker entry points each suggestion surface calls (surfaces.ts).
 *
 * Off the boot path: nothing loads until a suggestion surface asks for it
 * (the Coach tab, or the card preview's Swap / Similar cards sections).
 * Until the facts arrive, or if they can't load, every surface keeps its v1
 * order, so a failed fetch costs nothing but the better ranking.
 */
import { frontFaceName } from '@/lib/card-text';
import { getCardFacts, hasCardFacts, loadCardFacts } from '../cardFacts';
import type { CardFacts } from '../cardFacts/schema';
import { getSimilarRank } from '../deckBuilder/cardSimilar';
import { getCardRole, getCardSubtype, getCardTags } from '../tagger/client';
import { deckProfile, type DeckProfile } from './deckContext';
import type { FeatureSources } from './features';

const listeners = new Set<() => void>();
let preparing: Promise<boolean> | null = null;

/**
 * Load what v2 needs (the card-facts snapshot). Safe to call on every render
 * path: one fetch per session, and a failure is retried on the next call.
 * Resolves true when v2 can rank.
 */
export function prepareSubstituteRanking(): Promise<boolean> {
  if (hasCardFacts()) return Promise.resolve(true);
  if (preparing) return preparing;
  preparing = loadCardFacts().then((ok) => {
    preparing = null;
    if (ok) for (const fn of listeners) fn();
    return ok;
  });
  return preparing;
}

/** Whether v2 can rank right now (the facts are loaded). */
export const substituteRankingReady = (): boolean => hasCardFacts();

/** Subscribe to v2 becoming ready (a useSyncExternalStore source). */
export function subscribeSubstituteRanking(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The signals v2 reads beyond the card facts. IDF is off at runtime: the eval
 * measured it inside noise (scripts/substitute-eval.mjs, "v2 with IDF") and it
 * would mean decoding all 32k records on the main thread.
 */
export const RUNTIME_SOURCES: FeatureSources = {
  idf: null,
  similarRank: (name) =>
    getSimilarRank(name) ?? (name.includes(' // ') ? getSimilarRank(frontFaceName(name)) : null),
  taggerRole: (name) => getCardRole(name),
  taggerSubtype: (name) => getCardSubtype(name),
  taggerTags: (name) => getCardTags(name),
};

/** Facts for each named card that has them (a card printed after the snapshot has none). */
export function factsFor(names: Iterable<string>): CardFacts[] {
  const out: CardFacts[] = [];
  for (const name of names) {
    const f = getCardFacts(name);
    if (f) out.push(f);
  }
  return out;
}

/** The deck's producer / payoff profile, without the card being replaced. */
export function deckProfileFor(deckNames: Iterable<string>, leaving?: string): DeckProfile {
  return deckProfile(factsFor(deckNames), leaving ? getCardFacts(leaving) : null);
}
