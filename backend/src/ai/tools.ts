import type Anthropic from '@anthropic-ai/sdk';
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

export interface AiTool {
  definition: Anthropic.Tool;
  /**
   * Run the tool. Returns the text handed back to the model as the tool
   * result, plus any cards that text vouches for.
   */
  run(input: Record<string, unknown>): { text: string; fetched: FetchedCard[] };
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
 */
export function createMarkerGate(marker: string, onDelta?: (text: string) => void) {
  /** The answer, accumulated across turns. */
  let kept = '';
  /** Raw text of the turn in progress. */
  let turn = '';
  let turnOpen = false;
  let everOpened = false;

  return {
    push(text: string) {
      turn += text;
      if (turnOpen) {
        onDelta?.(text);
        return;
      }
      const at = turn.indexOf(marker);
      if (at === -1) return;
      // This turn is answering. Release from the marker; the rest streams live.
      turnOpen = true;
      everOpened = true;
      onDelta?.(turn.slice(at));
    },

    /**
     * Close the current turn.
     *
     * `hadToolCalls` is the whole decision: it is what distinguishes a markerless
     * turn of research notes from a markerless turn that is simply the answer
     * running on past a section it already labelled.
     */
    endTurn(hadToolCalls: boolean) {
      if (turnOpen) {
        kept += turn.slice(turn.indexOf(marker));
      } else if (!hadToolCalls && everOpened) {
        // Nothing followed it, so it cannot be narration — and the answer had
        // already started, so this is its continuation. It was never streamed
        // (no marker opened this turn), so release it now.
        kept += turn;
        onDelta?.(turn);
      }
      turn = '';
      turnOpen = false;
    },

    /**
     * The answer: text from each marker onward, research discarded.
     *
     * Includes the turn in progress when that turn has already hit its marker,
     * so this reads correctly whether or not `endTurn` has run — the iteration
     * cap can return mid-turn.
     */
    get text() {
      if (!turnOpen) return kept;
      return kept + turn.slice(turn.indexOf(marker));
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
export function runTool(
  tools: AiTool[],
  name: string,
  input: Record<string, unknown>
): { text: string; fetched: FetchedCard[]; isError: boolean } {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) {
    return { text: `No tool named "${name}".`, fetched: [], isError: true };
  }
  try {
    const { text, fetched } = tool.run(input);
    return { text, fetched, isError: false };
  } catch (err) {
    logger.error(`[ai] tool ${name} threw`, err);
    return { text: `The ${name} tool failed. Continue without it.`, fetched: [], isError: true };
  }
}
