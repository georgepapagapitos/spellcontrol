/**
 * Guard for the public methodology page (frontend/public/guides/bracket-estimator.html).
 * Every sample size and rate printed there is recomputed from the frozen corpus,
 * so the page cannot keep claiming a number the estimator no longer earns: change
 * the estimator and this fails until the page is rewritten with the new figures.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HARDCODED_GAME_CHANGERS, SOFT_SCORE } from '../index';
import { agreement, baselines, createBench, type Corpus } from './benchmark';
import { reportScrollVault, reportSet, runCorpus } from './report';
import type { ClockSignals } from './report';

const fixtures = (name: string) => new URL(`../../calibration/fixtures/${name}`, import.meta.url);
const pageUrl = new URL(
  '../../../../frontend/public/guides/bracket-estimator.html',
  import.meta.url
);

const corpus: Corpus = JSON.parse(fs.readFileSync(fixtures('corpus.json'), 'utf8'));
const clocks = JSON.parse(fs.readFileSync(fixtures('clock-signals.json'), 'utf8')) as ClockSignals;
const rows = runCorpus(createBench(corpus, HARDCODED_GAME_CHANGERS), corpus.decks);
const html = fs.readFileSync(pageUrl, 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

describe('bracket methodology page', () => {
  it('has its own title, description and canonical URL', () => {
    expect(html).toMatch(/<title>[^<]{10,}<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]{60,}"/);
    expect(html).toContain(
      '<link rel="canonical" href="https://spellcontrol.com/guides/bracket-estimator.html" />'
    );
  });

  it('prints the corpus size and build date', () => {
    expect(text).toContain(`${corpus.decks.length} labeled decks`);
    expect(text).toContain(`built ${String(corpus.meta.built)}`);
  });

  it('prints each set size and match count from the corpus', () => {
    for (const [set, name] of [
      ['precon', 'Official precons'],
      ['cedh', 'cEDH top-8 lists'],
      ['synthetic', 'Constructed examples'],
    ] as const) {
      const a = reportSet(set, rows).agreement;
      expect(text, set).toContain(`${name} ${a.n}`);
      expect(text, set).toContain(`${a.exact} of ${a.n}`);
    }
  });

  it('prints the ScrollVault comparison, baseline and weak spots', () => {
    const sv = reportScrollVault(rows);
    const a = sv.agreement;
    const b = baselines(a.perLabel);
    expect(b.majority.predicts).toBe(2);
    expect(text).toContain(`${a.exact} of ${a.n} (${pct(a.exact / a.n)})`);
    expect(text).toContain(`${a.withinOne} of ${a.n} (${pct(a.withinOne / a.n)})`);
    expect(text).toContain(`${b.majority.exact} of ${a.n} (${pct(b.majority.exact / a.n)})`);
    expect(text).toContain(`${pct(a.exactBootstrap.low)} to ${pct(a.exactBootstrap.high)}`);
    for (const c of a.perLabel) {
      expect(text, `B${c.label}`).toContain(`${c.exact} of ${c.n}`);
    }
    const b3 = a.perLabel.find((c) => c.label === 3)!;
    expect(text).toContain(
      `${pct(b3.rate)}; Wilson 95% interval ${pct(b3.wilson.low)} to ${pct(b3.wilson.high)}`
    );
    const misses = a.n - a.exact;
    expect(text).toContain(
      `The ${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][misses]} ScrollVault misses`
    );
  });

  it('prints the cited constants', () => {
    expect(text).toContain(`score of ${SOFT_SCORE.bumpAt} or more`);
    expect(text).toContain(`score of ${SOFT_SCORE.cedhAt} or more`);
    expect(text).toContain(`The ${SOFT_SCORE.bumpAt} and ${SOFT_SCORE.cedhAt} cutoffs`);
    const modeled = Object.values(clocks).filter((c) => c.clock).length;
    expect(text).toContain(`${modeled} of the ${corpus.decks.length} test decks`);
    const maxPrecon = Math.max(
      ...rows.filter((r) => r.deck.set === 'precon').map((r) => r.est.softScore)
    );
    expect(text).toContain(`among the 197 precons is ${maxPrecon}`);
  });

  it('never says the estimate is better than the data shows', () => {
    const a = agreement(
      rows
        .filter((r) => r.deck.scrollvault)
        .map((r) => ({
          label: r.deck.scrollvault!.bracket,
          predicted: r.est.bracket,
        }))
    );
    // The estimator's interval must still reach down to near the baseline, or the
    // "real but small" wording needs another look.
    const base = baselines(a.perLabel).majority.exact / a.n;
    expect(a.exactBootstrap.low - base).toBeLessThan(0.05);
  });
});
