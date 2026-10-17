import { logger } from '../logger';
import { REFINE_MODEL, generateReview } from './client';
import { STRATEGY_MARK, TWEAKS_DELIMITER, type RefineRequest } from './deck-refine';
import { commandZone, renderAnalysis, type OracleEntry } from './deck-review';
import type { Grounding } from './grounding';
import { CLAIM_RULES, cardLine, namedIn, parseClaimLists, type WhyCheckUsage } from './why-check';

/**
 * The refine pass's check on its own strategy prose (E1029).
 *
 * E1027 checked every swap's "why" and left the prose above it alone. The next
 * live reading on the owner's Zo-Zu deck had accurate swaps under a strategy
 * that said "Lands and Zo-Zu's trigger together turn each land drop into a
 * source of damage": Zo-Zu damages the land's CONTROLLER, so the owner's own
 * land drops hurt the owner. So the prose goes through the same claim check,
 * one call per sentence, with the text before it as context.
 *
 * A sentence with a failing claim is DROPPED, never rewritten: on E1027's probe
 * a model rewrite kept the wrong claim in 3 of 5 runs. A sentence whose check
 * errors or can't be parsed ships as written and is counted in `unchecked`.
 *
 * Nothing the reader has seen is ever taken back. Each sentence is held until
 * its check returns and only then streamed, while refine writes the rest. On
 * fixture-8, refine wrote its whole strategy in about 3s and a paragraph-sized
 * check took 5-8s, so holding paragraphs (or the whole strategy) kept the
 * skeleton up about 7s longer than before; a one-sentence check is shorter.
 * Streaming everything and removing sentences at the end would show a wrong
 * claim for the length of the check and then reflow the text under the reader.
 */

export const PROSE_CHECK_SYSTEM_PROMPT = `You check one sentence a deck analyst wrote about a Magic: The Gathering
Commander deck. You do not rewrite it, and you do not judge the strategy. You
check whether what it says about the cards and the deck is TRUE, using only
the text in front of you.

You will be given the commander, the sentence, the text the analyst wrote
before it, the full card text of every card either one names, the decklist
with each card's type line, and the deck's statistics. The text before the
sentence is context only: use it to tell what "it", "these" or "that gap"
refer to, and never check it.

Split the sentence into its factual claims and check each one:

${CLAIM_RULES}

The text describes how the deck wins, so a sentence that calls an effect
damage, pressure, a clock, or damage that "keeps coming" is counting it
against the opponents, even when it names no target. So on every claim about
damage or life loss to players, add "hits_owner": true when the card text,
for the case the sentence describes, also hits the deck's owner.

- "That land's controller" hits the owner on every land the owner plays:
  "each land drop" or "your land drops" is true.
- "Each player", and "them" at each player's upkeep, hit the owner: true.
- "Each opponent" never does: false.
- "Up to one", "may" and "target" are the owner's choices: an effect that
  lets the owner pick each player's land, or none, can be aimed at the
  opponents only.
- Judge the case from the WHOLE sentence. When the sentence limits it to the
  opponents ("every land an opponent plays costs them 4 life"), every claim
  in that sentence is false.

A sentence that makes no claim about what a card does or what the deck holds
gets an empty claim list: a plan, a summary, advice, or a label for the
deck's style ("a punisher shell", "a stax deck"). A judgment of the deck is
an opinion too, not a claim: "the creature count is low", "removal is
heavy", "the weak spot is the early game". So is why a card is in the deck
("Wasteland is there to slow the opponents") and what the deck needs. A
number inside any of these ("light at 18 creatures") is a claim: check the
number, not the judgment. A sentence about "the changes below" is about
cards you are not shown: it makes no claim.

A sentence that gives several cards one job ("Chain Reaction, Slagstorm and
Goblin Chainwhirler clear the board") claims the job for the group, read the
way a player means it. It fails only when a card in the list has nothing in
its text that does that job, not when one card does it less fully.

Reply with one JSON array holding one object, and nothing before or after
it. For each claim, "text" quotes the words that settle it (or "none"), and
"reading" says in a few words how they settle it, before you decide "holds":
  [{"n": 1, "claims": [{"claim": "<short>", "text": "<quote>", "reading": "<how>", "holds": true, "hits_owner": false}]}]`;

/**
 * Whether a sentence itself says who takes the damage: every player, the deck's
 * owner too, or only the opponents' own land drops. Read here, not by the
 * checker: asked for this, it marked "each player" sentences as not saying so.
 * The real-output probe added the wordings refine actually writes ("whichever
 * player", "the controller of each land", "every land that enters").
 */
const SAYS_WHO = new RegExp(
  [
    String.raw`\b(each|every|all|any|either|both|whichever|a) players?('s?)?\b`,
    String.raw`\b(everyone|anyone|anybody|someone|whoever)('s)?\b`,
    String.raw`\b(its|their|that land's) controllers?\b`,
    String.raw`\bthe controller of\b`,
    String.raw`\bunder (their|its|anyone's|an opponent's) control\b`,
    String.raw`\b(every|each|any) land (that )?enters\b`,
    String.raw`\bon either side\b`,
    String.raw`\ban opponent (plays|controls)\b`,
    String.raw`\bopponents?'s? (own )?lands?\b`,
    String.raw`\b(you|yourself) (included|too|as well)\b`,
    String.raw`\bincluding you(rself)?\b`,
    String.raw`\b(costs|hurts|damages|hits) you\b`,
    String.raw`\byour own (life|land)`,
    String.raw`\byou (take|lose)\b`,
    String.raw`\bsymmetric`,
  ].join('|'),
  'i'
);
export const saysWho = (sentence: string) => SAYS_WHO.test(sentence);

const SENTENCE_END = /[.!?]["')\]]*\s+(?=["'([]?[A-Z0-9{])/g;

/** `[start, end)` of each sentence; the last one runs to the end of the text. */
function sentenceSpans(paragraph: string, names: string[]): [number, number][] {
  const lower = paragraph.toLowerCase();
  const inName: [number, number][] = [];
  for (const name of names) {
    if (!name.includes('.')) continue;
    const n = name.toLowerCase();
    for (let at = lower.indexOf(n); at !== -1; at = lower.indexOf(n, at + 1)) {
      inName.push([at, at + n.length]);
    }
  }
  const out: [number, number][] = [];
  let from = 0;
  for (const m of paragraph.matchAll(SENTENCE_END)) {
    if (inName.some(([s, e]) => m.index >= s && m.index < e)) continue;
    const cut = m.index + m[0].length;
    if (paragraph.slice(from, cut).trim()) out.push([from, cut]);
    from = cut;
  }
  if (paragraph.slice(from).trim()) out.push([from, paragraph.length]);
  return out;
}

/**
 * Split a paragraph into trimmed sentences. A full stop inside a card name
 * ("Mr. House, President and CEO") is not a sentence end.
 */
export function splitSentences(paragraph: string, names: string[] = []): string[] {
  return sentenceSpans(paragraph, names).map(([s, e]) => paragraph.slice(s, e).trim());
}

export interface ProseCheckInput {
  commanders: string[];
  decklist: { name: string; qty: number }[];
  /** Every card the route knows the text of: command zone, deck and pool. */
  oracle: OracleEntry[];
  analysis: Record<string, unknown>;
}

/** The checker's user message for one sentence and the prose before it. */
export function buildProseCheckMessage(
  input: ProseCheckInput,
  context: string,
  sentence: string
): string {
  const byName = new Map(input.oracle.map((o) => [o.name.toLowerCase(), o]));
  const named = namedIn(
    `${context}\n${sentence}`,
    input.oracle.map((o) => o.name)
  );
  const touched = [...new Set([...input.commanders, ...named])];
  const text = touched
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
    `## Sentence to check\n\n${sentence}`,
    `## Text before it (context only)\n\n${context || '(none: this is the first sentence)'}`,
    `## Card text\n\n${text}`,
    `## Decklist (${input.decklist.reduce((n, c) => n + c.qty, 0)})\n\n${decklist}`,
    `## Statistics\n\n${renderAnalysis(input.analysis)}`,
  ].join('\n\n');
}

/** Marks a claim, in `failed`, that failed on direction alone. */
export const HITS_OWNER_TOO = 'hits you too: ';

/**
 * The claims of `sentence` that fail, from the checker's reply; empty when it
 * holds. Null when the reply isn't a claim list for it.
 */
export function applyProseCheck(raw: string, sentence: string): string[] | null {
  const verdict = parseClaimLists(raw)?.get(1);
  if (!verdict) return null;
  // Damage that also hits the owner, in a sentence that never says so: the
  // checker wrote "the owner takes it" and still said "holds" in most runs,
  // so code decides this one.
  const oneWay = saysWho(sentence)
    ? []
    : verdict.hitsOwner.filter((c) => !verdict.failed.includes(c)).map((c) => HITS_OWNER_TOO + c);
  return [...verdict.failed, ...oneWay];
}

export interface SentenceCheck {
  sentence: string;
  /** The claims that failed; empty means the sentence is kept. */
  failed: string[];
  /** True when the check errored or didn't parse, so the sentence is kept as written. */
  unchecked: boolean;
  usage: WhyCheckUsage;
}

const zeroUsage = (): WhyCheckUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
});

/** Check one sentence. Only an abort throws; any other failure keeps it as written. */
export async function checkSentence(
  input: ProseCheckInput,
  context: string,
  sentence: string,
  generate: (system: string, user: string) => Promise<{ content: string } & Partial<WhyCheckUsage>>,
  signal?: AbortSignal
): Promise<SentenceCheck> {
  const usage = zeroUsage();
  try {
    const g = await generate(
      PROSE_CHECK_SYSTEM_PROMPT,
      buildProseCheckMessage(input, context, sentence)
    );
    usage.inputTokens = g.inputTokens ?? 0;
    usage.outputTokens = g.outputTokens ?? 0;
    usage.cacheWriteTokens = g.cacheWriteTokens ?? 0;
    usage.cacheReadTokens = g.cacheReadTokens ?? 0;
    const failed = applyProseCheck(g.content, sentence);
    if (failed) return { sentence, failed, unchecked: false, usage };
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return { sentence, failed: [], unchecked: true, usage };
}

export interface CheckedProse {
  /** Feed it the prose as it streams; it emits each sentence once checked. */
  push: (text: string) => void;
  /**
   * Check whatever `strategy` (the parsed, complete prose) holds beyond the
   * sentences already sent, wait for every check, and return the result.
   */
  finish: (strategy: string) => Promise<{
    strategy: string;
    usage: WhyCheckUsage;
    grounding: NonNullable<Grounding['proseCheck']>;
  }>;
}

const PARAGRAPH_BREAK = /\n{2,}/;

/**
 * A sentence still streaming can look finished at a full stop that is really
 * inside a card name ("Mr. House, President and CEO"). It counts as finished
 * once this much text follows it, enough for the rest of the name to arrive.
 */
const SETTLED = 40;

/**
 * Hold each sentence until its check returns, then emit what survived, in
 * order. A check starts as soon as its sentence is complete, so the checks
 * overlap the rest of the generation and each other.
 */
export function makeCheckedProse(
  check: (context: string, sentence: string) => Promise<SentenceCheck>,
  emit: (text: string) => void,
  names: string[] = []
): CheckedProse {
  let acc = '';
  /** Sentences launched so far, per paragraph. */
  const launched: number[] = [];
  const results: { paragraph: number; check: SentenceCheck }[] = [];
  let lastShown = -1;
  let queue: Promise<void> = Promise.resolve();

  const launch = (paragraph: number, context: string, sentence: string) => {
    const pending = check(context, sentence);
    queue = queue.then(async () => {
      const r = await pending;
      results.push({ paragraph, check: r });
      if (r.failed.length) return;
      emit(`${lastShown === -1 ? '' : lastShown === paragraph ? ' ' : '\n\n'}${r.sentence}`);
      lastShown = paragraph;
    });
    // An abort rejects the queue; `finish` rethrows it, and a pass that never
    // reaches `finish` must not leave an unhandled rejection behind.
    queue.catch(() => {});
  };

  /** Launch every sentence of `text` that is complete and not yet launched. */
  const scan = (text: string, final: boolean) => {
    const parts = text.split(PARAGRAPH_BREAK);
    const before: string[] = [];
    let p = -1;
    for (const [i, part] of parts.entries()) {
      const para = part.trim();
      if (!para) continue;
      p++;
      const spans = sentenceSpans(para, names);
      const ready =
        final || i < parts.length - 1
          ? spans.length
          : spans.filter(([, end]) => para.length - end >= SETTLED).length;
      const sentences = spans.map(([s, e]) => para.slice(s, e).trim());
      for (let j = launched[p] ?? 0; j < ready; j++) {
        const context = [...before, sentences.slice(0, j).join(' ')].filter(Boolean).join('\n\n');
        launch(p, context, sentences[j]);
        launched[p] = j + 1;
      }
      before.push(para);
    }
  };

  return {
    push(text) {
      acc += text;
      scan(acc, false);
    },
    async finish(strategy) {
      scan(strategy, true);
      await queue;
      const usage = zeroUsage();
      const kept: string[][] = [];
      for (const { paragraph, check: r } of results) {
        for (const k of Object.keys(usage) as (keyof WhyCheckUsage)[]) usage[k] += r.usage[k];
        if (!r.failed.length) (kept[paragraph] ??= []).push(r.sentence);
      }
      const unchecked = results.filter((r) => r.check.unchecked).length;
      return {
        strategy: kept
          .filter(Boolean)
          .map((s) => s.join(' '))
          .join('\n\n'),
        usage,
        grounding: {
          dropped: results
            .filter((r) => r.check.failed.length)
            .map((r) => ({ sentence: r.check.sentence, failed: r.check.failed })),
          ...(unchecked ? { unchecked } : {}),
        },
      };
    },
  };
}

/**
 * The refine route's prose check: {@link makeCheckedProse} over
 * {@link checkSentence} on the refine model with thinking off, failures
 * logged. `emit` receives the checked prose as it clears.
 */
export function checkedRefineProse(
  request: Pick<RefineRequest, 'deckId' | 'commander' | 'partnerCommander' | 'cards' | 'analysis'>,
  oracle: OracleEntry[],
  signal: AbortSignal,
  emit: (text: string) => void
): CheckedProse {
  const { deckId } = request;
  const input: ProseCheckInput = {
    commanders: commandZone(request),
    decklist: request.cards,
    oracle,
    analysis: request.analysis,
  };
  const prose = makeCheckedProse(
    (context, sentence) =>
      checkSentence(
        input,
        context,
        sentence,
        async (system, user) => {
          try {
            return await generateReview(system, user, undefined, signal, {
              model: REFINE_MODEL,
              thinking: 'off',
            });
          } catch (err) {
            if (!signal.aborted)
              logger.warn(`[ai] deck refine prose check failed (deckId=${deckId})`, err);
            throw err;
          }
        },
        signal
      ),
    emit,
    oracle.map((o) => o.name)
  );
  return {
    push: prose.push,
    async finish(strategy) {
      const out = await prose.finish(strategy);
      if (out.grounding.dropped.length > 0) {
        logger.info(
          `[ai] deck refine check dropped ${out.grounding.dropped.length} sentence(s) (deckId=${deckId})`
        );
      }
      return out;
    },
  };
}

/**
 * Emit only the prose half of a refine reply as it streams.
 *
 * The model writes a marker, then prose, then a delimiter, then JSON. Both the
 * marker and the JSON are machine output and must never flicker across the
 * user's screen, so this drops the opening marker, forwards everything up to
 * the delimiter, and then goes quiet. Deltas split wherever the model happens
 * to chunk, so it holds back a delimiter-length tail rather than risk emitting
 * half of `---TWEAKS---` as if it were prose.
 *
 * The marker arrives here because the tool loop's gate releases text FROM the
 * marker onward — that is what tells it the research is over. Stripping it is
 * this gate's job; `parseRefineOutput` does the same for the stored copy.
 */
export function makeProseGate(emit: (text: string) => void): (delta: string) => void {
  let acc = '';
  let sent = 0;
  let done = false;
  let markerHandled = false;
  return (delta: string) => {
    if (done) return;
    acc += delta;
    if (!markerHandled) {
      const markAt = acc.indexOf(STRATEGY_MARK);
      if (markAt !== -1) {
        acc = acc.slice(markAt + STRATEGY_MARK.length).replace(/^\r?\n/, '');
        markerHandled = true;
      } else if (acc.length < STRATEGY_MARK.length) {
        // Could still be the marker arriving a character at a time.
        return;
      } else {
        // No marker in a reply long enough to hold one — a v3-shaped answer.
        markerHandled = true;
      }
    }
    const at = acc.indexOf(TWEAKS_DELIMITER);
    if (at !== -1) {
      if (at > sent) emit(acc.slice(sent, at));
      done = true;
      return;
    }
    const safe = acc.length - TWEAKS_DELIMITER.length;
    if (safe > sent) {
      emit(acc.slice(sent, safe));
      sent = safe;
    }
  };
}
