/**
 * The mulligan advice for a dealt hand, computed after paint in slices (as
 * the assembly clock is, `./clock.ts`) so a deal never waits on it and the
 * page stays responsive on a phone.
 *
 * The fresh-seven and mulligan-to-six runs depend on the deck only, so they
 * are cached per deck and shared by every hand dealt from it; a new hand costs
 * one scenario.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ADVISOR_RUNS,
  adviseMulligan,
  advisorSeed,
  handSeed,
  scenarioSteps,
  type AdvisorInput,
  type MulliganAdvice,
  type OpeningOdds,
} from './mulligan-advisor';

/** Milliseconds of engine work per slice, checked between turns (under a frame at 60 Hz). */
const SLICE_MS = 6;
const CACHE_SIZE = 64;

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const sortedNames = (cards: readonly { name: string }[]): string =>
  cards
    .map((c) => c.name)
    .sort()
    .join('|');

/** The identity of one deck's fresh-seven scenarios: its cards, win path and run count. */
export function deckKey(input: AdvisorInput): string {
  const path = (input.path?.assembly ?? [])
    .map((o) => `${o.need}:${[...o.names].sort().join(',')}`)
    .join(';');
  const tutors = [...(input.path?.tutors ?? [])].sort().join(',');
  return [
    sortedNames(input.library),
    sortedNames(input.commanders),
    path,
    tutors,
    input.runs ?? ADVISOR_RUNS,
    input.seed ?? advisorSeed(input.library),
  ].join('#');
}

/** The identity of one hand's advice. The order of the cards in hand does not matter. */
export function adviceKey(input: AdvisorInput): string {
  return `${deckKey(input)}#${[...input.hand].sort().join('|')}`;
}

const advice = new Map<string, MulliganAdvice>();
const inflight = new Map<string, Promise<MulliganAdvice>>();
const fresh = new Map<string, Promise<{ mull7: OpeningOdds; mull6: OpeningOdds }>>();

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.set(key, value);
  if (map.size > CACHE_SIZE) map.delete(map.keys().next().value as string);
}

async function runSliced(steps: Generator<void, OpeningOdds>, budget: { until: number }) {
  let step: IteratorResult<void, OpeningOdds>;
  do {
    budget.until = performance.now() + SLICE_MS;
    step = steps.next();
    if (!step.done) await yieldToBrowser();
  } while (!step.done);
  return step.value;
}

/** The finished advice for this key, or undefined when it has not been run. */
export function peekMulliganAdvice(key: string): MulliganAdvice | undefined {
  return advice.get(key);
}

/** The same numbers as `simulateMulliganAdvice`, computed after paint in slices. Concurrent asks share a run. */
export function mulliganAdviceAsync(input: AdvisorInput): Promise<MulliganAdvice> {
  const key = adviceKey(input);
  const done = advice.get(key);
  if (done) return Promise.resolve(done);
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    await yieldToBrowser();
    const seed = input.seed ?? advisorSeed(input.library);
    const dk = deckKey(input);
    let both = fresh.get(dk);
    if (!both) {
      both = (async () => {
        const budget = { until: 0 };
        const mull7 = await runSliced(scenarioSteps(input, { bottom: 0 }, seed, budget), budget);
        const mull6 = await runSliced(scenarioSteps(input, { bottom: 1 }, seed, budget), budget);
        return { mull7, mull6 };
      })();
      remember(fresh, dk, both);
      both.catch(() => fresh.delete(dk));
    }
    const budget = { until: 0 };
    const hand = await runSliced(
      scenarioSteps(input, { hand: input.hand, bottom: 0 }, handSeed(seed, input.hand), budget),
      budget
    );
    const { mull7, mull6 } = await both;
    return adviseMulligan(hand, mull7, mull6);
  })()
    .then((a) => {
      remember(advice, key, a);
      return a;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

export interface MulliganAdviceState {
  advice: MulliganAdvice | null;
  pending: boolean;
}

const IDLE: MulliganAdviceState = { advice: null, pending: false };

/**
 * The advice for `input`, or `pending` while it is on its way so a panel can
 * hold the space (no layout shift). Null input (no hand yet, no library) is
 * idle.
 */
export function useMulliganAdvice(input: AdvisorInput | null): MulliganAdviceState {
  const key = useMemo(() => (input ? adviceKey(input) : null), [input]);
  const [done, setDone] = useState<{ key: string; advice: MulliganAdvice } | null>(null);

  useEffect(() => {
    if (!key || !input || peekMulliganAdvice(key)) return;
    let live = true;
    void mulliganAdviceAsync(input).then((a) => {
      if (live) setDone({ key, advice: a });
    });
    return () => {
      live = false;
    };
    // The key stands for the input's value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return IDLE;
  const known = peekMulliganAdvice(key);
  if (known) return { advice: known, pending: false };
  return done?.key === key
    ? { advice: done.advice, pending: false }
    : { advice: null, pending: true };
}
