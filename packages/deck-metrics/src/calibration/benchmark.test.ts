/**
 * The bracket calibration benchmark's gates (see benchmark.ts for the corpus
 * and its labels). `npm run calibrate` prints the full report: agreement per
 * label with bootstrap and Wilson intervals, confusion matrices, every
 * disagreement by cause, and the stability scan. CALIBRATION_CORPUS points it
 * at a locally built corpus (owner-declared decks, never committed);
 * CALIBRATION_FULL=1 runs the stability scan over every one-away piece of
 * every deck (1.4M swaps, about a minute) instead of the CI sample.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateBracket, createTagLookup, HARDCODED_GAME_CHANGERS, SOFT_SCORE } from '../index';
import {
  agreement,
  bootstrapRate,
  createBench,
  disagreementCause,
  driver,
  floorKind,
  seededRandom,
  stabilityScan,
  swapSoftStepBound,
  wilson,
  type Corpus,
  type Violation,
} from './benchmark';
import { formatSet, reportScrollVault, reportSet, runCorpus, softHeadroom } from './report';

const fixture = (name: string) => new URL(`../../calibration/fixtures/${name}`, import.meta.url);
const corpus: Corpus = JSON.parse(
  fs.readFileSync(process.env.CALIBRATION_CORPUS ?? fixture('corpus.json'), 'utf8')
);
const synthetic = JSON.parse(fs.readFileSync(fixture('synthetic.json'), 'utf8')) as {
  probes: string[];
};

const bench = createBench(corpus, HARDCODED_GAME_CHANGERS);
const rows = runCorpus(bench, corpus.decks);
const REPORT = !!process.env.CALIBRATION_REPORT;
const FULL = !!process.env.CALIBRATION_FULL;
const disagreeing = (set: string) =>
  rows.filter((r) => r.deck.set === set && r.est.bracket !== r.deck.label).map((r) => r.deck.id);

/**
 * Known disagreements, each a decision rather than drift. A new one fails the
 * gate: fix the estimator, or add it here with the reason.
 */
const KNOWN_CEDH_MISSES = [
  // Mm'menon artifacts: ten fast-mana pieces but the fast-mana term caps at
  // five, two tutors, little interaction: power signal 70 against cedhAt 80.
  // Lowering cedhAt to fit one list is tuning, not a rule (2026-09-29).
  'edhtop16:summer-classic-3/77vpmG1KImfCQqdHk32rs6CbrlN2',
];

describe('bracket calibration benchmark', () => {
  it('prints the report on request', () => {
    const sets = [...new Set(corpus.decks.map((d) => d.set))];
    const out = [
      ...sets.map((s) => formatSet(reportSet(s, rows))),
      formatSet(reportScrollVault(rows)),
      `Highest precon power signal: ${JSON.stringify(softHeadroom(rows, 'precon'))} (bumpAt ${SOFT_SCORE.bumpAt})`,
    ].join('\n\n');
    if (REPORT) process.stdout.write(`\n${out}\n`);
    expect(out).toContain('## precon');
  });

  it('names the kind of every floor it raises', () => {
    for (const r of rows) {
      for (const f of r.est.hardFloors) expect(floorKind(f.reason), f.reason).not.toBeNull();
    }
  });

  it('gives every rule-defined case the bracket its rule states', () => {
    const misses = rows
      .filter((r) => r.deck.set === 'synthetic' && r.est.bracket !== r.deck.label)
      .map((r) => `${r.deck.name}: ${r.est.bracket}, rule says ${r.deck.label}`);
    expect(misses).toEqual([]);
  });

  it('agrees with every precon label (official Game Changers + Commander Spellbook)', () => {
    expect(disagreeing('precon')).toEqual([]);
  });

  it('never lifts a precon with the power signal', () => {
    const lifted = rows.filter((r) => r.deck.set === 'precon' && driver(r.est) === 'power');
    expect(lifted.map((r) => r.deck.name)).toEqual([]);
  });

  it('reads tournament cEDH lists as cEDH', () => {
    expect(disagreeing('cedh')).toEqual(KNOWN_CEDH_MISSES);
  });

  it('explains every ScrollVault disagreement with a named cause', () => {
    const sv = reportScrollVault(rows);
    expect(sv.agreement.exact).toBeGreaterThanOrEqual(62);
    for (const cause of Object.keys(sv.buckets)) expect(cause).not.toMatch(/^we read/);
  });

  it('carries the official Game Changer list the corpus was built from', () => {
    const front = (names: Iterable<string>) =>
      [...new Set([...names].map((n) => n.split(' // ')[0]))].sort();
    expect(front(HARDCODED_GAME_CHANGERS)).toEqual(front(corpus.meta.gameChangers.names));
    // Every official name, as the live list spells it, is a Game Changer here.
    for (const n of corpus.meta.gameChangers.names)
      expect(HARDCODED_GAME_CHANGERS.has(n)).toBe(true);
  });

  it('moves a bracket on one swapped card only through a named floor or one power step', () => {
    const decks = corpus.decks.filter((d) => d.set !== 'synthetic');
    const violations: Violation[] = [];
    let swaps = 0;
    let maxSoftStep = 0;
    const moves: Record<string, number> = {};
    // CI: every card of every deck against the fixed probes, plus every
    // one-away piece for a fixed sample; CALIBRATION_FULL: every piece, every deck.
    decks.forEach((deck, i) => {
      const r = stabilityScan(bench, deck, synthetic.probes, {
        oneAwayProbes: FULL || i % 12 === 0,
      });
      swaps += r.swaps;
      maxSoftStep = Math.max(maxSoftStep, r.maxSoftStep);
      violations.push(...r.violations);
      for (const [k, v] of Object.entries(r.moves)) moves[k] = (moves[k] ?? 0) + v;
    });
    if (REPORT) {
      process.stdout.write(
        `\nstability: ${swaps} swaps; bracket moves ${JSON.stringify(moves)}; largest power step with no floor move ${maxSoftStep} (bound ${swapSoftStepBound()}); violations ${violations.length}\n`
      );
    }
    expect(violations).toEqual([]);
    expect(maxSoftStep).toBeLessThanOrEqual(swapSoftStepBound());
    expect(swaps).toBeGreaterThan(100_000);
  }, 600_000);
});

describe('benchmark statistics', () => {
  it('bootstraps a proportion reproducibly, and Wilson stays honest at 100%', () => {
    const hits = [true, true, true, false];
    const a = bootstrapRate(hits, 500, seededRandom(1));
    expect(a).toEqual(bootstrapRate(hits, 500, seededRandom(1)));
    expect(a.low).toBeLessThanOrEqual(0.75);
    expect(a.high).toBeGreaterThanOrEqual(0.75);
    expect(bootstrapRate([], 10, seededRandom(1))).toEqual({ low: 0, high: 0 });
    const all = wilson(8, 8);
    expect(all.high).toBe(1);
    expect(all.low).toBeGreaterThan(0.6);
    expect(all.low).toBeLessThan(0.7);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it('builds a confusion matrix and per-label rates', () => {
    const a = agreement([
      { label: 2, predicted: 2 },
      { label: 2, predicted: 3 },
      { label: 5, predicted: 4 },
    ]);
    expect(a.exact).toBe(1);
    expect(a.withinOne).toBe(3);
    expect(a.confusion).toEqual({ 2: { 2: 1, 3: 1 }, 5: { 4: 1 } });
    expect(a.perLabel.map((c) => [c.label, c.rate])).toEqual([
      [2, 0.5],
      [5, 0],
    ]);
  });
});

describe('disagreement causes', () => {
  const deck = corpus.decks.find((d) => d.id === 'synthetic:baseline')!;
  const est = bench.estimate(bench.state(deck));
  const as = (set: string) => ({ ...deck, set, spellbook: undefined, scrollvault: undefined });

  it('buckets a Core read of a list labeled higher as the known gap, and Bracket 1 as intent', () => {
    expect(disagreementCause(as('declared'), est, 3)).toMatch(/known gap/);
    expect(disagreementCause(as('declared'), est, 1)).toMatch(/intent/);
    expect(disagreementCause(as('declared'), est, 5)).toBe('cEDH: no Bracket 4 floor');
  });

  it('buckets an over-read by what set it', () => {
    const gc = corpus.decks.find((d) => d.id === 'synthetic:gc-4')!;
    const e = bench.estimate(bench.state(gc));
    expect(disagreementCause(as('declared'), e, 3)).toBe('game-changers floor');
    expect(disagreementCause(as('declared'), e, 5)).toBe('cEDH: power signal under 80');
    expect(disagreementCause({ ...gc, set: 'declared' }, e, 2, 'scrollvault')).toBe(
      'we read higher (game-changers)'
    );
    expect(disagreementCause({ ...gc, set: 'declared' }, est, 3, 'scrollvault')).toBe(
      'we read lower (baseline)'
    );
  });

  it('reads a precon Spellbook calls banned as having no label to disagree with', () => {
    const banned = { ...as('precon'), spellbook: { tag: 'B' } } as unknown as typeof deck;
    expect(disagreementCause(banned, est, 3)).toMatch(/banned/);
  });
});

describe('fixes the benchmark surfaced', () => {
  const tags = createTagLookup(corpus.tags);

  it('counts a counterspell that also draws as interaction (Arcane Denial, Remand)', () => {
    // Real tagger memberships: both carry counterspell + card-advantage/draw,
    // so their primary role is cardDraw. The estimator counted a counterspell
    // only when it had no role at all, so these were interaction nowhere.
    for (const n of ['Arcane Denial', 'Remand']) {
      expect(tags.hasTag(n, 'counterspell')).toBe(true);
      expect(tags.getCardRole(n)).toBe('cardDraw');
    }
    const est = estimateBracket(
      ['Arcane Denial', 'Remand', 'Counterspell', 'Island'],
      [],
      2,
      undefined,
      { removal: 0, boardwipe: 0 },
      new Set(),
      tags
    );
    expect(est.breakdown.interactionCount).toBe(3);
  });

  it('still counts a counterspell tagged removal once, through roleCounts', () => {
    // Mystic Confluence: counterspell whose primary role is removal, already
    // in roleCounts.removal, so not counted again.
    expect(tags.getCardRole('Mystic Confluence')).toBe('removal');
    const est = estimateBracket(
      ['Mystic Confluence', 'Island'],
      [],
      2,
      undefined,
      { removal: 1, boardwipe: 0 },
      new Set(),
      tags
    );
    expect(est.breakdown.interactionCount).toBe(1);
  });
});
