// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  cutNames,
  feedNames,
  refusalBucket,
  shadowMarkdown,
  shadowNumbers,
} from './coachShadowReport';
import type { CompactScore, ShadowRecord, ShadowRow } from './coachShadow';

const scored = (accepted: boolean, delta: number, refusal: string | null = null): CompactScore => ({
  status: 'scored',
  kind: 'swap',
  tier: 'fast',
  accepted,
  delta,
  required: 0.3,
  refusal,
  move: { out: ['Old'], in: ['New'] },
  topTerms: [['quality', delta]],
});
const row = (
  surface: ShadowRow['surface'],
  position: number,
  name: string,
  score: CompactScore
): ShadowRow => ({
  position,
  surface,
  lane: 'upgrade',
  type: surface === 'cuts' ? 'cut' : 'add',
  name,
  inName: null,
  tier: 3,
  inclusion: null,
  score,
});
const unscored: CompactScore = { status: 'unscored', reason: 'card-unresolved' };

const rec: ShadowRecord = {
  corpus: 'bench',
  group: 'g',
  deck: 'd',
  objective: 'ok',
  pageRows: 300,
  scoreMs: 10,
  deckSize: 99,
  labels: { weak: ['Weak B'], missing: ['Add C'], lostPremium: [] },
  rows: [
    row('feed', 0, 'Add A', scored(false, 0.1, 'gains 0.10 < 0.30')),
    row('feed', 1, 'Add B', unscored),
    row('feed', 2, 'Add C', scored(true, 1.2)),
    row('cuts', 0, 'Weak A', scored(false, -0.4, 'Weak A is a staple of this commander')),
    row('cuts', 1, 'Weak B', scored(true, 0.9)),
  ],
};

describe('the shadow orders', () => {
  it('puts accepted rows first by gain, then refused, then unscored, and drops refused for the drop order', () => {
    expect(feedNames(rec, 'legacy')).toEqual(['Add A', 'Add B', 'Add C']);
    expect(feedNames(rec, 'objective')).toEqual(['Add C', 'Add A', 'Add B']);
    expect(feedNames(rec, 'objective-drop')).toEqual(['Add C', 'Add B']);
    expect(cutNames(rec, 'objective')).toEqual(['Weak B', 'Weak A']);
  });

  it('buckets a refusal without the card names or numbers', () => {
    expect(refusalBucket(rec.rows[0])).toBe('gain below the margin');
    expect(refusalBucket(rec.rows[3])).toBe('<card> is a staple of this commander');
  });
});

describe('shadowNumbers', () => {
  const n = shadowNumbers([rec, { ...rec, objective: 'no-page', labels: undefined, rows: [] }]);

  it('counts rows, refusals and why', () => {
    expect(n.rows).toEqual({ total: 5, scored: 4, unscored: 1, accepted: 2, refused: 2 });
    expect(n.shown.refused).toBe(2);
    expect(n.shown.refusedByReason).toEqual({
      'gain below the margin': 1,
      '<card> is a staple of this commander': 1,
    });
    expect(n.noObjective).toEqual({ 'no-page': 1 });
  });

  it('measures the objective order against the labels, higher where it surfaces the labelled card', () => {
    // Legacy has Add C third, so R@1-style recall at 5 is 1 either way; precision of the cut list is what moves.
    expect(n.cutPrecision.legacy.p5.mean).toBeCloseTo(0.5);
    expect(n.cutPrecision.objective.p5.mean).toBeCloseTo(0.5);
    expect(n.cutPrecision['objective-drop'].p5.mean).toBeCloseTo(1);
    expect(n.addRecall['named missing'].objective.r5.mean).toBe(1);
  });

  it('renders a report that names the rows', () => {
    const md = shadowMarkdown('t', n);
    expect(md).toContain('Refusals among the rows a user sees');
    expect(md).toContain('Weak A');
  });
});
