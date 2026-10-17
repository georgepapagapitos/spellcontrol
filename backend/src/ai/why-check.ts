import { logger } from '../logger';
import { REFINE_MODEL, generateReview } from './client';
import type { Grounding } from './grounding';
import type { RefineRequest, RefineTweak } from './deck-refine';
import { commandZone, renderAnalysis, type OracleEntry } from './deck-review';

/**
 * The refine pass's second look at its own "why" lines (E1027).
 *
 * The refine model reads oracle text and still gets it backwards: on the
 * owner's Zo-Zu deck it added Koth, the Geomancer because Koth "doubles up with
 * Zo-Zu's trigger", when Zo-Zu damages the land's CONTROLLER (the player) and
 * Koth hits each opponent, so the two never land on the same target. The eval
 * fixture had already logged the same misread ("a fetched basic triggers Zo-Zu
 * and Ankh"), and prompt wording didn't move it: v5 vs v6 on Haiku 4.5 scored
 * the same. Haiku 5.5 halved the error rate, to about 2 per reading, and those
 * still reached the player.
 *
 * So the refine reply is checked by a separate call whose only job is reading:
 * each change, the text of every card its reason names, and the deck's type
 * lines and statistics. The checker lists every claim a reason makes and the
 * text that settles it; the CODE keeps a change only when every claim holds.
 * It never rewrites a line: on the first live probe, rewrites kept the wrong
 * claim in 3 of 5 runs and narrated the correction to the reader ("the claim
 * of 4 damage is unsupported"). A change with a wrong reason is dropped; one
 * whose check errors or can't be parsed ships as written, and the route lists
 * it in `whyCheck.unchecked`.
 */

/** Part of the refine cache key: a check change must not replay old answers. */
export const WHY_CHECK_VERSION = 'v3';

export const WHY_CHECK_SYSTEM_PROMPT = `You check the reason a deck analyst gave for one change to a Magic: The
Gathering Commander deck. You do not propose changes, you do not rewrite the
reason, and you do not judge whether the change is a good idea. You check
whether the reason is TRUE, using only the text in front of you.

You will be given the commander, the change (an ADD, an optional CUT, and a
WHY), the full card text of every card the reason touches, the decklist with
each card's type line, and the deck's statistics.

Split the WHY into its factual claims and check each one:

- What a card does, what it costs, its card type, what an ability costs to
  activate, what it fetches or creates. Compare against that card's text.
- WHO each effect touches. Read the exact words: "you", "each opponent",
  "each player", "target player", "that land's controller". A trigger that
  hits "that land's controller" hits the deck's owner every time they play
  a land. Two effects only "double up", "stack" or "combine" when the text
  puts both on the same target, in the same direction.
- WHEN each effect happens: "whenever a land you control enters" is not
  "whenever a land enters".
- Claims about the deck ("the deck lacks creatures", "16 ramp sources",
  "your 32 lands"): compare against the decklist and the statistics.

A claim HOLDS when the text says it, or follows from the text under the
game's ordinary rules: a {2} card costs one less than a {3} card, a token
that is created enters the battlefield, a creature spell that resolves
enters, and a card that "deals damage to each opponent" whenever a creature
you control enters triggers on every creature, whatever that creature does
itself. A claim FAILS when the text contradicts it, or when nothing in front
of you supports it. A claim is not failed for leaving something out: a true
sentence that skips a detail holds. Opinions and plans ("gives the deck
reach", "is better in a long game", "once the game goes long") are not
claims; leave them out.

Read each claim the way a Magic player means it, not hunting for a second
meaning: "Kiki-Jiki copies" are the tokens Kiki-Jiki makes, "your lands" are
the lands you control. This never rescues a claim about WHO an effect hits
or whether two effects stack: those are read exactly as above.

Reply with one JSON array holding one object, and nothing before or after
it. For each claim, "text" quotes the words that settle it (or "none"), and
"reading" says in a few words how they settle it, before you decide "holds":
  [{"n": 1, "claims": [{"claim": "<short>", "text": "<quote>", "reading": "<how>", "holds": true}]}]`;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The ways a reason can name a card: the full name, each face of a double-faced
 * card, and the short name before a comma ("Kiki-Jiki" for "Kiki-Jiki, Mirror
 * Breaker"), which is how refine usually writes a legendary card.
 */
function spellings(name: string): string[] {
  const faces = name.split(' // ');
  const short = faces.flatMap((f) => (f.includes(', ') ? [f.slice(0, f.indexOf(', '))] : []));
  return [name, ...(faces.length > 1 ? faces : []), ...short.filter((s) => s.length >= 4)];
}

/** Deck card names a "why" mentions, so their text goes to the checker. */
export function namedIn(text: string, names: string[]): string[] {
  const lower = text.toLowerCase();
  return names.filter((name) =>
    spellings(name).some((s) =>
      new RegExp(`(^|[^a-z0-9'])${escapeRegExp(s.toLowerCase())}(?=$|[^a-z0-9'])`).test(lower)
    )
  );
}

function cardLine(o: OracleEntry): string {
  const head = [o.name, o.manaCost, o.typeLine ? `— ${o.typeLine}` : ''].filter(Boolean).join(' ');
  return o.oracleText
    ? `${head}: ${o.oracleText.replace(/\n/g, ' ')}`
    : `${head} (no text on file)`;
}

/**
 * The checker's user message. `oracle` is every card the route knows the text
 * of: the command zone, the deck, the pool and whatever refine looked up.
 */
export function buildWhyCheckMessage(input: {
  commanders: string[];
  tweaks: RefineTweak[];
  decklist: { name: string; qty: number }[];
  oracle: OracleEntry[];
  analysis: Record<string, unknown>;
}): string {
  const byName = new Map(input.oracle.map((o) => [o.name.toLowerCase(), o]));
  const deckNames = input.decklist.map((c) => c.name);
  const touched = new Set<string>(input.commanders);
  for (const t of input.tweaks) {
    touched.add(t.add);
    if (t.cut) touched.add(t.cut);
    for (const n of namedIn(t.why, deckNames)) touched.add(n);
  }

  const changes = input.tweaks
    .map(
      (t, i) => `${i + 1}. ADD ${t.add}${t.cut ? ` / CUT ${t.cut}` : ' (no cut)'}\n   WHY: ${t.why}`
    )
    .join('\n');
  const text = [...touched]
    .map((name) => cardLine(byName.get(name.toLowerCase()) ?? { name }))
    .join('\n');
  const decklist = input.decklist
    .map((c) => {
      const type = byName.get(c.name.toLowerCase())?.typeLine;
      return `${c.qty} ${c.name}${type ? ` — ${type}` : ''}`;
    })
    .join('\n');

  return [
    `Commander: ${input.commanders.join(' + ')}`,
    `## Changes\n\n${changes}`,
    `## Card text\n\n${text}`,
    `## Decklist (${input.decklist.reduce((n, c) => n + c.qty, 0)})\n\n${decklist}`,
    `## Statistics\n\n${renderAnalysis(input.analysis)}`,
  ].join('\n\n');
}

export interface WhyCheckResult {
  tweaks: RefineTweak[];
  /** Changes refused, with the line and the claims that failed. */
  dropped: { add: string; why: string; failed: string[] }[];
}

/**
 * Apply the checker's claim lists: a change survives only when every claim it
 * makes holds. Returns null when the reply isn't a claim list for every change:
 * a half-read check is no check, and the caller keeps the originals rather than
 * guess which ones were looked at.
 */
export function applyWhyCheck(raw: string, tweaks: RefineTweak[]): WhyCheckResult | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const failedBy = new Map<number, string[]>();
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { n, claims } = entry as Record<string, unknown>;
    if (typeof n !== 'number' || !Array.isArray(claims)) continue;
    const failed: string[] = [];
    for (const c of claims) {
      if (typeof c !== 'object' || c === null) return null;
      const { claim, holds } = c as Record<string, unknown>;
      if (typeof holds !== 'boolean') return null;
      if (!holds) failed.push(typeof claim === 'string' ? claim : '');
    }
    failedBy.set(n, failed);
  }

  const out: WhyCheckResult = { tweaks: [], dropped: [] };
  for (const [i, t] of tweaks.entries()) {
    const failed = failedBy.get(i + 1);
    if (!failed) return null;
    if (failed.length === 0) out.tweaks.push(t);
    else out.dropped.push({ add: t.add, why: t.why, failed });
  }
  return out;
}

export interface WhyCheckUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface WhyCheckRun extends WhyCheckResult {
  /** Changes whose check errored or didn't parse: kept unchecked. */
  unchecked: string[];
  usage: WhyCheckUsage;
}

/**
 * Check every change, one call each, all at once. One call per change because
 * the claim-by-claim reply is what makes the check accurate and it is long:
 * five changes in one call measured 7-9s of extra wait after the prose, which
 * is the wait the reader sits through. A change whose check fails stays as
 * refine wrote it, listed in `unchecked`; an abort still throws.
 */
export async function checkWhys(
  input: Parameters<typeof buildWhyCheckMessage>[0],
  generate: (system: string, user: string) => Promise<{ content: string } & Partial<WhyCheckUsage>>,
  signal?: AbortSignal
): Promise<WhyCheckRun> {
  const usage: WhyCheckUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  const results = await Promise.all(
    input.tweaks.map(async (t) => {
      try {
        const g = await generate(
          WHY_CHECK_SYSTEM_PROMPT,
          buildWhyCheckMessage({ ...input, tweaks: [t] })
        );
        usage.inputTokens += g.inputTokens ?? 0;
        usage.outputTokens += g.outputTokens ?? 0;
        usage.cacheWriteTokens += g.cacheWriteTokens ?? 0;
        usage.cacheReadTokens += g.cacheReadTokens ?? 0;
        return applyWhyCheck(g.content, [t]);
      } catch (err) {
        if (signal?.aborted) throw err;
        return null;
      }
    })
  );

  const run: WhyCheckRun = { tweaks: [], dropped: [], unchecked: [], usage };
  for (const [i, r] of results.entries()) {
    const t = input.tweaks[i];
    if (!r) {
      run.tweaks.push(t);
      run.unchecked.push(t.add);
      continue;
    }
    run.tweaks.push(...r.tweaks);
    run.dropped.push(...r.dropped);
  }
  return run;
}

/**
 * The refine route's call: {@link checkWhys} on the refine model with thinking
 * off, failures logged, and the verdict in the shape `grounding.whyCheck`
 * stores. The check is a filter, not the answer: a change it couldn't read
 * ships as written, listed so the audit can count how often that happens.
 */
export async function checkRefineWhys(
  request: Pick<RefineRequest, 'deckId' | 'commander' | 'partnerCommander' | 'cards' | 'analysis'>,
  tweaks: RefineTweak[],
  oracle: OracleEntry[],
  signal: AbortSignal
): Promise<{
  tweaks: RefineTweak[];
  usage: WhyCheckUsage;
  grounding: NonNullable<Grounding['whyCheck']>;
}> {
  const { deckId } = request;
  const run = await checkWhys(
    {
      commanders: commandZone(request),
      tweaks,
      decklist: request.cards,
      oracle,
      analysis: request.analysis,
    },
    async (system, user) => {
      try {
        return await generateReview(system, user, undefined, signal, {
          model: REFINE_MODEL,
          thinking: 'off',
        });
      } catch (err) {
        if (!signal.aborted) logger.warn(`[ai] deck refine check failed (deckId=${deckId})`, err);
        throw err;
      }
    },
    signal
  );
  if (run.dropped.length > 0) {
    logger.info(
      `[ai] deck refine check dropped ${run.dropped.length} change(s) (deckId=${deckId})`
    );
  }
  return {
    tweaks: run.tweaks,
    usage: run.usage,
    grounding: {
      dropped: run.dropped,
      ...(run.unchecked.length ? { unchecked: run.unchecked } : {}),
    },
  };
}
