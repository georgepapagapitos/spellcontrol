import { type JSX, useId } from 'react';
import { InfoTip } from '@/components/overlays/InfoTip';
import { ManaCost } from '@/components/shared/ManaCost';
import type { ManaBaseMetrics } from '@/lib/mana-sim/mana-base-metrics';
import { TAPPED_TURNS, TIPPING_BARS } from '@/lib/mana-sim/mana-base-metrics';

const pct = (x: number): number => Math.round(x * 100);
/** Turns the tipping curve is listed over in the math. */
const CURVE_TURNS = 8;

/** Half-width of a 95% interval on a share near one half: the widest any share gets. */
const marginPoints = (runs: number): number => Math.round((196 / Math.sqrt(4 * runs)) * 10) / 10;

/**
 * Three numbers about the mana base, under "Castable on curve": what tapped
 * lands cost in tempo, the turn a typical hand stops being mana-constrained,
 * and how much of the available mana the deck spends. The math is one tap
 * away, and every figure carries the number of games behind it.
 *
 * `metrics` null with `pending` draws the rows' place (the run lands after
 * paint), so nothing below moves. With neither, nothing renders.
 */
export function DeckManaMath({
  metrics,
  pending,
  budget,
  bracket,
}: {
  metrics: ManaBaseMetrics | null;
  pending: boolean;
  /** The turn the utilization reads to. */
  budget: number;
  /** The bracket whose expectation sets it; null when the deck has none. */
  bracket: number | null;
}): JSX.Element | null {
  const titleId = useId();
  if (!metrics && !pending) return null;

  return (
    <section className="deck-manamath" aria-labelledby={titleId} aria-busy={!metrics}>
      <div className="deck-manamath-head">
        <h5 id={titleId} className="deck-manamath-title">
          Mana math
          <InfoTip
            label="mana math"
            text="Three numbers from the same goldfish games as Castable on curve: tempo lost to tapped lands, the turn your hand stops being mana-constrained, and how much mana you spend."
          />
        </h5>
        {metrics && (
          <span className="deck-manamath-count">{metrics.runs.toLocaleString('en-US')} games</span>
        )}
      </div>
      {metrics ? <Rows metrics={metrics} budget={budget} bracket={bracket} /> : <Placeholder />}
    </section>
  );
}

function Placeholder(): JSX.Element {
  return (
    <div className="deck-manamath-skel" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function Rows({
  metrics,
  budget,
  bracket,
}: {
  metrics: ManaBaseMetrics;
  budget: number;
  bracket: number | null;
}): JSX.Element {
  const { tapped, tipping, utilization: u, runs } = metrics;
  const [at80, at90] = tipping.turns;
  const lost = Math.max(0, tapped.lost);
  const lostText = lost < 0.05 ? '0' : lost.toFixed(1);
  const budgetWhy = bracket
    ? `Bracket ${bracket} expects games to last to turn ${budget}`
    : `turn ${budget}`;

  return (
    <>
      <dl className="deck-manamath-list">
        <div className="deck-manamath-row">
          <dt>Tapped lands</dt>
          <dd className="deck-manamath-value">
            {lostText}
            <span className="deck-manamath-unit"> mana-turns</span>
          </dd>
          <dd className="deck-manamath-sub">
            {tapped.lands === 0
              ? 'No land here can enter tapped.'
              : `Lost on turns 1 to ${TAPPED_TURNS}, ${tapped.lands} ${tapped.lands === 1 ? 'land' : 'lands'} can enter tapped.`}
          </dd>
        </div>
        <div className="deck-manamath-row">
          <dt>Tipping point</dt>
          <dd className="deck-manamath-value">
            {at80 === null ? 'After turn 10' : `Turn ${at80}`}
          </dd>
          <dd className="deck-manamath-sub">
            {at80 !== null && at90 === at80
              ? `A typical spell is castable in ${pct(TIPPING_BARS[1])}% of games by then.`
              : `A typical spell is castable in ${pct(TIPPING_BARS[0])}% of games by then${
                  at90 === null ? '' : `, ${pct(TIPPING_BARS[1])}% by turn ${at90}`
                }.`}
          </dd>
        </div>
        <div className="deck-manamath-row">
          <dt>Mana used</dt>
          <dd className="deck-manamath-value">{pct(u.mean)}%</dd>
          <dd className="deck-manamath-sub">
            Through turn {u.turns}. The unluckiest tenth of games used {pct(u.p10)}%.
          </dd>
        </div>
      </dl>

      <details className="deck-manamath-math">
        <summary>Show the math</summary>
        <div className="deck-manamath-body">
          <h6>Tapped lands</h6>
          <p>
            The deck is played twice on the same shuffles, once as built and once with{' '}
            {tapped.lands === 1 ? 'its' : `its ${tapped.lands}`} tapped-or-conditional{' '}
            {tapped.lands === 1 ? 'land' : 'lands'} entering untapped. The loss is the mana the
            second deck has on turns 1 to {TAPPED_TURNS} that the first doesn't, added up.
          </p>
          <Table
            head={range(TAPPED_TURNS)}
            rows={[
              ['As built', range(TAPPED_TURNS).map((t) => tapped.actual[t].toFixed(2))],
              ['Untapped', range(TAPPED_TURNS).map((t) => tapped.untapped[t].toFixed(2))],
            ]}
            caption="Average mana available by turn"
          />
          <p>
            {range(TAPPED_TURNS)
              .map((t) => (tapped.untapped[t] - tapped.actual[t]).toFixed(2))
              .join(' + ')}{' '}
            = {tapped.lost.toFixed(2)} mana-turns.
          </p>

          <h6>Tipping point</h6>
          <p>
            The typical spell is <ManaCost cost={tipping.cost} />: your spells&apos; average mana
            value, with one pip of each of your two most-played colors. A game counts when the mana
            and the colors are both there, the land drops re-chosen for that spell. Two bars are
            shown because published tipping points use 80% and 90%.
          </p>
          <Table
            head={range(CURVE_TURNS)}
            rows={[['Castable', range(CURVE_TURNS).map((t) => `${pct(tipping.curve[t] ?? 0)}%`)]]}
            caption="Share of games able to cast it, by turn"
          />

          <h6>Mana used</h6>
          <p>
            Mana spent on spells over mana available, turns 1 to {u.turns} ({budgetWhy}), per game.
            Ramp cast that turn counts as available. The median game uses {pct(u.median)}%, the
            average {pct(u.mean)}%. The goldfish casts the biggest spell it can each turn and plans
            no further ahead, so a player who sequences does better.
          </p>
        </div>
      </details>

      <p className="deck-manamath-scope">
        {runs.toLocaleString('en-US')} goldfish games a run. A share is good to about{' '}
        {marginPoints(runs)} points either way. No opponents, no interaction.
      </p>
    </>
  );
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

function Table({
  head,
  rows,
  caption,
}: {
  head: number[];
  rows: [string, string[]][];
  caption: string;
}): JSX.Element {
  return (
    <div className="deck-manamath-scroll">
      <table className="deck-manamath-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Turn</th>
            {head.map((t) => (
              <th key={t} scope="col">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cells]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {cells.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
