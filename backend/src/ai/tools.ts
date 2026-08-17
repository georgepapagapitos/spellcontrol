import type Anthropic from '@anthropic-ai/sdk';
import type { BracketEstimation } from '@spellcontrol/deck-metrics';
import { logger } from '../logger';
import type { ScryfallCache } from '../cache';

/**
 * Tools the AI features can call. The backend had none before this — every
 * feature was one prompt in, one answer out — so the model could only name a
 * card from memory, and a measured 6/12 of reviews on a healthy deck named at
 * least one card that wasn't in the deck and whose text nobody had checked.
 *
 * A tool changes the shape of that problem rather than tightening the wording:
 * a card the model looked up came back from our own Scryfall cache, so its name
 * and text are real by construction. The prompt can then ask for something
 * checkable — cite only what you fetched — and the route can verify it after
 * the fact instead of trusting the prose.
 */

/** A card the model retrieved this conversation. The citation allowlist. */
export interface FetchedCard {
  name: string;
  typeLine: string;
  oracleText: string;
}

export interface ToolResult {
  text: string;
  fetched: FetchedCard[];
}

export interface AiTool {
  definition: Anthropic.Tool;
  /**
   * Run the tool. Returns the text handed back to the model as the tool
   * result, plus any cards that text vouches for.
   *
   * May be async: `lookup_cards` is a synchronous SQLite read, but
   * `check_bracket` has to reach Postgres for the combo dataset. Callers await
   * the result either way.
   */
  run(input: Record<string, unknown>): ToolResult | Promise<ToolResult>;
}

/** Cap per call — enough to choose from, small enough not to flood the context. */
const LOOKUP_LIMIT = 8;
const LOOKUP_LIMIT_MAX = 20;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * `lookup_cards` — search the oracle text in our own Scryfall cache.
 *
 * Deliberately shaped around EFFECTS rather than names. The review prompt
 * already asks for the missing effect first ("an instant-speed answer to an
 * artifact") and treats a card name as an illustration of it; this tool takes
 * exactly that phrasing and returns real cards for it. A name-only lookup would
 * just let the model confirm a card it already recalled, which is the habit
 * we're trying to replace.
 *
 * No live Scryfall traffic: the index is local, so this stays clear of the
 * shared-Fly-IP rate limiting that rules out per-request Scryfall calls.
 */
export function lookupCardsTool(
  cache: ScryfallCache,
  context: {
    colorIdentity?: readonly string[];
    exclude?: readonly string[];
    /**
     * When set, every result is a card the player physically owns. A HARD
     * constraint applied in the query, not a preference the model may weigh:
     * under owned-only generation a card they would have to buy is not a
     * suggestion at all.
     */
    ownedNames?: readonly string[];
  }
): AiTool {
  const ownedOnly = context.ownedNames !== undefined;
  return {
    definition: {
      name: 'lookup_cards',
      description: [
        'Search real Magic cards by what their rules text DOES. Use this before naming any',
        'card that is not already in the decklist — it is the only way to name one accurately,',
        'and cards you have not looked up must not be named.',
        '',
        'Query with the effect in plain rules wording, not a card name and not a concept:',
        '"destroy target artifact", "return creature card from your graveyard to the battlefield",',
        '"whenever a creature you control dies". Results are already filtered to the commander\'s',
        'colour identity, to Commander-legal cards, and exclude cards the deck already runs, so',
        'anything returned is a legal suggestion for this deck.',
        ...(ownedOnly
          ? [
              '',
              'Results are further restricted to cards THIS PLAYER ALREADY OWNS, because they are',
              'building from their own collection. Every card returned is one they can physically',
              'put in the deck today, and a card that does NOT come back from this tool is not',
              'available to them however strong it would be.',
            ]
          : []),
        '',
        "Returns each card's exact name, type line, mana value and oracle text. Quote behaviour",
        'from that text, never from memory. An empty result means try different wording.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The effect, in rules wording. E.g. "destroy target artifact or enchantment".',
          },
          type_line: {
            type: 'string',
            description:
              'Optional. Restrict to a card type, e.g. "Instant", "Land", "Artifact Creature".',
          },
          limit: {
            type: 'integer',
            description: `Optional. Max cards to return (default ${LOOKUP_LIMIT}).`,
          },
        },
        required: ['query'],
      },
    },

    run(input) {
      const query = asString(input.query);
      if (!query) {
        return {
          text: 'No query given. Pass the effect you are looking for as `query`.',
          fetched: [],
        };
      }
      const limitRaw = typeof input.limit === 'number' ? input.limit : LOOKUP_LIMIT;
      const hits = cache.searchCards({
        query,
        typeLine: asString(input.type_line),
        colorIdentity: context.colorIdentity,
        commanderLegalOnly: true,
        exclude: context.exclude,
        ownedNames: context.ownedNames,
        limit: Math.min(Math.max(1, Math.trunc(limitRaw)), LOOKUP_LIMIT_MAX),
      });

      if (hits.length === 0) {
        return {
          text: ownedOnly
            ? `Nothing this player owns matched "${query}". Try different rules wording, or accept that their collection has no answer to this and look for a different improvement.`
            : `No cards matched "${query}". Try describing the effect in different rules wording.`,
          fetched: [],
        };
      }

      const fetched: FetchedCard[] = hits.map((h) => ({
        name: h.name,
        typeLine: h.typeLine,
        oracleText: h.oracleText,
      }));
      const text = hits
        .map((h) => {
          const mv = h.cmc == null ? '' : ` (mana value ${h.cmc})`;
          return `${h.name}${mv} — ${h.typeLine}: ${h.oracleText.replace(/\n/g, ' ')}`;
        })
        .join('\n');
      return { text, fetched };
    },
  };
}

/**
 * Oracle facts don't expire the way prices do, so a legality/identity check
 * ignores the cache's 7-day TTL. Never read a price off a card resolved here.
 */
const ORACLE_MAX_AGE_MS = Number.MAX_SAFE_INTEGER;

/**
 * Resolve a card name the model proposed into a card this deck may actually
 * add — returning its canonical spelling, or null to reject it.
 *
 * The refine pass used to answer that question with "is this name in the pool
 * the engine supplied". Once the model can look cards up, the pool stops being
 * the boundary, so the boundary becomes the one the lookup query already
 * enforces: a real card, legal in Commander, inside the commander's colour
 * identity, not already in the deck, and owned when the build is owned-only.
 *
 * Deliberately a PROPERTY check rather than a provenance one. A cached refine
 * row is re-parsed and re-verified when it is replayed, and the cards fetched
 * during the original generation are long gone by then — so "did the model
 * actually fetch this?" would pass on first read and silently drop every
 * tool-sourced tweak on the second. Provenance is still worth knowing and is
 * logged as the prompt-drift signal; legality is what gets ENFORCED.
 */
export function makeCandidateResolver(
  cache: ScryfallCache,
  context: {
    colorIdentity?: readonly string[];
    exclude?: readonly string[];
    ownedNames?: readonly string[];
  }
): (name: string) => string | null {
  const identity = context.colorIdentity ? new Set(context.colorIdentity) : null;
  const excluded = new Set((context.exclude ?? []).map((n) => n.toLowerCase()));
  const owned = context.ownedNames ? new Set(context.ownedNames.map((n) => n.toLowerCase())) : null;

  return (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const card = cache.getCheapestByName(trimmed, ORACLE_MAX_AGE_MS);
    if (!card) return null;
    // Match on the CANONICAL name throughout: the model may spell a card the
    // way it remembers it, and the deck/owned sets are keyed by real names.
    const canonical = card.name;
    const key = canonical.toLowerCase();
    if (excluded.has(key) || excluded.has(trimmed.toLowerCase())) return null;
    if (card.legalities?.commander !== 'legal') return null;
    if (identity && (card.color_identity ?? []).some((c) => !identity.has(c))) return null;
    if (owned && !owned.has(key)) return null;
    return canonical;
  };
}

/**
 * `check_bracket` — re-run the app's own bracket estimator over the deck with a
 * proposed swap applied, and report whether the bracket actually moved.
 *
 * The point is to replace an assertion with a measurement. The model is told a
 * target and an estimate in the statistics block, and it will happily claim a
 * cut "brings you back under your target" — a claim nothing checked. This lets
 * it check, using the same estimator the app shows the user.
 *
 * ⚠️ Scoped to a SINGLE swap on purpose. The estimator's hard floors are
 * non-linear (a completed two-card combo, a game changer, mass land denial), so
 * "what do these five changes do together" is a different question with a
 * different answer, and answering it one card at a time would mislead.
 */
export function checkBracketTool(
  deckNames: readonly string[],
  estimate: (names: string[]) => Promise<BracketEstimation>,
  render: (
    before: BracketEstimation,
    after: BracketEstimation,
    change: { add?: string; cut?: string }
  ) => string
): AiTool {
  // The "before" estimate is the same every call — same deck, same inputs — but
  // the model checks 4-5 changes per review (measured across 33 runs), and each
  // estimate costs a combo query against Postgres. Computing it once takes that
  // from ~9 queries per refine to ~5.
  let baseline: Promise<BracketEstimation> | null = null;

  /**
   * Cap on checks per request. Measured 41, 52 and 56 calls across 12-run arms —
   * a long tail of ~9 in one review, each one two estimates deep. The cap is
   * generous against MAX_TWEAKS (5) so it never bites a model checking the
   * changes it actually intends, only one looping.
   */
  const MAX_CHECKS = 12;
  let checks = 0;

  return {
    definition: {
      name: 'check_bracket',
      description: [
        "Check what ONE proposed change does to this deck's Commander bracket, before you",
        'commit to proposing it. Use it whenever the statistics show a bracket target and you',
        'are about to claim a change keeps the deck inside it — that claim is checkable, so',
        'check it rather than asserting it.',
        '',
        'Pass the card being added and/or the card being cut. Returns the bracket before and',
        'after, and which hard floors changed. One change per call: bracket floors do not add',
        'up linearly, so a combined answer for several swaps would be wrong.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          add: {
            type: 'string',
            description: 'Exact name of the card being added. Omit for a pure cut.',
          },
          cut: {
            type: 'string',
            description: 'Exact name of the card being cut. Omit for a pure add.',
          },
        },
        required: [],
      },
    },

    async run(input) {
      const add = asString(input.add);
      const cut = asString(input.cut);
      if (!add && !cut) {
        return {
          text: 'Pass `add`, `cut`, or both — there is no change to check otherwise.',
          fetched: [],
        };
      }

      const lower = (s: string) => s.toLowerCase();
      if (cut && !deckNames.some((n) => lower(n) === lower(cut))) {
        return {
          text: `"${cut}" is not in the decklist, so it cannot be cut. Check the list and try again.`,
          fetched: [],
        };
      }

      if (checks >= MAX_CHECKS) {
        return {
          text: `That is ${MAX_CHECKS} bracket checks on one deck, which is enough. Decide with what you already know and write the answer.`,
          fetched: [],
        };
      }
      checks++;

      const after = deckNames.filter((n) => !cut || lower(n) !== lower(cut));
      if (add) after.push(add);

      baseline ??= estimate([...deckNames]);
      const [before, afterEst] = await Promise.all([baseline, estimate(after)]);
      // No `fetched`: this vouches for nothing about a card's TEXT, only about
      // the deck's bracket. Treating it as a citation source would let the
      // model name a card it never actually read.
      return { text: render(before, afterEst, { add, cut }), fetched: [] };
    },
  };
}

/**
 * Keeps the model's research out of the answer.
 *
 * A tool-calling model narrates ("Let me look up some artifact removal") on the
 * same stream as the review, so something has to separate working notes from
 * the answer. Buffering the whole reply instead would cost the live streaming
 * this feature was built for (measured 7-9s to first answer).
 *
 * ⚠️ **The first version of this gate opened once and never closed, and that was
 * wrong in production.** It assumed the model researches, then answers. It does
 * not: it wrote the weakness section, called more tools, and wrote the rest — so
 * everything after the first marker was kept, and five interjections
 * ("Good—Mesmeric Orb directly mills…", "Let me refine:", "Looking back at the
 * results:") landed in the panel AND in the stored `ai_reviews` row, complete
 * with unrendered `**markdown**`.
 *
 * The signal that actually separates them: **narration is always followed by a
 * tool call.** A turn that ends without one is never research — it is the model
 * answering. So the gate works per TURN:
 *
 * - each turn starts closed, and releases text from ITS OWN first marker;
 * - a markerless turn that ended in a tool call is narration, and is dropped;
 * - a markerless turn that ended the loop is the answer continuing, and is kept.
 *
 * The caller must therefore tell it how each turn ended — see {@link endTurn}.
 *
 * ⚠️ **That rule is per-turn, so it cannot see narration INSIDE an answering
 * turn** — and the model does that too. Observed in production after #1644:
 *
 *   turn N: ---WEAKNESS--- … ---WINS--- <the whole review>
 *           "Now for the prescriptions. I need to identify which untap
 *            creatures to cut and what to replace them with:"
 *
 * The turn opened on a marker, so it was kept whole, and the trailing notes
 * rendered inside "How it wins" (the client slices its last section to the end
 * of the text). No per-turn signal separates them, because there isn't one: the
 * answer simply has no end. `endMarker` gives it one — the prompt emits it after
 * the last section, and everything from there on is discarded and the gate stays
 * shut for the rest of the conversation. One live baseline run trailed the
 * finished review with **38 lines** of self-deliberation. Measured on
 * `fixture-1-grounding`, 3 arms, n=22/build: trailing leaks 1/22 → 0/22, leaked
 * narration 40 lines → 3.
 *
 * ⚠️ **MID-answer narration is still open, and two fixes for it were measured
 * and REJECTED. Read this before trying a third.**
 *
 * "A markerless turn that ended in a tool call is research" is a heuristic, and
 * it is false when the model searches mid-answer — it emits a section label,
 * THEN searches, then writes the body, so the body lands in markerless turns
 * and the rule throws the real answer away (seen on the raw stream 1 run in 8;
 * a labelled section came back EMPTY in 3 of 6).
 *
 * - **`tool_choice: none` once the gate opens**, to make the heuristic true by
 *   removing the tool. Measured n=22: mid-answer leaks 2→3 (no gain) and
 *   MISSING section labels 1→5. Denied the tool, the model *narrates a search
 *   it cannot perform* ("Let me search for the right cards:Good.") and never
 *   reaches the closing sections. It moves the failure rather than removing it.
 * - **Open the gate on ANY section label.** A turn continuing prose that only
 *   later reaches the next label would release from THAT label and drop the
 *   continuation ahead of it — strictly worse in the common case.
 *
 * The design that would close it is two calls: one with tools whose text is
 * discarded entirely, then a tool-free call that writes, with the fetched card
 * text in its user message. No tools while writing means no narration to
 * separate, no turn boundary to lose a body at, and no denied tool to fake.
 * That is a real refactor of the request flow and has not been done.
 */
export function createMarkerGate(
  marker: string,
  onDelta?: (text: string) => void,
  endMarker?: string
) {
  /** The answer, accumulated across turns. */
  let kept = '';
  /** Raw text of the turn in progress. */
  let turn = '';
  let turnOpen = false;
  let everOpened = false;
  /** The end marker has been seen — the answer is finished, whatever follows. */
  let closed = false;

  /** Characters of `turn` already released to `onDelta`. */
  let sent = 0;
  // Held back so an end marker split across deltas is never half-streamed: the
  // reader would see a dangling "---EN" that the rest of the marker never
  // completes, because the completing delta is the one that closes the gate.
  const hold = endMarker ? endMarker.length - 1 : 0;

  /** Truncate at the end marker, latching the gate shut when it is there. */
  const cut = (text: string): string => {
    const at = endMarker ? text.indexOf(endMarker) : -1;
    if (at === -1) return text;
    closed = true;
    return text.slice(0, at);
  };

  return {
    push(text: string) {
      if (closed) return;
      turn += text;
      if (!turnOpen) {
        const at = turn.indexOf(marker);
        if (at === -1) return;
        // This turn is answering. Release from the marker; the rest streams live.
        turnOpen = true;
        everOpened = true;
        sent = at;
      }
      const end = endMarker ? turn.indexOf(endMarker, sent) : -1;
      const upto = end === -1 ? Math.max(sent, turn.length - hold) : end;
      if (upto > sent) onDelta?.(turn.slice(sent, upto));
      sent = upto;
    },

    /**
     * Close the current turn.
     *
     * `hadToolCalls` is the whole decision: it is what distinguishes a markerless
     * turn of research notes from a markerless turn that is simply the answer
     * running on past a section it already labelled.
     */
    endTurn(hadToolCalls: boolean) {
      if (closed) {
        turn = '';
        turnOpen = false;
        sent = 0;
        return;
      }
      if (turnOpen) {
        const answered = cut(turn.slice(turn.indexOf(marker)));
        // ⚠️ A RE-EMITTED marker means the model restarted its answer.
        //
        // The per-turn rule below only drops a MARKERLESS research turn. It does
        // not help when a turn opens with the marker, writes a draft section,
        // then trails off into narration on its way to another tool call —
        // that turn is kept whole, narration and all. Observed in production
        // (fix #1644 shipped without covering it, and 6 probe runs missed it):
        //
        //   turn A: ---WEAKNESS--- <draft> "Let me find those specific cards:"
        //   turn B: ---WEAKNESS--- <rewrite> ---GAMEPLAN--- …
        //
        // The model re-labelling a section it already wrote is it replacing that
        // section, so everything kept before it — the draft AND the narration
        // hanging off its end — is superseded. Drop it.
        if (kept.includes(marker)) kept = '';
        kept += answered;
      } else if (!hadToolCalls && everOpened) {
        // Nothing followed it, so it cannot be narration — and the answer had
        // already started, so this is its continuation. It was never streamed
        // (no marker opened this turn), so release it now.
        const tail = cut(turn);
        kept += tail;
        onDelta?.(tail);
      }
      turn = '';
      turnOpen = false;
      sent = 0;
    },

    /**
     * The answer: text from each marker onward, research discarded.
     *
     * Includes the turn in progress when that turn has already hit its marker,
     * so this reads correctly whether or not `endTurn` has run — the iteration
     * cap can return mid-turn.
     */
    get text() {
      if (closed || !turnOpen) return kept;
      const answered = turn.slice(turn.indexOf(marker));
      const at = endMarker ? answered.indexOf(endMarker) : -1;
      return kept + (at === -1 ? answered : answered.slice(0, at));
    },
    get opened() {
      return everOpened;
    },
  };
}

/**
 * Run one tool by name. Unknown names and thrown errors come back as tool
 * results rather than exceptions — a tool failure should make the model try
 * something else, not kill a review the user is already waiting on.
 */
export async function runTool(
  tools: AiTool[],
  name: string,
  input: Record<string, unknown>
): Promise<{ text: string; fetched: FetchedCard[]; isError: boolean }> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) {
    return { text: `No tool named "${name}".`, fetched: [], isError: true };
  }
  try {
    // `await` covers both shapes — a sync tool's plain object passes through.
    const { text, fetched } = await tool.run(input);
    return { text, fetched, isError: false };
  } catch (err) {
    logger.error(`[ai] tool ${name} threw`, err);
    return { text: `The ${name} tool failed. Continue without it.`, fetched: [], isError: true };
  }
}
