import crypto from 'node:crypto';
import type { ScryfallCache } from '../cache';
import type { RuleEntry, RulesIndex } from '../rules';
import type { AiTool, FetchedCard } from './tools';
import { END_MARK } from './deck-review';

/**
 * Rules Q&A (E261, "Ask a judge") — answer a Magic rules question grounded in
 * the Comprehensive Rules index plus the local card cache.
 *
 * Same two-pass architecture as the deck review (#1660): a RESEARCH pass with
 * tools whose prose is discarded, then a TOOL-FREE writing pass that receives
 * everything the research retrieved. The marker-gate heuristic that made
 * single-pass tool use leak narration is not load-bearing here at all.
 */

export const RULES_QA_FEATURE = 'rules-qa';

/** Bump whenever either prompt's text changes — it is folded into the hash. */
export const RULES_QA_PROMPT_VERSION = 'v1';

export const ANSWER_MARK = '---ANSWER---';

export const MAX_QUESTION_CHARS = 500;

export interface RulesQuestionRequest {
  question: string;
}

export function parseRulesQuestion(
  body: unknown
): { ok: true; value: RulesQuestionRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Body required.' };
  const question = (body as Record<string, unknown>).question;
  if (typeof question !== 'string' || !question.trim()) {
    return { ok: false, error: 'question is required.' };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `question must be at most ${MAX_QUESTION_CHARS} characters.` };
  }
  return { ok: true, value: { question: question.trim() } };
}

/**
 * Cache key. Case and spacing normalised so "Can I respond?" and "can i
 * respond" share an answer; the prompt version is folded in so a prompt change
 * invalidates every stored answer (#1649's rule).
 */
export function hashRulesQaInput(question: string): string {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(`${RULES_QA_PROMPT_VERSION}\n${normalized}`)
    .digest('hex');
}

export const RULES_QA_RESEARCH_PROMPT = `You are preparing an answer to a
Magic: The Gathering rules question inside SpellControl. You are NOT
writing the answer - a separate pass does that. Your only job is to
retrieve the material that pass will need, using the tools.

Work the question out first: what interaction is actually being asked
about, and which parts of the game's machinery decide it. Then retrieve:

- lookup_card for EVERY card named in the question, first. The exact
  oracle text usually decides the answer, and you must never reason from a
  remembered version of a card.
- search_rules with official rules terminology ("state-based actions",
  "casting a spell", "triggered ability", "combat damage"), not the
  player's phrasing. Glossary terms work too.
- get_rule to read a whole rule with its subrules once a search tells you
  where the answer lives - the subrules around a hit are usually the ones
  that settle it.

Three or four retrievals is typical. Stop when the material in front of
you decides the question; a reader is waiting.

Write no prose. Nothing you write in this pass is shown to anyone or
passed on - only what you retrieve is. When you have it, stop.`;

export const RULES_QA_SYSTEM_PROMPT = `You are a Magic: The Gathering rules
advisor inside SpellControl. You will be given a player's rules question,
the Comprehensive Rules excerpts a research pass retrieved for it, and the
exact oracle text of any cards involved.

Begin your reply with ${ANSWER_MARK} on a line of its own, then write
plain prose for the player.

The first sentence settles the question - yes, no, or exactly what it
depends on - because that is what they came for. Then the reasoning: walk
the interaction in the order the game actually processes it, citing the
rule that decides each step by its number in parentheses, like (601.2b)
or (704.5g).

Ground every claim. Cite only rule numbers that appear in the retrieved
rules, and quote card behaviour only from the oracle text provided - if
the retrieved material does not settle some part of the question, say so
plainly rather than papering over it. Answer from the rules as written;
where common tournament practice differs from a strict reading, say
which is which.

Keep it short. Most questions are settled in one or two paragraphs and
never more than three; sentences stay short, and jargon the question
didn't use gets one plain-words gloss. No headings, no bullet lists, no
markdown.

${END_MARK} closes the answer. Emit it on a line of its own after the
last sentence, and stop there. Everything after it is discarded, so
notes to yourself or a second attempt reach nobody - revise before the
terminator, not after it.`;

export function buildRulesQaMessage(question: string): string {
  return `## Question\n\n${question}`;
}

/** The retrieved rules, appended to the writing pass's user message. */
export function renderFetchedRules(rules: RuleEntry[]): string {
  if (rules.length === 0) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of rules) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    lines.push(`${r.ref}: ${r.body.replace(/\n/g, ' ')}`);
  }
  return (
    '## Comprehensive Rules excerpts the research pass retrieved\n' +
    '(the only rules you may cite)\n\n' +
    lines.join('\n')
  );
}

/** Every rule number cited in the prose, in order of first appearance. */
export function citedRuleRefs(content: string): string[] {
  return [...new Set(content.match(/\b\d{3}\.\d+[a-z]*\b/g) ?? [])];
}

/**
 * The opening ${ANSWER_MARK} is machine output and must never reach the reader.
 *
 * The tool loop's marker gate releases text FROM the marker (that is how it
 * knows the answer started), so both the stream and the final content begin
 * with it. The deck features consume their markers downstream — the review's
 * client renders them as section titles, refine's `makeProseGate` strips its
 * one — but a rules answer is a single unlabelled block, so the strip happens
 * here, once, for both the stream and the stored copy.
 */
export function stripAnswerMark(text: string): string {
  const at = text.indexOf(ANSWER_MARK);
  return at === -1
    ? text
    : text.slice(0, at) + text.slice(at + ANSWER_MARK.length).replace(/^\s+/, '');
}

/**
 * Streaming counterpart of {@link stripAnswerMark}. Deltas split wherever the
 * model chunks, so the marker can arrive a character at a time — hold the
 * stream until enough has arrived to know whether it opens with the marker,
 * then pass everything else through untouched.
 */
export function makeAnswerGate(emit: (text: string) => void): (delta: string) => void {
  let buffer = '';
  let handled = false;
  /** First real character is out — whitespace still arriving is prose, not the
   *  marker's trailing newlines. */
  let started = false;
  return (delta: string) => {
    if (handled) {
      if (!started) {
        delta = delta.replace(/^\s+/, '');
        if (!delta) return;
        started = true;
      }
      emit(delta);
      return;
    }
    buffer += delta;
    if (buffer.length < ANSWER_MARK.length) return;
    handled = true;
    const out = stripAnswerMark(buffer);
    if (out) {
      started = true;
      emit(out);
    }
  };
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * `search_rules` — BM25 over the CR index. Hits are reported to `onRule` so the
 * route can carry them into the writing pass and the citation display; the
 * loop's `fetched` stays cards-only.
 */
export function searchRulesTool(index: RulesIndex, onRule: (rule: RuleEntry) => void): AiTool {
  return {
    definition: {
      name: 'search_rules',
      description: [
        'Full-text search over the official Magic: The Gathering Comprehensive Rules,',
        'including the glossary. Query with rules terminology ("state-based actions",',
        '"declare blockers", "mana ability"), not the player\'s phrasing - all terms must',
        'match, so shorter, more official wording finds more. Returns numbered rules;',
        'follow up with get_rule to read a whole rule and its subrules.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Rules terminology to search for, e.g. "casting a spell targets".',
          },
        },
        required: ['query'],
      },
    },
    run(input) {
      const query = asString(input.query);
      if (!query) {
        return { text: 'No query given. Pass rules terminology as `query`.', fetched: [] };
      }
      const hits = index.search(query);
      if (hits.length === 0) {
        return {
          text: `Nothing in the Comprehensive Rules matched "${query}". Try shorter or more official wording.`,
          fetched: [],
        };
      }
      for (const hit of hits) onRule(hit);
      return {
        text: hits.map((h) => `${h.ref}: ${h.body.replace(/\n/g, ' ')}`).join('\n'),
        fetched: [],
      };
    },
  };
}

/** `get_rule` — read one rule with its subrules, a section, or a glossary term. */
export function getRuleTool(index: RulesIndex, onRule: (rule: RuleEntry) => void): AiTool {
  return {
    definition: {
      name: 'get_rule',
      description: [
        'Read the Comprehensive Rules by number. Pass a rule number like "601.2" to get',
        'the rule and all its subrules, a subrule like "601.2b" for just that one, a',
        'section number like "601" for its table of rules, or a glossary term like',
        '"deathtouch" for its definition.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          rule: {
            type: 'string',
            description: 'A rule number ("601.2", "704.5g", "601") or a glossary term.',
          },
        },
        required: ['rule'],
      },
    },
    run(input) {
      const ref = asString(input.rule);
      if (!ref) {
        return {
          text: 'No rule given. Pass a rule number or glossary term as `rule`.',
          fetched: [],
        };
      }
      const rows = index.get(ref);
      if (rows.length === 0) {
        return {
          text: `No rule or glossary entry "${ref}". Check the number, or search_rules for the topic.`,
          fetched: [],
        };
      }
      for (const row of rows) onRule(row);
      return {
        text: rows.map((r) => `${r.ref}: ${r.body.replace(/\n/g, ' ')}`).join('\n'),
        fetched: [],
      };
    },
  };
}

/**
 * `lookup_card` — exact oracle text (and official rulings) for one named card,
 * from the local Scryfall cache. Cache-only like every other AI card read;
 * a miss means the model says so rather than reasoning from memory.
 */
export function lookupCardTool(cache: ScryfallCache): AiTool {
  return {
    definition: {
      name: 'lookup_card',
      description: [
        'Get the exact oracle text, type line, mana cost and official rulings for one Magic',
        'card by name. Use it for EVERY card the question names before reasoning about it -',
        'the printed reminder text players remember routinely differs from the oracle text',
        'that actually governs the interaction. One card per call; call it in parallel for',
        'several cards.',
      ].join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The exact card name, e.g. "Blood Moon".' },
        },
        required: ['name'],
      },
    },
    run(input) {
      const name = asString(input.name);
      if (!name) {
        return { text: 'No name given. Pass the card name as `name`.', fetched: [] };
      }
      // Oracle facts don't expire the way prices do (see routes/ai.ts).
      const card = cache.getCheapestByName(name, Number.MAX_SAFE_INTEGER);
      if (!card) {
        return {
          text: `No card named "${name}" in the card database. Check the spelling; if it is right, say the card could not be verified rather than quoting it from memory.`,
          fetched: [],
        };
      }
      // Multi-face layouts carry their text per face.
      const faces =
        card.oracle_text == null && card.card_faces?.length
          ? card.card_faces
              .map((f) => `${f.name ?? card.name} — ${f.type_line ?? ''}: ${f.oracle_text ?? ''}`)
              .join(' // ')
          : null;
      const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
      const oracleText = card.oracle_text ?? faces ?? '';
      const rulings = (cache.getRulings(card.id) ?? [])
        .slice(0, 6)
        .map((r) => `- (${r.published_at}) ${r.comment}`);
      const fetched: FetchedCard[] = [{ name: card.name, typeLine, oracleText }];
      return {
        text: [
          `${card.name}${card.mana_cost ? ` ${card.mana_cost}` : ''} — ${typeLine}`,
          oracleText,
          ...(rulings.length > 0 ? ['Official rulings:', ...rulings] : []),
        ].join('\n'),
        fetched,
      };
    },
  };
}
