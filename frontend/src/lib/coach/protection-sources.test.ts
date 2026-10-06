// @vitest-environment node
//
// Guard (E540 S3): Coach's cut protections have ONE source,
// coach-protections.ts. T171 v4b showed what a second source costs: a rule that
// gave every combo a cut reopened every hole the other paths' own lists had
// closed (46/1/3 to 30/5/8). The paths used to keep their own copies of the
// same checks (premium cards, finishers, survival pieces, engine pieces, the
// missing-staple floor), and a copy always drifted: the excess cutter kept
// engine pieces but not finishers, the misfit pass kept neither.
//
// So no module on a Coach cut path reads those rules itself. It asks the set.
// A new path that needs a protection adds it to the set, where every path and
// the whole-deck objective (judgeMove) pick it up.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** The cut paths: every module that decides which card of a deck goes. */
const CUT_PATHS = [
  'lib/coach/intelligent-cuts.ts',
  'lib/coach/replace-cuts.ts',
  'lib/coach/card-fit.ts',
  'lib/coach/coach-changes.ts',
  'lib/coach/coach-objective.ts',
  'deck-builder/services/deckBuilder/commanderDeckAnalysis.ts',
  'deck-builder/services/deckBuilder/cardFit.ts',
  'deck-builder/services/deckBuilder/deckAnalyzer.ts',
  'deck-builder/services/deckBuilder/costAnalyzer.ts',
  'deck-builder/services/deckBuilder/bracketFit.ts',
];

/** The protection rules a path must not re-implement: each lives in the one set. */
const OWN_RULES: Array<[string, RegExp]> = [
  ['premium cards', /\b(?:isPremiumCard|premiumReason|premiumNames)\b/],
  ['survival pieces', /\bisSurvivalPiece\b/],
  ['finishers', /\bcountsAsFinisher\b/],
  ['engine pieces', /\bisLoadBearing\b/],
  ['the commander plan', /\bwhyCardMatches\b/],
  ['the missing-staple floor', /\bSTAPLE_INCLUSION\b|\bgapFloor\b/],
];

describe('Coach cut protections have one source', () => {
  it.each(CUT_PATHS)('%s keeps no protection list of its own', (rel) => {
    const src = read(rel);
    const own = OWN_RULES.filter(([, re]) => re.test(src)).map(([what]) => what);
    expect(own, `${rel} re-implements ${own.join(', ')}; add it to coach-protections.ts`).toEqual(
      []
    );
  });

  it('every cut path asks the set', () => {
    const asks: Record<string, RegExp> = {
      'lib/coach/intelligent-cuts.ts': /createCoachProtections\(/,
      'lib/coach/coach-objective.ts': /createCoachProtections\(/,
      'deck-builder/services/deckBuilder/commanderDeckAnalysis.ts': /createCoachProtections\(/,
    };
    for (const [rel, re] of Object.entries(asks)) expect(read(rel), rel).toMatch(re);
  });

  it('the whole-deck objective reads the same set through its context hook', () => {
    expect(read('lib/coach/coach-objective.ts')).toMatch(/extraProtections:\s*protection/);
    expect(read('deck-builder/services/deckBuilder/deckObjective/protections.ts')).toMatch(
      /ctx\.extraProtections/
    );
  });
});
