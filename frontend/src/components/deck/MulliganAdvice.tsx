import { Scale } from 'lucide-react';
import { InfoTip } from '@/components/overlays/InfoTip';
import {
  ADVISOR_RUNS,
  DEVELOPED_SPELLS,
  DEVELOPED_TURN,
  MULLIGAN_MARGIN,
  type DecidingMetric,
  type MulliganAdvice as Advice,
  type OpeningOdds,
  type Rate,
} from '@/lib/mana-sim/mulligan-advisor';
import { CLOCK_EARLY_TURN } from '@/lib/mana-sim/opening-hand-sim';

interface Props {
  advice: Advice | null;
  /** The run is on its way: the table holds its place. */
  pending: boolean;
  /** The deck has a timed win path, so the table has a row for it. */
  hasPath: boolean;
}

const pct = (p: number): string => `${Math.round(p * 100)}%`;
const span = (r: Rate): string => `${Math.round(r.lo * 100)} to ${Math.round(r.hi * 100)}%`;

interface Row {
  metric: DecidingMetric | null;
  label: string;
  pick: (o: OpeningOdds) => Rate | null;
}

const spells = `${DEVELOPED_SPELLS} or more spells cast by turn ${DEVELOPED_TURN}`;

const ROWS: Row[] = [
  { metric: null, label: 'A spell cast by turn 3', pick: (o) => o.castBy3 },
  { metric: null, label: 'Four land drops by turn 4', pick: (o) => o.landsBy4 },
  { metric: 'developed', label: spells, pick: (o) => o.developed },
  {
    metric: 'path',
    label: `Win path assembled by turn ${CLOCK_EARLY_TURN}`,
    pick: (o) => o.path,
  },
];

/** The verdict in a sentence, naming the metric that decided it and both numbers. */
function adviceSentence(a: Advice): string {
  const path = a.metric === 'path';
  const mine = (path ? a.hand.path : a.hand.developed) as Rate;
  const fresh = (path ? a.mull7.path : a.mull7.developed) as Rate;
  const what = path ? `Win path assembled by turn ${CLOCK_EARLY_TURN}` : spells;
  return `${what[0].toUpperCase()}${what.slice(1)}: ${pct(mine.p)} with this hand, ${pct(fresh.p)} with a fresh seven.`;
}

function adviceHeadline(a: Advice): string {
  if (a.verdict === 'mulligan') return 'Mulligan';
  return a.close ? 'Keep, close call' : 'Keep';
}

export function MulliganAdvice({ advice, pending, hasPath }: Props) {
  const rows = ROWS.filter((r) => r.metric !== 'path' || hasPath);
  return (
    <section className="deck-test-hand-advice" aria-label="Keep or mulligan" aria-busy={pending}>
      <div className="deck-test-hand-sim-bar">
        <span className="deck-test-hand-sim-heading">
          Keep or mulligan?
          <span className="deck-test-hand-sim-heading-sub">
            Goldfish estimate, {ADVISOR_RUNS.toLocaleString()} games each
          </span>
        </span>
        <InfoTip
          label="the mulligan advice"
          className="touch-ghost"
          text={
            <span className="info-tip-lead">
              The opening seven is played on for {ADVISOR_RUNS.toLocaleString()} seeded games, then
              so is a fresh seven (the free first mulligan) and a mulligan to six. Mulligan when the
              fresh seven is ahead by {Math.round(MULLIGAN_MARGIN * 100)} points or more on the
              deciding row and the ranges don&apos;t overlap. The fresh seven is kept as dealt,
              which understates a mulligan. No opponents, and the first player draws on turn 1.
            </span>
          }
        />
      </div>

      <p className="deck-test-hand-advice-verdict" role="status">
        {advice ? (
          <>
            <Scale width={14} height={14} strokeWidth={1.8} aria-hidden />
            <strong className={`is-${advice.verdict}`}>{adviceHeadline(advice)}</strong>
            <span>{adviceSentence(advice)}</span>
          </>
        ) : (
          <span className="win-con-clock-skel" aria-hidden />
        )}
      </p>

      <table className="deck-test-hand-advice-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Odds</span>
            </th>
            <th scope="col">This hand</th>
            <th scope="col">Free mulligan</th>
            <th scope="col">Mulligan to 6</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={advice && r.metric === advice.metric ? 'is-deciding' : ''}>
              <th scope="row">
                {r.label}
                {advice && r.metric === advice.metric && (
                  <span className="deck-test-hand-advice-decides">Decides</span>
                )}
              </th>
              {advice ? (
                [advice.hand, advice.mull7, advice.mull6].map((o, i) => {
                  const rate = r.pick(o);
                  return (
                    <td key={i}>
                      {rate && (
                        <>
                          <strong>{pct(rate.p)}</strong>
                          <span className="deck-test-hand-advice-range">{span(rate)}</span>
                        </>
                      )}
                    </td>
                  );
                })
              ) : (
                <td colSpan={3}>
                  <span className="win-con-clock-skel" aria-hidden />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
