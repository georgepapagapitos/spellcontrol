import { useEffect, useRef, useState, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import { MeterBar } from '../../components/shared/MeterBar';
import { simulateDraftAsync } from '../../lib/cube/generate-async';
import type { DraftSimResult, ColorPair } from '../../lib/cube/draft-sim';
import type { GeneratedCube } from '../../lib/cube/generate';
import { sizeInfo, type ColorBucket } from '../../lib/cube/targets';
import { BUCKET_COLOR, BUCKET_LABEL } from './shared';
import { Button } from '../../components/shared/Button';

/** A deck reaching fewer than this share of the 23-playable bar gets one
 *  plain, unstyled line saying so (design decision: no warn colour, no icon
 *  — a cube that doesn't support a two-colour draft yet isn't a defect the
 *  way an off-curve mana base is). */
const REACH_NOTE_THRESHOLD = 0.75;

/**
 * In-memory cache keyed by the cube's OWN `picks` array. Every edit (lock,
 * ban, swap, rebuild) replaces `picks` with a new array (see
 * `store/cube.ts`'s `withEditedPicks`), so the cache invalidates itself with
 * no bookkeeping: an edited cube is simply a cache miss on next open. A
 * WeakMap means an old cube's entry is garbage-collected once nothing else
 * references its picks; module scope means it survives this component
 * unmounting (switching cube tabs and back doesn't re-run the simulation).
 */
const cache = new WeakMap<GeneratedCube['picks'], DraftSimResult>();

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'done'; result: DraftSimResult };

/**
 * "Draftability": seed 50 simulated drafts off the cube's own cards and
 * report how often a drafter actually ends up with a playable two-colour
 * deck. Same collapsed-by-default disclosure idiom as Cube health right
 * above it (STYLE_GUIDE "insight surfaces never displace content") — the
 * cards below never move further away than one more summary line. A saved
 * cube has no stored result (the generator doesn't carry one), so opening
 * the section is what starts the simulation.
 */
export function CubeDraftabilityPanel({ cube }: { cube: GeneratedCube }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(() => toStatus(cache.get(cube.picks)));
  // Which cube's `picks` a request is already running (or has already run)
  // for — NOT component state on purpose: `status` changing (idle → loading)
  // must not itself re-trigger this effect, or the promise's own resolution
  // race-loses to the re-run's cleanup (a real bug this once was: the effect
  // depended on `status.kind`, so setting it to 'loading' re-ran the effect,
  // whose cleanup marked the FIRST call's promise handlers `cancelled` before
  // they ever fired — the panel stuck on "Simulating…" forever).
  const startedFor = useRef<GeneratedCube['picks'] | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // The cube identity can change under an open panel (an edit lands while
  // this section is on screen) — re-sync straight from render rather than an
  // effect (the React-endorsed way to "adjust state when a prop changes",
  // react.dev/learn/you-might-not-need-an-effect): re-reads the cache for the
  // new identity and lets a new simulation start for it, without the extra
  // render-then-effect tick a useEffect here would cost.
  const [syncedFor, setSyncedFor] = useState(cube.picks);
  if (syncedFor !== cube.picks) {
    setSyncedFor(cube.picks);
    setStatus(toStatus(cache.get(cube.picks)));
    // No need to reset `startedFor` here: it still holds the OLD picks
    // reference, so the effect below's `startedFor.current === cube.picks`
    // guard is already false for the new identity.
  }

  useEffect(() => {
    if (!open) return;
    const cached = cache.get(cube.picks);
    if (cached) return; // synced by the effect above; nothing to start
    if (startedFor.current === cube.picks) return; // already running for this identity
    startedFor.current = cube.picks;
    let cancelled = false;
    setStatus({ kind: 'loading' });
    simulateDraftAsync(
      cube.picks.map((p) => p.card),
      cube.size
    ).then(
      (result) => {
        if (cancelled) return;
        cache.set(cube.picks, result);
        setStatus({ kind: 'done', result });
      },
      () => {
        if (cancelled) return;
        startedFor.current = null; // let a retry start a fresh request
        setStatus({ kind: 'error' });
      }
    );
    return () => {
      cancelled = true;
    };
    // retryToken is a manual re-trigger only — the effect doesn't read it.
  }, [open, cube.picks, cube.size, retryToken]);

  return (
    <div className="cube-draft-sim">
      <h3 className="cube-draft-sim-head">
        <button
          type="button"
          className="cube-draft-sim-toggle"
          aria-expanded={open}
          aria-controls={open ? 'cube-draft-sim-body' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className="cube-group-chevron" width={14} height={14} aria-hidden />
          Draftability
        </button>
      </h3>
      <p className="cube-draft-sim-summary">{summaryLine(status)}</p>
      {open && (
        <div id="cube-draft-sim-body" className="cube-draft-sim-body">
          {status.kind === 'loading' && (
            <p className="cube-draft-sim-running" role="status" aria-live="polite" aria-busy="true">
              Simulating 50 drafts…
            </p>
          )}
          {status.kind === 'error' && (
            <div className="cube-error" role="alert">
              Couldn't simulate the draft.
              <Button variant="link" onClick={() => setRetryToken((t) => t + 1)}>
                Try again
              </Button>
            </div>
          )}
          {status.kind === 'done' && <DraftSimReport result={status.result} size={cube.size} />}
        </div>
      )}
    </div>
  );
}

function toStatus(result: DraftSimResult | undefined): Status {
  return result ? { kind: 'done', result } : { kind: 'idle' };
}

function summaryLine(status: Status): string {
  if (status.kind === 'loading') return 'Simulating 50 drafts…';
  if (status.kind === 'error') return "Couldn't simulate the draft.";
  if (status.kind === 'idle') return 'Simulates 50 drafts when opened.';
  const pct = Math.round(status.result.reachedBarShare * 100);
  return `Simulated 50 drafts: ${pct}% of decks reached 23 playables in two colours.`;
}

function DraftSimReport({
  result,
  size,
}: {
  result: DraftSimResult;
  size: GeneratedCube['size'];
}): JSX.Element {
  const reachPct = Math.round(result.reachedBarShare * 100);
  const reachedCount = Math.round(result.reachedBarShare * result.totalDecks);
  const nominalPlayers = sizeInfo(size).players;

  return (
    <>
      <p className="cube-draft-sim-sub">
        {`${result.runs} simulated ${result.playersPerRun}-player drafts (3 packs of 15) off this ${size}-card cube.`}
        {result.shortCube &&
          ` This cube has fewer cards than a ${nominalPlayers}-player pod needs, so fewer players were drafted.`}
      </p>

      <div className="cube-draft-sim-stat">
        <div className="cube-draft-sim-stat-row">
          <span className="cube-draft-sim-label">Reached 23 playables in two colours</span>
          <strong className="cube-draft-sim-stat-value">{reachPct}%</strong>
        </div>
        <MeterBar value={result.reachedBarShare} max={1} />
        <p className="cube-draft-sim-caption">
          {reachedCount} of {result.totalDecks} drafted decks.
        </p>
        {result.reachedBarShare < REACH_NOTE_THRESHOLD && (
          <p className="cube-draft-sim-note">
            {`Only ${reachPct}% of simulated decks reached a full two-colour build. The cube is likely thin in too many colour pairs for a ${nominalPlayers}-player pod.`}
          </p>
        )}
      </div>

      <div className="cube-draft-sim-pairs">
        <p className="cube-draft-sim-label">Colour pairs drafted</p>
        <ul className="cube-draft-sim-pair-list">
          {result.pairShares.map((p) => (
            <PairRow key={p.label} pair={p.pair} label={p.label} share={p.share} />
          ))}
        </ul>
      </div>

      <div className="cube-draft-sim-archetypes">
        <p className="cube-draft-sim-label">Archetypes nobody drafted</p>
        {result.undraftedArchetypes.length === 0 ? (
          <p className="cube-draft-sim-caption">
            Every archetype this cube supports got drafted by someone.
          </p>
        ) : (
          <ul className="cube-draft-sim-pill-list">
            {result.undraftedArchetypes.map((a) => (
              <li key={a.axis} className="cube-draft-sim-pill">
                {a.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** One colour-pair row: two lettered pips (colour is never the only signal
 *  — each pip carries its letter, and the pair also gets a plain-text
 *  "WU"-style label), a share meter, and the percentage as text. */
function PairRow({
  pair,
  label,
  share,
}: {
  pair: ColorPair;
  label: string;
  share: number;
}): JSX.Element {
  const pct = share * 100;
  const pctText = pct > 0 && pct < 1 ? '<1' : String(Math.round(pct));
  return (
    <li className="cube-draft-sim-pair-row">
      <span className="cube-draft-sim-pips" aria-hidden="true">
        <ColorPairPip color={pair[0]} />
        <ColorPairPip color={pair[1]} />
      </span>
      <span className="cube-draft-sim-pair-label">
        {label}
        <span className="sr-only">
          {' '}
          ({BUCKET_LABEL[pair[0] as ColorBucket] ?? pair[0]} and{' '}
          {BUCKET_LABEL[pair[1] as ColorBucket] ?? pair[1]})
        </span>
      </span>
      <MeterBar value={share} max={1} className="cube-draft-sim-pair-meter" />
      <span className="cube-draft-sim-pair-pct">{pctText}%</span>
    </li>
  );
}

/** White's pip is pale, so it needs dark text; the other four are dark/mid
 *  tones and read fine in the light `--on-accent` used by default. */
const PIP_DARK_TEXT: ReadonlySet<string> = new Set(['W']);

function ColorPairPip({ color }: { color: string }): JSX.Element {
  const bucket = color as ColorBucket;
  return (
    <span
      className="cube-draft-sim-pip"
      style={{
        background: BUCKET_COLOR[bucket] ?? 'var(--mtg-colorless)',
        color: PIP_DARK_TEXT.has(color) ? 'var(--text-primary)' : 'var(--on-accent)',
      }}
    >
      {color}
    </span>
  );
}
