/**
 * Frontend binding for the shared bracket estimator.
 *
 * The estimator itself moved to the zero-dependency `@spellcontrol/deck-metrics`
 * package so the backend can run it too (the AI `check_bracket` tool needs to
 * verify that a proposed cut actually moved the bracket, rather than take the
 * model's word for it). Do NOT add estimator logic here — edit
 * `packages/deck-metrics/src/index.ts`.
 *
 * What this file is for: the package takes tag membership as a `TagLookup`
 * parameter instead of importing the tagger client, because that client lazily
 * `fetch`es its data into a module-global that is simply null on a server — the
 * predicates would return `false` everywhere and silently mis-score every deck.
 * This module binds the frontend's tagger client once, so all ~15 existing call
 * sites keep their original signatures and nothing else in the app changes.
 */
import {
  estimateBracket as estimateBracketCore,
  isMassLandDenialFloor as isMassLandDenialFloorCore,
  isTutor as isTutorCore,
  type BracketEstimation,
  type DetectedCombo as DeckMetricsCombo,
  type TagLookup,
} from '@spellcontrol/deck-metrics';
import {
  hasTag,
  getCardRole,
  isMassLandDenial,
  isExtraTurn,
} from '@/deck-builder/services/tagger/client';

export {
  BRACKET_LABELS,
  bracketLabel,
  isStaxPiece,
  isGameChangerCard,
  isFastMana,
  type BracketEstimation,
  type BracketFloor,
  type BracketBreakdown,
  type TagLookup,
} from '@spellcontrol/deck-metrics';

/**
 * The app's tagger client, adapted to the package's injection point.
 *
 * ⚠️ These MUST stay wrapped in arrows rather than passed as shorthand
 * (`{ hasTag, getCardRole }`). Shorthand dereferences each export when this
 * module is first imported, and several suites elsewhere mock the tagger client
 * partially — `vi.mock(..., importOriginal)` returning only the handful of
 * exports they care about. Under shorthand those suites die at import time with
 * `No "hasTag" export is defined on the mock`, even when they never estimate a
 * bracket (7 test files did exactly that). Wrapping keeps the lookup lazy, which
 * is how the estimator behaved before it moved into the package.
 */
const taggerLookup: TagLookup = {
  hasTag: (name, tag) => hasTag(name, tag),
  getCardRole: (name) => getCardRole(name),
  isMassLandDenial: (name) => isMassLandDenial(name),
  isExtraTurn: (name) => isExtraTurn(name),
};

export function estimateBracket(
  allCardNames: string[],
  detectedCombos: DeckMetricsCombo[] | undefined,
  averageCmc: number,
  deckScore: number | undefined,
  roleCounts: Record<string, number> | undefined,
  gameChangerNames: Set<string>
): BracketEstimation {
  return estimateBracketCore(
    allCardNames,
    detectedCombos,
    averageCmc,
    deckScore,
    roleCounts,
    gameChangerNames,
    taggerLookup
  );
}

export function isMassLandDenialFloor(name: string): boolean {
  return isMassLandDenialFloorCore(name, taggerLookup);
}

export function isTutor(name: string): boolean {
  return isTutorCore(name, taggerLookup);
}
